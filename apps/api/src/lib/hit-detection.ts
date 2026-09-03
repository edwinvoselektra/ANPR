import type { CameraDirection, PassageSource, Prisma } from "@prisma/client";

type HitTransaction = Pick<Prisma.TransactionClient, "plateGroupMember" | "hit" | "passage">;

export async function detectAndCreateHit(tx: HitTransaction, input: {
  passageId: string; cameraId: string; normalizedLicensePlate: string; location: string;
  timestamp: Date; direction: CameraDirection; source: PassageSource;
  vehicleImageObjectId?: string | null; plateImageObjectId?: string | null;
}) {
  const matches = await tx.plateGroupMember.findMany({
    where: {
      normalizedLicensePlate: input.normalizedLicensePlate, active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: input.timestamp } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: input.timestamp } }] }
      ],
      group: { active: true, hitEnabled: true }
    },
    include: { group: { select: { id: true, name: true } } },
    orderBy: [{ group: { name: "asc" } }, { groupId: "asc" }]
  });
  if (!matches.length) return null;
  const primary = matches[0]!;
  const hit = await tx.hit.create({ data: {
    passageId: input.passageId, cameraId: input.cameraId, groupId: primary.groupId,
    normalizedLicensePlate: input.normalizedLicensePlate, location: input.location,
    timestamp: input.timestamp, vehicleImageObjectId: input.vehicleImageObjectId,
    plateImageObjectId: input.plateImageObjectId, reason: primary.reason,
    notificationStatus: "PENDING",
    groups: { create: matches.map((match) => ({ groupId: match.groupId, reason: match.reason })) }
  } });
  await tx.passage.update({ where: { id: input.passageId }, data: { isHit: true } });
  return { id: hit.id, groups: matches.map((match) => ({ id: match.groupId, name: match.group.name, reason: match.reason })) };
}
