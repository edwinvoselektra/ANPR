import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { requirePermission } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";

const password = z.string().min(12, "Gebruik minimaal 12 tekens.").max(200)
  .refine((value) => /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value), "Gebruik kleine letters, hoofdletters en cijfers.");
const createSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase()),
  username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/).transform((v) => v.toLowerCase()),
  displayName: z.string().trim().min(2).max(100), password, roleIds: z.array(z.string().uuid()).min(1)
});
const updateSchema = z.object({ displayName: z.string().trim().min(2).max(100).optional(), active: z.boolean().optional(), password: password.optional(), roleIds: z.array(z.string().uuid()).min(1).optional() });

const select = { id: true, email: true, username: true, displayName: true, active: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } } } as const;

export async function userRoutes(app: FastifyInstance) {
  const guard = requirePermission(PERMISSIONS.USERS_MANAGE);
  app.get("/users", { preHandler: guard }, async () => ({ users: await prisma.user.findMany({ select, orderBy: { displayName: "asc" } }) }));
  app.get("/roles", { preHandler: guard }, async () => ({ roles: await prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } }) }));

  app.post("/users", { preHandler: guard }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const user = await prisma.user.create({ data: {
      email: body.email, username: body.username, displayName: body.displayName,
      passwordHash: await bcrypt.hash(body.password, 12), roles: { create: body.roleIds.map((roleId) => ({ roleId })) }
    }, select });
    await audit(request, "USER_CREATED", { objectType: "User", objectId: user.id, newValue: { email: user.email, username: user.username, roleIds: body.roleIds } });
    return reply.code(201).send({ user });
  });

  app.patch("/users/:id", { preHandler: guard }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    if (id === request.authUser!.id && body.active === false) throw Object.assign(new Error("Je kunt je eigen account niet uitschakelen."), { statusCode: 400 });
    const before = await prisma.user.findUniqueOrThrow({ where: { id }, select });
    const user = await prisma.$transaction(async (tx) => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: body.roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      return tx.user.update({ where: { id }, data: {
        displayName: body.displayName, active: body.active,
        passwordHash: body.password ? await bcrypt.hash(body.password, 12) : undefined
      }, select });
    });
    if (body.active === false) await prisma.userSession.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
    await audit(request, "USER_UPDATED", { objectType: "User", objectId: id, oldValue: before, newValue: user });
    return { user };
  });
}
