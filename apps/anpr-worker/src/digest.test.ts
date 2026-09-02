import { describe, expect, it } from "vitest";
import { createDigestAuthorization } from "./digest.js";
import { redactPlate } from "./credentials.js";

describe("Digest-authenticatie en logging",()=>{
  it("bouwt een Digest header zonder wachtwoord",()=>{
    const header=createDigestAuthorization({challenge:'Digest realm="camera", nonce="abc", qop="auth", algorithm=MD5',method:"GET",uri:"/events",username:"operator",password:"super-secret",cnonce:"fixed"});
    expect(header).toContain("Digest username=\"operator\"");expect(header).not.toContain("super-secret");
  });
  it("redigeert kentekens in productielogs",()=>expect(redactPlate("12-ABC-3")).toBe("<REDACTED>"));
});
