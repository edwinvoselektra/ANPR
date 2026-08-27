import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server.js";

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe("API integratie", () => {
  it("geeft een publieke liveness-healthcheck", async () => {
    app = buildServer();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", service: "anpr-api" });
  });

  it("beschermt de gebruikers-API", async () => {
    app = buildServer();
    const response = await app.inject({ method: "GET", url: "/users" });
    expect(response.statusCode).toBe(401);
  });
});
