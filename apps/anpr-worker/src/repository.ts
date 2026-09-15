import type { PrismaClient } from "@prisma/client";
import type { CameraRepository } from "./types.js";

export function createCameraRepository(prisma: PrismaClient): CameraRepository {
  return {
    listEnabled: () => prisma.camera.findMany({
      where: { active: true, isDraft: false, archivedAt: null, anprProvider: "DAHUA_CGI" },
      select: {
        vpnLocation: {select:{timezone:true}}, id: true, name: true, location: true, direction: true, directionMapping: true, rtspHost: true,
        rtspUsernameEncrypted: true, rtspPasswordEncrypted: true, anprProvider: true,
        anprHttpProtocol: true, anprHttpPort: true, anprChannel: true, updatedAt: true
      }, orderBy: { id: "asc" }
    }),
    async markConnecting(id) {
      await prisma.camera.updateMany({ where: { id, active: true, isDraft: false, archivedAt: null, anprProvider: "DAHUA_CGI" }, data: { anprConnectionStatus: "CONNECTING" } });
    },
    async markConnected(id, at) {
      await prisma.camera.updateMany({ where: { id, active: true, isDraft: false, archivedAt: null, anprProvider: "DAHUA_CGI" }, data: {
        anprConnectionStatus: "CONNECTED", lastAnprConnectionAt: at, lastAnprErrorCode: null, lastAnprError: null
      } });
    },
    async markDisconnected(id, code, message) {
      await prisma.camera.updateMany({ where: { id, active: true, isDraft: false, archivedAt: null, anprProvider: "DAHUA_CGI" }, data: {
        anprConnectionStatus: code === "STREAM_DISCONNECTED" ? "DISCONNECTED" : "ERROR", lastAnprErrorCode: code, lastAnprError: message
      } });
    },
    async markDisabled(id) {
      await prisma.camera.updateMany({ where: { id, OR: [{ active: false }, { anprProvider: "NONE" }] }, data: { anprConnectionStatus: "DISABLED" } });
    }
  };
}
