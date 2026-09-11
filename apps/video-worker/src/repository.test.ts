import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createCameraRepository } from "./repository.js";

describe("camera repository", () => {
  it("haalt uitsluitend actieve camera's met RTSP-transport dynamisch uit PostgreSQL", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { camera: { findMany } } as unknown as PrismaClient;
    const repository = createCameraRepository(prisma);

    await repository.listActive();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, rtspHost: { not: null } } }));
  });

  it("werkt camerastatus alleen bij wanneer de camera nog actief is", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { camera: { updateMany } } as unknown as PrismaClient;
    const repository = createCameraRepository(prisma);

    await repository.markOffline("camera-id", "TIMEOUT", "Veilige melding", new Date("2026-09-01T12:00:00Z"));

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "camera-id", active: true },
      data: expect.objectContaining({ status: "OFFLINE", lastConnectionErrorCode: "TIMEOUT", lastConnectionError: "Veilige melding" })
    }));
  });
});
