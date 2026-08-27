import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("Prisma-datamodel", () => {
  it.each(["User", "Role", "Permission", "UserSession", "Camera", "CameraZone", "Passage", "Vehicle", "PlateDetection", "PlateGroup", "PlateGroupMember", "Hit", "Notification", "PushSubscription", "AuditLog", "SystemSetting", "RetentionException"])("bevat model %s", (model) => {
    expect(schema).toContain(`model ${model} {`);
  });
  it("slaat afbeeldingen alleen als object-ID op", () => {
    expect(schema).not.toMatch(/Bytes/);
    expect(schema).toContain("vehicleImage1ObjectId");
  });
});
