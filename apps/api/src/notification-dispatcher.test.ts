import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { dispatchHit, sendTestPush } from "./lib/notification-dispatcher.js";

const HIT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const GROUP = "33333333-3333-4333-8333-333333333333";
const subscription = (id: string) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "public", auth: "secret", enabled: true });

function database(users: any[]) {
  const deliveries = new Map<string, any>();
  const db: any = {
    hit: {
      findUnique: vi.fn().mockResolvedValue({ id: HIT, normalizedLicensePlate: "12ABC3", reason: "Testreden", cameraId: "camera", camera: { name: "Uddel Noord" }, groups: [{ groupId: GROUP }] }),
      update: vi.fn().mockResolvedValue({})
    },
    user: { findMany: vi.fn().mockResolvedValue(users) },
    notification: {
      upsert: vi.fn(async ({ where, create }: any) => deliveries.get(where.deduplicationKey) ?? (() => { const value = { id: `delivery-${deliveries.size}`, status: create.status ?? "PENDING", ...create }; deliveries.set(where.deduplicationKey, value); return value; })()),
      updateMany: vi.fn(async ({ where }: any) => { const value = [...deliveries.values()].find((item) => item.id === where.id); if (!value || value.status !== where.status) return { count: 0 }; value.status = "PROCESSING"; return { count: 1 }; }),
      update: vi.fn(async ({ where, data }: any) => { const value = [...deliveries.values()].find((item) => item.id === where.id); if (value) Object.assign(value, data); return value ?? {}; }),
      create: vi.fn().mockResolvedValue({ id: "test-delivery" })
    },
    pushSubscription: { update: vi.fn().mockResolvedValue({}), findFirst: vi.fn() },
    $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations))
  };
  return { db: db as PrismaClient, raw: db, deliveries };
}

const recipient = (options: { pushEnabled?: boolean; allHitGroups?: boolean; groupIds?: string[]; subscriptions?: any[] } = {}) => ({
  id: USER,
  notificationPreference: { pushEnabled: options.pushEnabled ?? true, allHitGroups: options.allHitGroups ?? true, groups: (options.groupIds ?? []).map((groupId) => ({ groupId })) },
  pushSubscriptions: options.subscriptions ?? [subscription("44444444-4444-4444-8444-444444444444")]
});

describe("centrale hit-pushverwerking", () => {
  const sender = { send: vi.fn() };
  beforeEach(() => { vi.clearAllMocks(); sender.send.mockResolvedValue(undefined); });

  it("levert een relevante hit één keer per apparaat en nooit dubbel bij herstart", async () => {
    const one = subscription("44444444-4444-4444-8444-444444444444");
    const two = subscription("55555555-5555-4555-8555-555555555555");
    const { db, raw } = database([recipient({ subscriptions: [one, two] })]);
    await dispatchHit(db, HIT, sender); await dispatchHit(db, HIT, sender);
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(raw.hit.update).toHaveBeenLastCalledWith({where:{id:HIT},data:{notificationSent:true,notificationStatus:"SENT"}});
    expect(sender.send.mock.calls[0]?.[1]).toContain(`/hits/${HIT}`);
  });

  it("slaat push uit en niet-geselecteerde groepen aantoonbaar over", async () => {
    const off = database([recipient({ pushEnabled: false })]);
    await dispatchHit(off.db, HIT, sender);
    const filtered = database([recipient({ allHitGroups: false, groupIds: ["99999999-9999-4999-8999-999999999999"] })]);
    await dispatchHit(filtered.db, HIT, sender);
    expect(sender.send).not.toHaveBeenCalled();
    expect([...off.deliveries.values()][0]?.failureCategory).toBe("PUSH_DISABLED");
    expect([...filtered.deliveries.values()][0]?.failureCategory).toBe("GROUP_FILTER");
  });

  it("levert een hit voor een gekozen relevante groep", async () => {
    const { db } = database([recipient({ allHitGroups: false, groupIds: [GROUP] })]);
    await dispatchHit(db, HIT, sender);
    expect(sender.send).toHaveBeenCalledOnce();
  });

  it("schakelt een verlopen 410-abonnement veilig uit", async () => {
    sender.send.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const { db, raw } = database([recipient()]);
    await dispatchHit(db, HIT, sender);
    expect(raw.pushSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ enabled: false }) }));
    expect(raw.hit.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notificationStatus: "FAILED" }) }));
  });

  it("maakt voor een testmelding geen Hit en gebruikt een instellingen-URL", async () => {
    const { db, raw } = database([]); raw.pushSubscription.findFirst.mockResolvedValue(subscription("44444444-4444-4444-8444-444444444444"));
    const result = await sendTestPush(db, USER, "44444444-4444-4444-8444-444444444444", sender);
    expect(result.ok).toBe(true); expect(sender.send.mock.calls[0]?.[1]).toContain('"url":"/settings"');
    expect(raw.hit.update).not.toHaveBeenCalled();
  });
});
