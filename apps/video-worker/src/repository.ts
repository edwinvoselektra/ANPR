import type { PrismaClient } from "@prisma/client";
import type { CameraRepository } from "./types.js";

export function createCameraRepository(prisma: PrismaClient): CameraRepository {
  return {
    listActive: () => prisma.camera.findMany({
      where: { active: true, rtspHost: { not: null } },
      select: {
        id: true, name: true, location: true, rtspProtocol: true, rtspHost: true, rtspPort: true,
        rtspPath: true, rtspUsernameEncrypted: true, rtspPasswordEncrypted: true, updatedAt: true
      },
      orderBy: { id: "asc" }
    }),
    async markOnline(cameraId, snapshotObjectId, attemptedAt) {
      await prisma.camera.updateMany({ where: { id: cameraId, active: true }, data: {
        status: "ONLINE", lastConnectionAt: attemptedAt, lastConnectionSuccessAt: attemptedAt,
        lastConnectionErrorCode: null, lastConnectionError: null, lastSnapshotObjectId: snapshotObjectId
      } });
    },
    async markOffline(cameraId, code, message, attemptedAt) {
      await prisma.camera.updateMany({ where: { id: cameraId, active: true }, data: {
        status: "OFFLINE", lastConnectionAt: attemptedAt, lastConnectionErrorCode: code, lastConnectionError: message
      } });
    },
    async markDisabled(cameraId) {
      await prisma.camera.updateMany({ where: { id: cameraId, active: false }, data: { status: "DISABLED" } });
    }
  };
}
