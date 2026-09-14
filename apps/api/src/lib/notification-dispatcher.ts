import { directionLabel, normalizeDirection, formatLocalDate, resolveTimeZone } from "@anpr/shared";
import { config } from "../config.js";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma.js";
import { pushConfiguration, pushFailure, webPushSender, type PushSender } from "./push.js";

type Logger = { info(value: object, message: string): void; error(value: object, message: string): void };
const quietLogger: Logger = { info: () => undefined, error: () => undefined };

export function payloadFor(hit: { id: string; normalizedLicensePlate: string; reason: string | null; cameraId: string; timestamp?:Date|string; passage?:{direction:string;timezone?:string|null}; camera: { name: string; historicalName?: string | null;vpnLocation?:{timezone:string}|null } }) {
  const direction=normalizeDirection(hit.passage?.direction);
  const localTime=hit.timestamp?formatLocalDate(hit.timestamp,resolveTimeZone(hit.passage?.timezone??hit.camera.vpnLocation?.timezone,config.PLATFORM_TIMEZONE)):"";
  return JSON.stringify({
    title: "ANPR Hit",
    body: `${hit.normalizedLicensePlate} · ${hit.camera.historicalName ?? hit.camera.name}${direction!=="UNKNOWN"?` · ${directionLabel(direction)}`:""}${localTime?` · ${localTime}`:""}${hit.reason ? ` · ${hit.reason}` : ""}`,
    data: { hitId: hit.id, url: `/hits/${hit.id}`, cameraId: hit.cameraId }
  });
}

async function recordSkipped(db: PrismaClient, hitId: string, recipientId: string, category: string) {
  await db.notification.upsert({
    where: { deduplicationKey: `${hitId}:user:${recipientId}` },
    update: {},
    create: { hitId, recipientId, deduplicationKey: `${hitId}:user:${recipientId}`, channel: "WEB_PUSH", status: "SKIPPED", failureCategory: category }
  });
}

export async function dispatchHit(db: PrismaClient, hitId: string, sender: PushSender, logger: Logger = quietLogger) {
  const hit = await db.hit.findUnique({
    where: { id: hitId },
    include: { camera: { select: { name: true, historicalName: true, vpnLocation:{select:{timezone:true}} } }, passage:{select:{direction:true,timezone:true}}, groups: { select: { groupId: true } } }
  });
  if (!hit) return;
  const groupIds = new Set(hit.groups.map(({ groupId }) => groupId));
  const recipients = await db.user.findMany({
    where: { active: true, notificationPreference: { isNot: null } },
    include: {
      notificationPreference: { include: { groups: { select: { groupId: true } } } },
      pushSubscriptions: { where: { enabled: true } }
    }
  });
  let sent = 0;
  let failed = 0;
  for (const user of recipients) {
    const preference = user.notificationPreference;
    if (!preference?.pushEnabled) {
      await recordSkipped(db, hit.id, user.id, "PUSH_DISABLED");
      continue;
    }
    const relevant = preference.allHitGroups || preference.groups.some(({ groupId }) => groupIds.has(groupId));
    if (!relevant) {
      await recordSkipped(db, hit.id, user.id, "GROUP_FILTER");
      continue;
    }
    if (!user.pushSubscriptions.length) {
      await recordSkipped(db, hit.id, user.id, "NO_ACTIVE_DEVICE");
      continue;
    }
    for (const subscription of user.pushSubscriptions) {
      const deduplicationKey = `${hit.id}:subscription:${subscription.id}`;
      const delivery = await db.notification.upsert({
        where: { deduplicationKey }, update: {},
        create: { hitId: hit.id, recipientId: user.id, subscriptionId: subscription.id, deduplicationKey, channel: "WEB_PUSH" }
      });
      if (delivery.status === "SENT") { sent += 1; continue; }
      if (delivery.status === "PROCESSING") continue;
      const claimed = await db.notification.updateMany({ where: { id: delivery.id, status: "PENDING" }, data: { status: "PROCESSING" } });
      if (!claimed.count) continue;
      let delivered = false;
      let lastFailure: ReturnType<typeof pushFailure> | undefined;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await sender.send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payloadFor(hit));
          await db.$transaction([
            db.notification.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt: new Date(), attemptCount: attempt, failureCategory: null, error: null } }),
            db.pushSubscription.update({ where: { id: subscription.id }, data: { lastSuccessfulAt: new Date(), failureCount: 0 } })
          ]);
          delivered = true;
          sent += 1;
          logger.info({ hitId: hit.id, subscriptionId: subscription.id }, "Pushmelding aangeboden aan pushdienst");
          break;
        } catch (error) {
          lastFailure = pushFailure(error);
          if (!lastFailure.temporary || attempt === 3) {
            await db.$transaction([
              db.notification.update({ where: { id: delivery.id }, data: { status: "FAILED", attemptCount: attempt, failureCategory: lastFailure.category, error: lastFailure.safeMessage } }),
              db.pushSubscription.update({ where: { id: subscription.id }, data: { enabled: lastFailure.expired ? false : subscription.enabled, failureCount: { increment: 1 } } })
            ]);
            failed += 1;
            logger.error({ hitId: hit.id, subscriptionId: subscription.id, category: lastFailure.category }, "Pushmelding niet afgeleverd");
            break;
          }
        }
      }
      if (!delivered && !lastFailure) failed += 1;
    }
  }
  await db.hit.update({ where: { id: hit.id }, data: {
    notificationSent: sent > 0,
    notificationStatus: sent > 0 ? "SENT" : failed > 0 ? "FAILED" : "SKIPPED"
  } });
}

export async function processPendingHits(db: PrismaClient = defaultPrisma, sender: PushSender = webPushSender, logger: Logger = quietLogger) {
  if (!pushConfiguration.configured && sender === webPushSender) return 0;
  const pending = await db.hit.findMany({ where: { notificationStatus: "PENDING" }, select: { id: true }, orderBy: { createdAt: "asc" }, take: 10 });
  let processed = 0;
  for (const hit of pending) {
    const claimed = await db.hit.updateMany({ where: { id: hit.id, notificationStatus: "PENDING" }, data: { notificationStatus: "PROCESSING" } });
    if (!claimed.count) continue;
    try {
      await dispatchHit(db, hit.id, sender, logger);
    } catch (error) {
      await db.hit.update({ where: { id: hit.id }, data: { notificationStatus: "FAILED" } }).catch(() => undefined);
      logger.error({ hitId: hit.id, error: error instanceof Error ? error.message : "unknown" }, "Pushjob mislukt");
    }
    processed += 1;
  }
  return processed;
}

export async function sendTestPush(db: PrismaClient, userId: string, subscriptionId: string, sender: PushSender = webPushSender) {
  const subscription = await db.pushSubscription.findFirst({ where: { id: subscriptionId, userId, enabled: true } });
  if (!subscription) return { ok: false as const, reason: "NOT_FOUND" as const };
  const delivery = await db.notification.create({ data: {
    recipientId: userId, subscriptionId, deduplicationKey: `test:${randomUUID()}`,
    channel: "WEB_PUSH_TEST", status: "PROCESSING"
  } });
  try {
    await sender.send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({
      title: "ANPR testmelding", body: "Meldingen werken op dit apparaat.", data: { url: "/settings" }
    }));
    await db.$transaction([
      db.notification.update({ where: { id: delivery.id }, data: { status: "SENT", sentAt: new Date(), attemptCount: 1 } }),
      db.pushSubscription.update({ where: { id: subscription.id }, data: { lastSuccessfulAt: new Date(), failureCount: 0 } })
    ]);
    return { ok: true as const };
  } catch (error) {
    const failure = pushFailure(error);
    await db.$transaction([
      db.notification.update({ where: { id: delivery.id }, data: { status: "FAILED", attemptCount: 1, failureCategory: failure.category, error: failure.safeMessage } }),
      db.pushSubscription.update({ where: { id: subscription.id }, data: { enabled: failure.expired ? false : subscription.enabled, failureCount: { increment: 1 } } })
    ]);
    return { ok: false as const, reason: failure.category };
  }
}

export function startNotificationDispatcher(logger: Logger) {
  const run = () => void processPendingHits(defaultPrisma, webPushSender, logger);
  run();
  const timer = setInterval(run, 2_000);
  timer.unref();
  return () => clearInterval(timer);
}
