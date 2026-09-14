import { historicalCamera } from "../lib/historical-camera.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { displayLicensePlate, normalizeLicensePlate, PERMISSIONS } from "@anpr/shared";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

// `z.coerce.date()` zet null om in 1970-01-01. Controleer null daarom vóór
// coercion, zodat een leeg optioneel datumveld werkelijk onbegrensd blijft.
const nullableDate = z.union([z.null(), z.coerce.date()]).optional();
const plateBody = z.object({
  licensePlate: z.string().trim().min(2).max(20),
  description: z.string().trim().max(1000).nullish(),
  note: z.string().trim().max(2000).nullish(),
  reason: z.string().trim().max(1000).nullish(),
  active: z.boolean().default(true),
  validFrom: nullableDate,
  validUntil: nullableDate,
  groupIds: z.array(z.string().uuid()).min(1, "Kies minimaal één groep.").max(50)
}).superRefine((body, context) => {
  if (body.validFrom && body.validUntil && body.validUntil < body.validFrom) {
    context.addIssue({ code: "custom", path: ["validUntil"], message: "Geldig tot moet na geldig vanaf liggen." });
  }
});
const plateUpdate = z.object({
  licensePlate: z.string().trim().min(2).max(20).optional(),
  description: z.string().trim().max(1000).nullish(),
  note: z.string().trim().max(2000).nullish(),
  reason: z.string().trim().max(1000).nullish(),
  active: z.boolean().optional(),
  validFrom: nullableDate,
  validUntil: nullableDate,
  groupIds: z.array(z.string().uuid()).min(1, "Kies minimaal één groep.").max(50).optional()
}).superRefine((body, context) => {
  if (body.validFrom && body.validUntil && body.validUntil < body.validFrom) {
    context.addIssue({ code: "custom", path: ["validUntil"], message: "Geldig tot moet na geldig vanaf liggen." });
  }
});
const plateParams = z.object({ normalized: z.string().min(2).max(20).transform(normalizeLicensePlate).refine((value) => value.length >= 2) });
const groupSelect = { id: true, name: true, color: true, icon: true, active: true, hitEnabled: true, reasonRequired: true } as const;
const memberInclude = { group: { select: groupSelect }, addedBy: { select: { id: true, displayName: true } } } as const;

function unique(values: string[]) { return [...new Set(values)]; }

async function resolveGroups(groupIds: string[]) {
  const ids = unique(groupIds);
  const groups = await prisma.plateGroup.findMany({ where: { id: { in: ids } }, select: groupSelect });
  return groups.length === ids.length ? groups : null;
}

function reasonMissing(groups: Array<{ hitEnabled: boolean; reasonRequired: boolean }>, reason?: string | null) {
  return groups.some((group) => group.hitEnabled || group.reasonRequired) && !reason?.trim();
}

function plateResponse(members: Array<any>) {
  const first = members[0];
  return {
    normalizedLicensePlate: first.normalizedLicensePlate,
    displayLicensePlate: first.displayLicensePlate,
    description: first.description,
    note: first.note,
    reason: first.reason,
    active: first.active,
    validFrom: first.validFrom,
    validUntil: first.validUntil,
    createdAt: first.createdAt,
    addedBy: first.addedBy,
    groups: members.map((member) => member.group)
  };
}

export async function plateRoutes(app: FastifyInstance) {
  app.get("/plates", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z.string().min(2).max(20).transform(normalizeLicensePlate).optional(),
      q: z.string().max(20).transform(normalizeLicensePlate).optional(),
      active: z.enum(["true", "false"]).optional()
    }).parse(request.query);
    const representatives = await prisma.plateGroupMember.findMany({
      where: {
        normalizedLicensePlate: { contains: query.q, gt: query.cursor },
        active: query.active === undefined ? undefined : query.active === "true"
      },
      distinct: ["normalizedLicensePlate"], orderBy: { normalizedLicensePlate: "asc" },
      select: { normalizedLicensePlate: true }, take: query.limit + 1
    });
    const page = representatives.slice(0, query.limit).map((item) => item.normalizedLicensePlate);
    const members = page.length ? await prisma.plateGroupMember.findMany({
      where: { normalizedLicensePlate: { in: page } }, include: memberInclude,
      orderBy: [{ normalizedLicensePlate: "asc" }, { group: { name: "asc" } }]
    }) : [];
    const grouped = new Map<string, typeof members>();
    for (const member of members) grouped.set(member.normalizedLicensePlate, [...(grouped.get(member.normalizedLicensePlate) ?? []), member]);
    return {
      plates: page.flatMap((normalized) => grouped.has(normalized) ? [plateResponse(grouped.get(normalized)!)] : []),
      nextCursor: representatives.length > query.limit ? page.at(-1) : null
    };
  });

  app.post("/plates", { preHandler: requirePermission(PERMISSIONS.PLATES_MANAGE) }, async (request, reply) => {
    const body = plateBody.parse(request.body);
    const normalized = normalizeLicensePlate(body.licensePlate);
    if (normalized.length < 2) return reply.code(400).send({ error: "INVALID_PLATE", message: "Vul een geldig kenteken in." });
    if (await prisma.plateGroupMember.findFirst({ where: { normalizedLicensePlate: normalized }, select: { id: true } })) {
      return reply.code(409).send({ error: "PLATE_EXISTS", message: "Dit kenteken bestaat al. Bewerk de bestaande registratie om groepen toe te voegen." });
    }
    const groups = await resolveGroups(body.groupIds);
    if (!groups) return reply.code(400).send({ error: "GROUP_NOT_FOUND", message: "Een gekozen groep bestaat niet (meer)." });
    if (reasonMissing(groups, body.reason)) return reply.code(400).send({ error: "REASON_REQUIRED", message: "Vul een reden in voor een signaleringsgroep." });
    const common = {
      normalizedLicensePlate: normalized, displayLicensePlate: displayLicensePlate(body.licensePlate),
      description: body.description || null, note: body.note || null, reason: body.reason || null,
      active: body.active, validFrom: body.validFrom, validUntil: body.validUntil, addedById: request.authUser!.id
    };
    await prisma.$transaction(async (tx) => {
      await tx.plateGroupMember.createMany({ data: unique(body.groupIds).map((groupId) => ({ ...common, groupId })) });
    });
    await audit(request, "PLATE_CREATED", { objectType: "Plate", objectId: normalized, newValue: { ...common, groupIds: unique(body.groupIds) } });
    for (const groupId of unique(body.groupIds)) await audit(request, "PLATE_ADDED_TO_GROUP", { objectType: "PlateGroupMember", objectId: normalized, metadata: { groupId } });
    const members = await prisma.plateGroupMember.findMany({ where: { normalizedLicensePlate: normalized }, include: memberInclude });
    return reply.code(201).send({ plate: plateResponse(members) });
  });

  app.get("/plates/:normalized", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (request, reply) => {
    const { normalized } = plateParams.parse(request.params);
    const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(request.query);
    const [members, count, first, last, observations, cameras, colors, types] = await Promise.all([
      prisma.plateGroupMember.findMany({ where: { normalizedLicensePlate: normalized }, include: memberInclude, orderBy: { group: { name: "asc" } } }),
      prisma.passage.count({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } } }),
      prisma.passage.findFirst({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } }, orderBy: { timestamp: "asc" }, select: { timestamp: true } }),
      prisma.passage.findFirst({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } }, orderBy: { timestamp: "desc" }, select: { timestamp: true, displayLicensePlate: true } }),
      prisma.passage.findMany({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } }, orderBy: [{ timestamp: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit, select: {
        id: true, timestamp: true, timezone: true, displayLicensePlate: true, vehicleColor: true, vehicleType: true,
        vehicleImage1ObjectId: true, plateImageObjectId: true, source: true, direction: true,
        camera: { select: { id: true, name: true, historicalName: true, location: true, vpnLocation: { select: { timezone: true } } } }
      } }),
      prisma.passage.findMany({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } }, distinct: ["cameraId"], select: { camera: { select: { id: true, name: true, historicalName: true, location: true, vpnLocation: { select: { timezone: true } } } } } }),
      prisma.passage.findMany({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } }, distinct: ["vehicleColor"], select: { vehicleColor: true } }),
      prisma.passage.findMany({ where: { normalizedLicensePlate: normalized, status: { not: "DELETED" } }, distinct: ["vehicleType"], select: { vehicleType: true } })
    ]);
    if (!members.length && count === 0) return reply.code(404).send({ error: "PLATE_NOT_FOUND", message: "Dit kenteken is niet gevonden." });
    return {
      plate: members.length ? plateResponse(members) : {
        normalizedLicensePlate: normalized, displayLicensePlate: last?.displayLicensePlate ?? displayLicensePlate(normalized), groups: []
      },
      observations: observations.map(historicalCamera), page: query.page, limit: query.limit, total: count,
      firstSeenAt: first?.timestamp ?? null, lastSeenAt: last?.timestamp ?? null,
      cameras: cameras.map((item) => historicalCamera(item).camera), colors: colors.map((item) => item.vehicleColor), types: types.map((item) => item.vehicleType)
    };
  });

  app.patch("/plates/:normalized", { preHandler: requirePermission(PERMISSIONS.PLATES_MANAGE) }, async (request, reply) => {
    const { normalized: current } = plateParams.parse(request.params);
    const body = plateUpdate.parse(request.body);
    const existing = await prisma.plateGroupMember.findMany({ where: { normalizedLicensePlate: current }, include: memberInclude });
    if (!existing.length) return reply.code(404).send({ error: "PLATE_NOT_FOUND", message: "Dit kenteken bestaat niet (meer)." });
    const normalized = body.licensePlate ? normalizeLicensePlate(body.licensePlate) : current;
    if (normalized !== current && await prisma.plateGroupMember.findFirst({ where: { normalizedLicensePlate: normalized }, select: { id: true } })) {
      return reply.code(409).send({ error: "PLATE_EXISTS", message: "Het gewijzigde kenteken bestaat al." });
    }
    const groupIds = unique(body.groupIds ?? existing.map((member) => member.groupId));
    const groups = await resolveGroups(groupIds);
    if (!groups) return reply.code(400).send({ error: "GROUP_NOT_FOUND", message: "Een gekozen groep bestaat niet (meer)." });
    const first = existing[0]!;
    const reason = body.reason === undefined ? first.reason : body.reason || null;
    const validFrom = body.validFrom === undefined ? first.validFrom : body.validFrom;
    const validUntil = body.validUntil === undefined ? first.validUntil : body.validUntil;
    if (validFrom && validUntil && validUntil < validFrom) return reply.code(400).send({ error: "INVALID_VALIDITY", message: "Geldig tot moet na geldig vanaf liggen." });
    if (reasonMissing(groups, reason)) return reply.code(400).send({ error: "REASON_REQUIRED", message: "Vul een reden in voor een signaleringsgroep." });
    const oldGroupIds = existing.map((member) => member.groupId);
    const removed = oldGroupIds.filter((id) => !groupIds.includes(id));
    const added = groupIds.filter((id) => !oldGroupIds.includes(id));
    const common = {
      normalizedLicensePlate: normalized,
      displayLicensePlate: body.licensePlate ? displayLicensePlate(body.licensePlate) : first.displayLicensePlate,
      description: body.description === undefined ? first.description : body.description || null,
      note: body.note === undefined ? first.note : body.note || null, reason,
      active: body.active ?? first.active, validFrom, validUntil
    };
    await prisma.$transaction(async (tx) => {
      if (removed.length) await tx.plateGroupMember.deleteMany({ where: { normalizedLicensePlate: current, groupId: { in: removed } } });
      await tx.plateGroupMember.updateMany({ where: { normalizedLicensePlate: current, groupId: { in: groupIds } }, data: common });
      if (added.length) await tx.plateGroupMember.createMany({ data: added.map((groupId) => ({ ...common, groupId, addedById: request.authUser!.id })) });
    });
    await audit(request, "PLATE_UPDATED", { objectType: "Plate", objectId: normalized, oldValue: plateResponse(existing), newValue: { ...common, groupIds } });
    for (const groupId of added) await audit(request, "PLATE_ADDED_TO_GROUP", { objectType: "PlateGroupMember", objectId: normalized, metadata: { groupId } });
    for (const groupId of removed) await audit(request, "PLATE_REMOVED_FROM_GROUP", { objectType: "PlateGroupMember", objectId: normalized, metadata: { groupId } });
    const members = await prisma.plateGroupMember.findMany({ where: { normalizedLicensePlate: normalized }, include: memberInclude });
    return { plate: plateResponse(members) };
  });

  app.delete("/plates/:normalized", { preHandler: requirePermission(PERMISSIONS.PLATES_MANAGE) }, async (request, reply) => {
    const { normalized } = plateParams.parse(request.params);
    const existing = await prisma.plateGroupMember.findMany({ where: { normalizedLicensePlate: normalized }, include: memberInclude });
    if (!existing.length) return reply.code(204).send();
    await prisma.plateGroupMember.deleteMany({ where: { normalizedLicensePlate: normalized } });
    await audit(request, "PLATE_DELETED", { objectType: "Plate", objectId: normalized, oldValue: plateResponse(existing) });
    for (const member of existing) await audit(request, "PLATE_REMOVED_FROM_GROUP", { objectType: "PlateGroupMember", objectId: normalized, metadata: { groupId: member.groupId } });
    return reply.code(204).send();
  });
}
