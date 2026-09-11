import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const schema = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("Prisma-datamodel", () => {
  it.each(["User", "Role", "Permission", "UserSession", "Camera", "CameraZone", "VpnLocation", "Recorder", "DeviceConnection", "Passage", "Vehicle", "PlateDetection", "PlateGroup", "PlateGroupMember", "Hit", "HitGroup", "Notification", "PushSubscription", "NotificationPreference", "NotificationPreferenceGroup", "AuditLog", "SystemSetting", "RetentionException"])("bevat model %s", (model) => {
    expect(schema).toContain(`model ${model} {`);
  });
  it("koppelt camera's optioneel en veilig aan locatie en recorder",()=>{expect(schema).toMatch(/locationId\s+String\?/);expect(schema).toMatch(/vpnLocation\s+VpnLocation\?\s+@relation\([^\n]*onDelete: Restrict\)/);expect(schema).toMatch(/recorder\s+Recorder\?\s+@relation\([^\n]*onDelete: Restrict\)/)});
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
  it("ondersteunt een additieve Dahua TCP-transportlaag naast RTSP",()=>{
    expect(schema).toContain("enum DeviceConnectionType");
    expect(schema).toContain("DAHUA_TCP_SDK");
    expect(schema).toMatch(/model DeviceConnection \{[\s\S]*?port\s+Int\s+@default\(37777\)/);
    expect(schema).toMatch(/@@unique\(\[cameraId, type\]\)/);
    expect(schema).toMatch(/@@unique\(\[recorderId, type\]\)/);
  });
  it("bewaart één hit per passage met meerdere gekoppelde groepen", () => {
    expect(schema).toMatch(/model Hit \{[\s\S]*?@@unique\(\[passageId\]\)/);
    expect(schema).toMatch(/model HitGroup \{[\s\S]*?@@id\(\[hitId, groupId\]\)/);
    expect(schema).toMatch(/model PlateGroup \{[\s\S]*?hitEnabled\s+Boolean/);
  });
});
