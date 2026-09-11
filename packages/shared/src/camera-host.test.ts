import { describe, expect, it } from "vitest";
import { normalizeCameraHost } from "./index.js";
describe("camera host", () => {
  it.each(["192.168.178.248", "http://192.168.178.248/", "https://192.168.178.248/", "rtsp://192.168.178.248"])("normalizes %s", input => expect(normalizeCameraHost(input)).toBe("192.168.178.248"));
  it.each(["http://user:secret@camera/", "camera/path", "camera?password=secret", "camera:554", "file:///camera", "", "999.999.999.999"])("rejects %s", input => expect(() => normalizeCameraHost(input)).toThrow());
});
