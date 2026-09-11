import { describe, expect, it, vi } from "vitest";
import { testRtsp, type ProcessResult } from "./lib/rtsp.js";

const result = (overrides: Partial<ProcessResult> = {}): ProcessResult => ({
  code: 0,
  stderr: "",
  stdout: Buffer.from('{"streams":[{"codec_name":"h264"}]}'),
  timedOut: false,
  ...overrides
});

describe("gescheiden RTSP- en snapshotstatus", () => {
  it("meldt RTSP geslaagd maar snapshot niet beschikbaar bij een frametimeout", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result({ code: null, stdout: Buffer.alloc(0), timedOut: true }));

    const test = await testRtsp("rtsp://camera/stream", true, execute);

    expect(test).toMatchObject({
      success: true,
      rtspVideo: { status: "SUCCESS" },
      snapshot: { status: "UNAVAILABLE", code: "TIMEOUT" }
    });
    expect(test.snapshotObjectId).toBeUndefined();
  });

  it("geeft een veilige authenticatiefout voor video en snapshot", async () => {
    const execute = vi.fn().mockResolvedValue(result({ code: 1, stderr: "401 Unauthorized", stdout: Buffer.alloc(0) }));

    const test = await testRtsp("rtsp://camera/stream", true, execute);

    expect(test).toMatchObject({
      success: false,
      code: "AUTHENTICATION_FAILED",
      rtspVideo: { status: "FAILED", code: "AUTHENTICATION_FAILED" },
      snapshot: { status: "UNAVAILABLE", code: "AUTHENTICATION_FAILED" }
    });
    expect(JSON.stringify(test)).not.toContain("rtsp://camera/stream");
  });

  it("wijst een niet-bestaande stream op channel, subtype of RTSP-pad", async () => {
    const execute = vi.fn().mockResolvedValue(result({ code: 1, stderr: "method DESCRIBE failed: 404 Not Found", stdout: Buffer.alloc(0) }));

    const test = await testRtsp("rtsp://camera/stream", true, execute);

    expect(test).toMatchObject({ success: false, code: "STREAM_NOT_FOUND" });
    expect(test.snapshot.message).toContain("channel en subtype");
  });

  it("slaat snapshotcontrole expliciet over wanneer deze niet is gevraagd", async () => {
    const execute = vi.fn().mockResolvedValue(result());

    const test = await testRtsp("rtsp://camera/stream", false, execute);

    expect(test).toMatchObject({
      success: true,
      rtspVideo: { status: "SUCCESS" },
      snapshot: { status: "NOT_REQUESTED" }
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
