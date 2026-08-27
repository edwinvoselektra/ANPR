import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.js";

function safeData(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const blocked = /password|secret|token|credential|rtsp/i;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !blocked.test(key))
    .map(([key, item]) => [key, typeof item === "object" ? safeData(item) : item]));
}

export async function audit(
  request: FastifyRequest,
  action: string,
  details: { objectType?: string; objectId?: string; oldValue?: unknown; newValue?: unknown; metadata?: unknown } = {}
) {
  await prisma.auditLog.create({ data: {
    actorId: request.authUser?.id,
    action,
    objectType: details.objectType,
    objectId: details.objectId,
    ipAddress: request.ip,
    oldValue: safeData(details.oldValue) as any,
    newValue: safeData(details.newValue) as any,
    metadata: safeData(details.metadata) as any
  }});
}
