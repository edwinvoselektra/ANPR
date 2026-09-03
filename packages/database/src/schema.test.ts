import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("Prisma-datamodel", () => {
  it.each(["User", "Role", "Permission", "UserSession", "Camera", "CameraZone", "Passage", "Vehicle", "PlateDetection", "PlateGroup", "PlateGroupMember", "Hit", "HitGroup", "Notification", "PushSubscription", "AuditLog", "SystemSetting", "RetentionException"])("bevat model %s", (model) => {
    expect(schema).toContain(`model ${model} {`);
  });
  it("slaat afbeeldingen alleen als object-ID op", () => {
    expect(schema).not.toMatch(/Bytes/);
    expect(schema).toContain("vehicleImage1ObjectId");
  });
  it("houdt de cameranaam uniek op databaseniveau", () => {
    expect(schema).toMatch(/model Camera \{[\s\S]*?name\s+String\s+@unique/);
  });
  it("beschermt historische passages en hits tegen cascade-delete van een camera", () => {
    expect(schema).toMatch(/model Passage \{[\s\S]*?camera\s+Camera\s+@relation\([^\n]*onDelete: Restrict\)/);
    expect(schema).toMatch(/model Hit \{[\s\S]*?camera\s+Camera\s+@relation\([^\n]*onDelete: Restrict\)/);
  });
  it("ondersteunt providerstatus, Dahua-bron en idempotente events", () => {
    expect(schema).toContain("enum CameraAnprProvider");
    expect(schema).toContain("DAHUA_CAMERA");
    expect(schema).toContain("anprConnectionStatus");
    expect(schema).toContain("@@unique([cameraId, source, sourceEventId])");
  });
  it("bewaart één hit per passage met meerdere gekoppelde groepen", () => {
    expect(schema).toMatch(/model Hit \{[\s\S]*?@@unique\(\[passageId\]\)/);
    expect(schema).toMatch(/model HitGroup \{[\s\S]*?@@id\(\[hitId, groupId\]\)/);
    expect(schema).toMatch(/model PlateGroup \{[\s\S]*?hitEnabled\s+Boolean/);
  });
});
