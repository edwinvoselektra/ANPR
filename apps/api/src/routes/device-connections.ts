import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { credentialsForDahua, DahuaTcpProvider } from "../lib/device-connections.js";
import { prisma } from "../lib/prisma.js";

const inputSchema = z.object({
  host: z.string().trim().min(1).max(253), port: z.coerce.number().int().min(1).max(65535).default(37777),
  username: z.string().max(200).optional(), password: z.string().max(500).optional(),
  category: z.enum(["CAMERA", "NVR", "AUTO"]).default("AUTO")
});
const paramsSchema = z.object({ id: z.string().uuid() });
const provider = new DahuaTcpProvider();

function persistedResult(result: Awaited<ReturnType<DahuaTcpProvider["test"]>>) {
  return {
    status: result.status, detectedCategory: result.category === "UNKNOWN" || result.category === "AUTO" ? null : result.category,
    model: result.model, firmware: result.firmware, serialNumber: result.serialNumber,
    channelCount: result.channels.length || undefined, channels: result.channels, capabilities: result.capabilities,
    lastTestAt: new Date(), lastSuccessAt: result.success ? new Date() : undefined, lastErrorCode: result.code ?? null
  };
}

export async function deviceConnectionRoutes(app: FastifyInstance) {
  app.post("/device-connections/dahua/test", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE), config:{rateLimit:{max:10,timeWindow:"1 minute"}} }, async (request) => {
    return provider.test(inputSchema.parse(request.body));
  });

  app.post("/device-connections/:id/test", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE), config:{rateLimit:{max:10,timeWindow:"1 minute"}} }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const connection = await prisma.deviceConnection.findUniqueOrThrow({ where: { id } });
    const result = await provider.test({ host: connection.host, port: connection.port, category: connection.requestedCategory, ...credentialsForDahua(connection) });
    await prisma.deviceConnection.update({ where: { id }, data: persistedResult(result) });
    await audit(request, "DEVICE_CONNECTION_TESTED", { objectType: "DeviceConnection", objectId: id, metadata: { type: connection.type, success: result.success, code: result.code } });
    return result;
  });
}
