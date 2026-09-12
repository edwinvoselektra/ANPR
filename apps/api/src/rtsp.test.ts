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
  it("accepteert metadata zonder gedecodeerd frame niet als video", async () => {
    const test = await testRtsp("rtsp://camera/stream", true, vi.fn().mockResolvedValue(result()));
    expect(test).toMatchObject({ success: false, code: "NO_DECODED_VIDEO", snapshot: { code: "DEPENDENCY_FAILED" } });
  });
  it("meldt een frametimeout als mislukte video en slaat snapshot over", async () => {
    const test = await testRtsp("rtsp://camera/stream", true, vi.fn().mockResolvedValue(result({code:null,timedOut:true,stdout:Buffer.alloc(0)})));
    expect(test).toMatchObject({success:false,code:"TIMEOUT",snapshot:{code:"DEPENDENCY_FAILED"}});
  });
  it("geeft een veilige authenticatiefout voor video en snapshot", async () => {
    const execute = vi.fn().mockResolvedValue(result({ code: 1, stderr: "401 Unauthorized", stdout: Buffer.alloc(0) }));

    const test = await testRtsp("rtsp://camera/stream", true, execute);

    expect(test).toMatchObject({
      success: false,
      code: "AUTHENTICATION_FAILED",
      rtspVideo: { status: "FAILED", code: "AUTHENTICATION_FAILED" },
      snapshot: { status: "UNAVAILABLE", code: "DEPENDENCY_FAILED" }
    });
    expect(JSON.stringify(test)).not.toContain("rtsp://camera/stream");
  });

  it("wijst een niet-bestaande stream op channel, subtype of RTSP-pad", async () => {
    const execute = vi.fn().mockResolvedValue(result({ code: 1, stderr: "method DESCRIBE failed: 404 Not Found", stdout: Buffer.alloc(0) }));

    const test = await testRtsp("rtsp://camera/stream", true, execute);

    expect(test).toMatchObject({ success: false, code: "STREAM_NOT_FOUND" });
    expect(test.rtspVideo.message).toContain("channel en subtype");
  });

  it("slaat snapshotcontrole expliciet over wanneer deze niet is gevraagd", async () => {
    const execute = vi.fn().mockResolvedValue(result({stdout:Buffer.from([0xff,0xd8,0xff,0xd9])}));

    const test = await testRtsp("rtsp://camera/stream", false, execute);

    expect(test).toMatchObject({
      success: true,
      rtspVideo: { status: "SUCCESS" },
      snapshot: { status: "NOT_REQUESTED" }
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
