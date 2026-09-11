import type { FastifyReply, FastifyRequest } from "fastify";
import { hashToken } from "./crypto.js";
import { prisma } from "./prisma.js";

export const SESSION_COOKIE = "anpr_session";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return reply.code(401).send({ error: "AUTH_REQUIRED", message: "Log eerst in." });
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } }
  });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(401).send({ error: "SESSION_INVALID", message: "Je sessie is verlopen. Log opnieuw in." });
  }
  const roles = session.user.roles.map(({ role }) => role.name);
  const permissions = [...new Set(session.user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.key)))];
  request.authUser = {
    id: session.user.id, email: session.user.email, username: session.user.username,
    displayName: session.user.displayName, roles, permissions, sessionId: session.id
  };
  void prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
}

export function isAuthorized(userPermissions: readonly string[] | undefined, permission: string, roles: readonly string[] = []): boolean {
  return roles.some(role => role === "ADMIN" || role === "Administrator") || Boolean(userPermissions?.includes(permission));
}

export function requirePermission(permission: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply);
    if (reply.sent) return;
    if (!isAuthorized(request.authUser?.permissions, permission, request.authUser?.roles)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "Je hebt geen toestemming voor deze actie." });
    }
  };
}
