import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const optionalIcon = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  z.string().trim().max(40).regex(/^[a-zA-Z0-9_-]+$/).nullish()
);

const groupBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Gebruik een geldige hexkleur.").default("#dc2626"),
  icon: optionalIcon,
  active: z.boolean().default(true),
  hitEnabled: z.boolean().default(false),
  reasonRequired: z.boolean().default(false)
});
const groupUpdate = groupBody.partial();
const idParams = z.object({ id: z.string().uuid() });

const select = {
  id: true, name: true, description: true, color: true, icon: true, active: true,
  hitEnabled: true, reasonRequired: true, createdAt: true, updatedAt: true,
  _count: { select: { members: true } }
} as const;

async function duplicateName(name: string, excludeId?: string) {
  return prisma.plateGroup.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, id: excludeId ? { not: excludeId } : undefined },
    select: { id: true }
  });
}

export async function plateGroupRoutes(app: FastifyInstance) {
  app.get("/plate-groups", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async () => ({
    groups: await prisma.plateGroup.findMany({ select, orderBy: [{ active: "desc" }, { name: "asc" }] })
  }));

  app.post("/plate-groups", { preHandler: requirePermission(PERMISSIONS.PLATES_MANAGE) }, async (request, reply) => {
    const body = groupBody.parse(request.body);
    if (await duplicateName(body.name)) return reply.code(409).send({ error: "GROUP_NAME_EXISTS", message: "Er bestaat al een groep met deze naam." });
    const group = await prisma.plateGroup.create({ data: {
      ...body, description: body.description || null, icon: body.icon || null, pushNotifications: false
    }, select });
    await audit(request, "PLATE_GROUP_CREATED", { objectType: "PlateGroup", objectId: group.id, newValue: group });
    return reply.code(201).send({ group });
  });

  app.patch("/plate-groups/:id", { preHandler: requirePermission(PERMISSIONS.PLATES_MANAGE) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const body = groupUpdate.parse(request.body);
    const existing = await prisma.plateGroup.findUnique({ where: { id }, select });
    if (!existing) return reply.code(404).send({ error: "GROUP_NOT_FOUND", message: "De groep bestaat niet (meer)." });
    if (body.name && await duplicateName(body.name, id)) return reply.code(409).send({ error: "GROUP_NAME_EXISTS", message: "Er bestaat al een groep met deze naam." });
    const group = await prisma.plateGroup.update({ where: { id }, data: {
      ...body,
      description: body.description === undefined ? undefined : body.description || null,
      icon: body.icon === undefined ? undefined : body.icon || null
    }, select });
    await audit(request, "PLATE_GROUP_UPDATED", { objectType: "PlateGroup", objectId: id, oldValue: existing, newValue: group });
    return { group };
  });

  app.delete("/plate-groups/:id", { preHandler: requirePermission(PERMISSIONS.PLATES_MANAGE) }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const existing = await prisma.plateGroup.findUnique({ where: { id }, select });
    if (!existing) return reply.code(204).send();
    const members = await prisma.plateGroupMember.findMany({ where: { groupId: id }, select: { normalizedLicensePlate: true } });
    const hitCount = await prisma.hit.count({ where: { OR: [{ groupId: id }, { groups: { some: { groupId: id } } }] } });
    if (hitCount > 0) {
      await prisma.$transaction([
        prisma.plateGroup.update({ where: { id }, data: { active: false, hitEnabled: false } }),
        prisma.plateGroupMember.updateMany({ where: { groupId: id }, data: { active: false } })
      ]);
      await audit(request, "PLATE_GROUP_DELETED", { objectType: "PlateGroup", objectId: id, oldValue: existing, metadata: { retainedForHitHistory: true } });
      return reply.send({ deleted: false, deactivated: true, message: "De groep is gedeactiveerd en blijft alleen voor bestaande hithistorie bewaard." });
    }
    await prisma.plateGroup.delete({ where: { id } });
    await audit(request, "PLATE_GROUP_DELETED", { objectType: "PlateGroup", objectId: id, oldValue: existing });
    for (const member of members) await audit(request, "PLATE_REMOVED_FROM_GROUP", {
      objectType: "PlateGroupMember", objectId: member.normalizedLicensePlate, metadata: { groupId: id }
    });
    return reply.code(204).send();
  });
}
