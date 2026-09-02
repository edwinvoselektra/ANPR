import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { boundaryFromContentType, consumeMultipart } from "./multipart.js";

describe("begrensde multipart parser",()=>{
  it("leest parts op basis van Content-Length, ook over chunks",async()=>{const body="Events[0].Code=TrafficJunction";const wire=Buffer.from(`--test-boundary\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}\r\n--test-boundary--\r\n`);const response=Readable.from([wire.subarray(0,20),wire.subarray(20)]) as any;response.headers={"content-type":"multipart/x-mixed-replace; boundary=test-boundary"};const onPart=vi.fn();await consumeMultipart(response,{maxPartBytes:1000,signal:new AbortController().signal,onPart});expect(onPart).toHaveBeenCalledWith({headers:expect.objectContaining({"content-type":"text/plain"}),body:Buffer.from(body)})});
  it("weigert ongeldige boundaries en te grote parts",async()=>{expect(()=>boundaryFromContentType("text/plain")).toThrow("MULTIPART_BOUNDARY_INVALID");const response=Readable.from([Buffer.from("--x\r\nContent-Type: image/jpeg\r\nContent-Length: 999\r\n\r\n")]) as any;response.headers={"content-type":"multipart/x-mixed-replace; boundary=x"};await expect(consumeMultipart(response,{maxPartBytes:10,signal:new AbortController().signal,onPart:vi.fn()})).rejects.toThrow("EVENT_PART_LENGTH_INVALID")});
});
