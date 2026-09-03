import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../lib/audit.js";
import { authenticate } from "../lib/auth.js";
import { sendTestPush } from "../lib/notification-dispatcher.js";
import { prisma } from "../lib/prisma.js";
import { pushConfiguration } from "../lib/push.js";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2_048).refine((value) => value.startsWith("https://"), "Push-endpoint moet HTTPS gebruiken."),
  keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }),
  deviceName: z.string().trim().min(1).max(100).optional()
});
const preferenceSchema = z.object({
  pushEnabled: z.boolean(), allHitGroups: z.boolean(),
  groupIds: z.array(z.string().uuid()).max(100).default([])
}).superRefine((value, ctx) => {
  if (value.pushEnabled && !value.allHitGroups && value.groupIds.length === 0) {
    ctx.addIssue({ code: "custom", path: ["groupIds"], message: "Kies minimaal één groep of kies alle hits." });
  }
});

const safeSubscription = {
  id: true, deviceName: true, userAgent: true, enabled: true,
  lastSuccessfulAt: true, failureCount: true, createdAt: true, updatedAt: true
} as const;

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications/config", { preHandler: authenticate }, async () => ({
    configured: pushConfiguration.configured,
    state: pushConfiguration.state,
    publicKey: pushConfiguration.publicKey,
    message: pushConfiguration.message
  }));

  app.get("/notifications/preferences", { preHandler: authenticate }, async (request) => {
    const userId = request.authUser!.id;
    const [preference, subscriptions, groups] = await Promise.all([
      prisma.notificationPreference.findUnique({ where: { userId }, include: { groups: { select: { groupId: true } } } }),
      prisma.pushSubscription.findMany({ where: { userId }, select: safeSubscription, orderBy: { updatedAt: "desc" } }),
      prisma.plateGroup.findMany({ where: { active: true, hitEnabled: true }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } })
    ]);
    return {
      preference: { pushEnabled: preference?.pushEnabled ?? false, allHitGroups: preference?.allHitGroups ?? true, groupIds: preference?.groups.map(({ groupId }) => groupId) ?? [] },
      subscriptions, groups
    };
  });

  app.put("/notifications/preferences", { preHandler: authenticate }, async (request, reply) => {
    const input = preferenceSchema.parse(request.body);
    if (input.groupIds.length) {
      const existing = await prisma.plateGroup.count({ where: { id: { in: input.groupIds }, active: true, hitEnabled: true } });
      if (existing !== new Set(input.groupIds).size) {
        return reply.code(400).send({ error: "GROUP_NOT_AVAILABLE", message: "Een gekozen hitgroep bestaat niet meer of is uitgeschakeld." });
      }
    }
    const preference = await prisma.$transaction(async (tx) => {
      const saved = await tx.notificationPreference.upsert({
        where: { userId: request.authUser!.id },
        update: { pushEnabled: input.pushEnabled, allHitGroups: input.allHitGroups },
        create: { userId: request.authUser!.id, pushEnabled: input.pushEnabled, allHitGroups: input.allHitGroups }
      });
      await tx.notificationPreferenceGroup.deleteMany({ where: { preferenceId: saved.id } });
      if (!input.allHitGroups && input.groupIds.length) {
        await tx.notificationPreferenceGroup.createMany({ data: [...new Set(input.groupIds)].map((groupId) => ({ preferenceId: saved.id, groupId })) });
      }
      return saved;
    });
    await audit(request, "NOTIFICATION_PREFERENCES_UPDATED", { objectType: "NotificationPreference", objectId: preference.id, metadata: { pushEnabled: input.pushEnabled, allHitGroups: input.allHitGroups, groupCount: input.groupIds.length } });
    return { success: true, message: "Meldingsvoorkeuren zijn opgeslagen." };
  });

  app.post("/notifications/subscriptions", { preHandler: authenticate }, async (request, reply) => {
    if (!pushConfiguration.configured) return reply.code(503).send({ error: "PUSH_NOT_CONFIGURED", message: pushConfiguration.message });
    const input = subscriptionSchema.parse(request.body);
    const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: input.endpoint }, select: { id: true, userId: true } });
    if (existing && existing.userId !== request.authUser!.id) {
      return reply.code(409).send({ error: "SUBSCRIPTION_IN_USE", message: "Dit apparaat is al aan een ander account gekoppeld." });
    }
    const subscription = existing
      ? await prisma.pushSubscription.update({ where: { id: existing.id }, data: { p256dh: input.keys.p256dh, auth: input.keys.auth, deviceName: input.deviceName, userAgent: request.headers["user-agent"]?.slice(0, 500), enabled: true, failureCount: 0 }, select: safeSubscription })
      : await prisma.pushSubscription.create({ data: { userId: request.authUser!.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, deviceName: input.deviceName, userAgent: request.headers["user-agent"]?.slice(0, 500) }, select: safeSubscription });
    await prisma.notificationPreference.upsert({ where: { userId: request.authUser!.id }, update: { pushEnabled: true }, create: { userId: request.authUser!.id, pushEnabled: true } });
    await audit(request, "PUSH_DEVICE_ADDED", { objectType: "PushSubscription", objectId: subscription.id, metadata: { deviceName: subscription.deviceName } });
    return reply.code(existing ? 200 : 201).send({ subscription, message: "Meldingen zijn op dit apparaat ingeschakeld." });
  });

  app.delete("/notifications/subscriptions/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await prisma.pushSubscription.deleteMany({ where: { id, userId: request.authUser!.id } });
    if (!result.count) return reply.code(404).send({ error: "NOT_FOUND", message: "Dit apparaat is niet gevonden." });
    await audit(request, "PUSH_DEVICE_REMOVED", { objectType: "PushSubscription", objectId: id });
    return reply.code(204).send();
  });

  app.post("/notifications/subscriptions/:id/test", { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!pushConfiguration.configured) return reply.code(503).send({ error: "PUSH_NOT_CONFIGURED", message: pushConfiguration.message });
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const result = await sendTestPush(prisma, request.authUser!.id, id);
    if (!result.ok && result.reason === "NOT_FOUND") return reply.code(404).send({ error: "NOT_FOUND", message: "Dit apparaat is niet gevonden of uitgeschakeld." });
    if (!result.ok) return reply.code(502).send({ error: "PUSH_FAILED", message: "De testmelding kon niet worden afgeleverd. Controleer de browsertoestemming en probeer opnieuw." });
    return { success: true, message: "Testmelding verzonden." };
  });
}
