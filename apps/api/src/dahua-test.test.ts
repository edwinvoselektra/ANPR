import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { testDahua } from "./lib/dahua-test.js";

describe("authenticated native Dahua probe", () => {
  it.each(["wrong-password", "public-200", "html", "multipart"])("handles %s without false green", async mode => {
    const server = createServer((req, res) => {
      if (mode === "public-200") { res.writeHead(200, {"Content-Type":"multipart/x-mixed-replace; boundary=test"}); res.end(); return; }
      if (!req.headers.authorization || mode === "wrong-password") { res.writeHead(401, {"WWW-Authenticate": 'Digest realm="camera", nonce="test", qop="auth"'}); res.end(); return; }
      res.writeHead(200, {"Content-Type":mode === "html" ? "text/html" : "multipart/x-mixed-replace; boundary=test"}); res.end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as {port:number};
      const result = await testDahua({host:"127.0.0.1",port:address.port,protocol:"http",channel:1,username:"test",password:"test"});
      expect(result.success).toBe(mode === "multipart");
      if (mode === "wrong-password") expect(result.code).toBe("AUTHENTICATION_FAILED");
      if (mode === "public-200") expect(result.code).toBe("AUTH_NOT_VERIFIED");
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
