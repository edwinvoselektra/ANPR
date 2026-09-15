import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({sessionUpdate:vi.fn(),audit:vi.fn()}));
vi.mock("../lib/prisma.js",()=>({prisma:{userSession:{update:mocks.sessionUpdate}}}));
vi.mock("../lib/audit.js",()=>({audit:mocks.audit}));
vi.mock("../lib/auth.js",()=>({SESSION_COOKIE:"anpr_session",authenticate:async(request:any)=>{request.authUser={id:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222",roles:["ADMIN"],permissions:[]}}}));
import { authRoutes, sessionPolicy } from "./auth.js";

afterEach(()=>vi.clearAllMocks());

describe("login session policy", () => {
  const now = Date.parse("2026-09-15T10:00:00.000Z");

  it("uses a persistent seven-day session by default", () => {
    const policy = sessionPolicy(true, now);
    expect(policy.expiresAt.toISOString()).toBe("2026-09-22T10:00:00.000Z");
    expect(policy.cookieExpiry).toEqual(policy.expiresAt);
  });

  it("uses a browser-session cookie when remembering is disabled", () => {
    const policy = sessionPolicy(false, now);
    expect(policy.expiresAt.toISOString()).toBe("2026-09-15T22:00:00.000Z");
    expect(policy.cookieExpiry).toBeUndefined();
  });
});

it("revokes the server session and clears the cookie on logout",async()=>{
  mocks.sessionUpdate.mockResolvedValue({});
  const app=Fastify();
  await app.register(cookie);
  await app.register(authRoutes);
  const response=await app.inject({method:"POST",url:"/auth/logout",headers:{cookie:"anpr_session=opaque-token"}});
  expect(response.statusCode).toBe(200);
  expect(mocks.sessionUpdate).toHaveBeenCalledWith({where:{id:"22222222-2222-4222-8222-222222222222"},data:{revokedAt:expect.any(Date)}});
  expect(response.headers["set-cookie"]).toContain("anpr_session=;");
  await app.close();
});
