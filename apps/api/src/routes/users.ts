import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
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

const roleSelection = { select: { id: true, name: true, permissions: { select: { permission: { select: { key: true } } } } } } as const;
const select = { id: true, email: true, username: true, displayName: true, active: true, lastLoginAt: true, createdAt: true,
  roles: { select: { role: roleSelection } } } as const;

type RoleRecord = { id: string; name: string; permissions: Iterable<{ permission: { key: string } }> };
type UserRecord = { id: string; email: string; username: string; displayName: string; active: boolean;
  lastLoginAt: Date | null; createdAt: Date; roles: Iterable<{ role: RoleRecord }> };

// Een "administrator" is hier een gebruiker met de permission users.manage; daarmee is de
// bescherming databasegedreven en niet afhankelijk van een hardcoded rolnaam.
const activeAdminFilter = {
  active: true, roles: { some: { role: { permissions: { some: { permission: { key: PERMISSIONS.USERS_MANAGE } } } } } }
} as const;

function grantsAdmin(role: RoleRecord): boolean {
  return [...role.permissions].some(({ permission }) => permission.key === PERMISSIONS.USERS_MANAGE);
}

function isAdminUser(user: Pick<UserRecord, "roles">): boolean {
  return [...user.roles].some(({ role }) => grantsAdmin(role));
}

function publicUser(user: UserRecord, adminIds?: ReadonlySet<string>) {
  const admin = isAdminUser(user);
  return {
    id: user.id, email: user.email, username: user.username, displayName: user.displayName,
    active: user.active, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt, isAdmin: admin,
    lastActiveAdmin: Boolean(adminIds && admin && user.active && adminIds.size === 1 && adminIds.has(user.id)),
    roles: [...user.roles].map(({ role }) => ({ role: { id: role.id, name: role.name } }))
  };
}

async function activeAdminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: activeAdminFilter, select: { id: true } });
  return admins.map((admin) => admin.id);
}

async function resolveRoles(roleIds: string[]) {
  const uniqueIds = [...new Set(roleIds)];
  const found = await prisma.role.findMany({ where: { id: { in: uniqueIds } }, select: roleSelection });
  return found.length === uniqueIds.length ? found as RoleRecord[] : null;
}

export async function userRoutes(app: FastifyInstance) {
  const guard = requirePermission(PERMISSIONS.USERS_MANAGE);
  app.get("/users", { preHandler: guard }, async () => {
    const [users, admins] = await Promise.all([
      prisma.user.findMany({ select, orderBy: { displayName: "asc" } }),
      prisma.user.findMany({ where: activeAdminFilter, select: { id: true } })
    ]);
    const adminIds = new Set(admins.map((admin) => admin.id));
    return { users: users.map((user) => publicUser(user as UserRecord, adminIds)) };
  });
  app.get("/roles", { preHandler: guard }, async () => ({ roles: await prisma.role.findMany({ include: { permissions: { include: { permission: true } } }, orderBy: { name: "asc" } }) }));

  app.post("/users", { preHandler: guard }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const roles = await resolveRoles(body.roleIds);
    if (!roles) return reply.code(400).send({ error: "ROLE_NOT_FOUND", message: "Een van de gekozen rollen bestaat niet." });
    const user = await prisma.user.create({ data: {
      email: body.email, username: body.username, displayName: body.displayName,
      passwordHash: await bcrypt.hash(body.password, 12), roles: { create: body.roleIds.map((roleId) => ({ roleId })) }
    }, select });
    await audit(request, "USER_CREATED", { objectType: "User", objectId: user.id, newValue: { email: user.email, username: user.username, roleIds: body.roleIds } });
    return reply.code(201).send({ user: publicUser(user as UserRecord) });
  });

  app.patch("/users/:id", { preHandler: guard }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);
    const target = await prisma.user.findUnique({ where: { id }, select });
    if (!target) return reply.code(404).send({ error: "USER_NOT_FOUND", message: "Gebruiker niet gevonden." });
    if (id === request.authUser!.id && body.active === false)
      return reply.code(400).send({ error: "SELF_DISABLE", message: "Je kunt je eigen account niet uitschakelen." });

    let chosenRoles: RoleRecord[] | undefined;
    if (body.roleIds) {
      chosenRoles = await resolveRoles(body.roleIds) ?? undefined;
      if (!chosenRoles) return reply.code(400).send({ error: "ROLE_NOT_FOUND", message: "Een van de gekozen rollen bestaat niet." });
    }

    // Bescherm de laatste actieve administrator tegen uitschakelen of degradatie naar Operator.
    const staysActive = body.active ?? target.active;
    const staysAdmin = body.roleIds ? chosenRoles!.some(grantsAdmin) : isAdminUser(target as UserRecord);
    if (target.active && isAdminUser(target as UserRecord) && (!staysActive || !staysAdmin)) {
      const others = (await activeAdminIds()).filter((adminId) => adminId !== id);
      if (others.length === 0) return reply.code(409).send({ error: "LAST_ACTIVE_ADMIN", message: "De laatste actieve administrator kan niet worden uitgeschakeld of gedegradeerd. Maak eerst een andere administrator aan of activeer die." });
    }

    const before = publicUser(target as UserRecord);
    const passwordHash = body.password ? await bcrypt.hash(body.password, 12) : undefined;
    const user = await prisma.$transaction(async (tx) => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: body.roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      return tx.user.update({ where: { id }, data: {
        displayName: body.displayName, active: body.active, passwordHash
      }, select });
    });
    const now = new Date();
    if (body.active === false) {
      await prisma.userSession.updateMany({ where: { userId: id }, data: { revokedAt: now } });
    } else if (body.password) {
      // Na een wachtwoordreset door een admin worden alle actieve sessies ingetrokken; bij een
      // reset van het eigen account blijft de huidige sessie bewust werken.
      await prisma.userSession.updateMany({ where: { userId: id, revokedAt: null,
        ...(id === request.authUser!.id ? { id: { not: request.authUser!.sessionId } } : {}) }, data: { revokedAt: now } });
    }
    const after = await prisma.user.findUnique({ where: { id }, select });
    await audit(request, "USER_UPDATED", { objectType: "User", objectId: id,
      oldValue: before, newValue: after ? publicUser(after as UserRecord) : undefined });
    if (body.password) await audit(request, "USER_PASSWORD_RESET", { objectType: "User", objectId: id, metadata: { self: id === request.authUser!.id } });
    return { user: publicUser((after ?? user) as UserRecord) };
  });

  app.delete("/users/:id", { preHandler: guard }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    if (id === request.authUser!.id)
      return reply.code(400).send({ error: "SELF_DELETE", message: "Je kunt je eigen account niet verwijderen. Laat een andere administrator dit doen." });
    const target = await prisma.user.findUnique({ where: { id }, select });
    if (!target) return reply.code(404).send({ error: "USER_NOT_FOUND", message: "Gebruiker niet gevonden." });
    if (target.active && isAdminUser(target as UserRecord)) {
      const others = (await activeAdminIds()).filter((adminId) => adminId !== id);
      if (others.length === 0) return reply.code(409).send({ error: "LAST_ACTIVE_ADMIN", message: "De laatste actieve administrator kan niet worden verwijderd. Maak eerst een andere administrator aan." });
    }
    try {
      // Hard delete: sessies, rollen en pushabonnementen cascade mee; auditlogs en
      // "toegevoegd door"-verwijzingen blijven bestaan met SetNull (zie docs/architecture.md).
      await prisma.user.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003")
        return reply.code(409).send({ error: "USER_HAS_HISTORY", message: "Deze gebruiker is gekoppeld aan historische gegevens (zoals retentie-uitzonderingen) en kan daarom alleen worden uitgeschakeld." });
      throw error;
    }
    await audit(request, "USER_DELETED", { objectType: "User", objectId: id,
      oldValue: publicUser(target as UserRecord), metadata: { email: target.email, username: target.username } });
    return reply.code(204).send();
  });
}
