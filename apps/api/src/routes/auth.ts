import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { authenticate, SESSION_COOKIE } from "../lib/auth.js";
import { hashToken, newSessionToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";

const loginSchema = z.object({ identifier: z.string().trim().min(2).max(254), password: z.string().min(1).max(200), remember: z.boolean().default(true) });

export function sessionPolicy(remember: boolean, now = Date.now()) {
  const expiresAt = new Date(now + (remember ? config.REMEMBER_SESSION_TTL_DAYS * 86_400_000 : config.SESSION_TTL_HOURS * 3_600_000));
  return { expiresAt, cookieExpiry: remember ? expiresAt : undefined };
}

export function sessionCookieOptions(cookieExpiry: Date | undefined, nodeEnv = config.NODE_ENV) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: nodeEnv === "production",
    ...(cookieExpiry ? { expires: cookieExpiry } : {})
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const identifier = body.identifier.toLowerCase();
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } }
    });
    const now = new Date();
    if (!user || !user.active || (user.lockedUntil && user.lockedUntil > now)) {
      await prisma.auditLog.create({ data: { action: "AUTH_LOGIN_FAILED", objectType: "User", objectId: user?.id, ipAddress: request.ip, metadata: { reason: "invalid_or_locked" } } });
      return reply.code(401).send({ error: "LOGIN_FAILED", message: "Inloggegevens onjuist of account tijdelijk geblokkeerd." });
    }
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      const attempts = user.failedLoginCount + 1;
      await prisma.user.update({ where: { id: user.id }, data: {
        failedLoginCount: attempts >= 5 ? 0 : attempts,
        lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null
      }});
      await prisma.auditLog.create({ data: { action: "AUTH_LOGIN_FAILED", objectType: "User", objectId: user.id, ipAddress: request.ip, metadata: { reason: "invalid_password" } } });
      return reply.code(401).send({ error: "LOGIN_FAILED", message: "Inloggegevens onjuist of account tijdelijk geblokkeerd." });
    }
    const token = newSessionToken();
    const { expiresAt, cookieExpiry } = sessionPolicy(body.remember);
    const session = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
      return tx.userSession.create({ data: {
        userId: user.id, tokenHash: hashToken(token), expiresAt, ipAddress: request.ip,
        userAgent: request.headers["user-agent"]?.slice(0, 500)
      }});
    });
    request.authUser = { id: user.id, email: user.email, username: user.username, displayName: user.displayName,
      roles: user.roles.map(({ role }) => role.name),
      permissions: [...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))],
      sessionId: session.id };
    await audit(request, "AUTH_LOGIN", { objectType: "User", objectId: user.id });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(cookieExpiry));
    return { user: request.authUser };
  });

  app.get("/auth/me", { preHandler: authenticate }, async (request) => ({ user: request.authUser }));

  app.get("/auth/sessions", { preHandler: authenticate }, async (request) => ({ sessions: await prisma.userSession.findMany({
    where: { userId: request.authUser!.id, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    orderBy: { lastSeenAt: "desc" }
  }) }));

  app.post("/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    await prisma.userSession.update({ where: { id: request.authUser!.sessionId }, data: { revokedAt: new Date() } });
    await audit(request, "AUTH_LOGOUT", { objectType: "UserSession", objectId: request.authUser!.sessionId });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { success: true };
  });

  app.post("/auth/logout-all", { preHandler: authenticate }, async (request, reply) => {
    await prisma.userSession.updateMany({ where: { userId: request.authUser!.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(request, "AUTH_LOGOUT_ALL", { objectType: "User", objectId: request.authUser!.id });
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { success: true };
  });
}
