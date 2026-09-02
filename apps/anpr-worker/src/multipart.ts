import type { IncomingMessage } from "node:http";

export type MultipartPart = { headers: Record<string, string>; body: Buffer };

export function boundaryFromContentType(value?: string): string {
  const match = value?.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) throw new Error("MULTIPART_BOUNDARY_INVALID");
  return boundary;
}

function parseHeaders(input: string) {
  const headers: Record<string, string> = {};
  for (const line of input.split("\r\n")) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

export async function consumeMultipart(response: IncomingMessage, options: {
  maxPartBytes: number; signal: AbortSignal; onPart: (part: MultipartPart) => Promise<void>;
}) {
  const boundary = boundaryFromContentType(response.headers["content-type"]);
  const marker = Buffer.from(`--${boundary}`);
  let buffer = Buffer.alloc(0);
  for await (const value of response) {
    if (options.signal.aborted) return;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > options.maxPartBytes + 65_536) throw new Error("EVENT_PART_TOO_LARGE");
    while (true) {
      const start = buffer.indexOf(marker);
      if (start < 0) break;
      if (start > 0) buffer = buffer.subarray(start);
      const headerStart = marker.length + 2;
      if (buffer.length < headerStart || buffer.subarray(marker.length, headerStart).toString() !== "\r\n") break;
      const headerEnd = buffer.indexOf("\r\n\r\n", headerStart);
      if (headerEnd < 0) break;
      const headers = parseHeaders(buffer.subarray(headerStart, headerEnd).toString("utf8"));
      const declared = Number(headers["content-length"]);
      if (!Number.isInteger(declared) || declared < 0 || declared > options.maxPartBytes) throw new Error("EVENT_PART_LENGTH_INVALID");
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + declared) break;
      const body = Buffer.from(buffer.subarray(bodyStart, bodyStart + declared));
      buffer = buffer.subarray(bodyStart + declared);
      if (buffer.subarray(0, 2).toString() === "\r\n") buffer = buffer.subarray(2);
      await options.onPart({ headers, body });
    }
  }
}
