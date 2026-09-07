import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { authRoutes } from "./routes/auth.js";
import { cameraRoutes } from "./routes/cameras.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { healthRoutes } from "./routes/health.js";
import { simulatorRoutes } from "./routes/simulator.js";
import { passageRoutes } from "./routes/passages.js";
import { hitRoutes } from "./routes/hits.js";
import { plateGroupRoutes } from "./routes/plate-groups.js";
import { plateRoutes } from "./routes/plates.js";
import { searchRoutes } from "./routes/search.js";
import { userRoutes } from "./routes/users.js";
import { notificationRoutes } from "./routes/notifications.js";
import { startNotificationDispatcher } from "./lib/notification-dispatcher.js";
import { locationRoutes } from "./routes/locations.js";
import { startLocationHealthChecks } from "./lib/location-health.js";

export function buildServer() {
  const app = Fastify({ logger: { redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.privateKey", "req.body.rtspUrl", "req.body.username", "req.body.endpoint", "req.body.keys", "req.body.p256dh", "req.body.auth"] }, bodyLimit: 1_048_576, trustProxy: true });
  void app.register(cookie);
  void app.register(helmet, { contentSecurityPolicy: false });
  void app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.addHook("onRequest", async (request, reply) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.cookie) {
      const origin = request.headers.origin;
      if (origin && origin !== config.WEB_ORIGIN) return reply.code(403).send({ error: "INVALID_ORIGIN", message: "Ongeldige aanvraagbron." });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const candidateCode = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code : undefined;
    if (candidateCode === "FST_ERR_CTP_EMPTY_JSON_BODY" || candidateCode === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return reply.code(400).send({ error: "INVALID_JSON", message: "De aanvraag bevat geen geldige gegevens. Probeer het opnieuw." });
    }
    if (error instanceof ZodError) return reply.code(400).send({ error: "VALIDATION_ERROR", message: "Controleer de ingevulde gegevens.", fields: error.flatten().fieldErrors });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = error.meta?.target;
        const targetsName = Array.isArray(target) ? target.includes("name") : typeof target === "string" && target.includes("name");
        if (request.url.startsWith("/cameras") && targetsName) {
          const message = "Er bestaat al een camera met deze naam. Kies een andere cameranaam of bewerk de bestaande camera.";
          return reply.code(409).send({ error: "CAMERA_NAME_ALREADY_EXISTS", message, fields: { name: [message] } });
        }
        if (request.url.startsWith("/locations") && targetsName) {
          const message = "Er bestaat al een locatie met deze naam. Kies een andere locatienaam.";
          return reply.code(409).send({ error: "LOCATION_NAME_ALREADY_EXISTS", message, fields: { name: [message] } });
        }
        return reply.code(409).send({ error: "DUPLICATE", message: "Deze waarde bestaat al." });
      }
      if (error.code === "P2003" && request.method === "DELETE" && request.url.startsWith("/cameras/")) {
        return reply.code(409).send({ error: "CAMERA_HAS_HISTORY", message: "Deze camera heeft historische passages of hits en kan voor behoud van historie alleen worden uitgeschakeld." });
      }
      if (error.code === "P2025") return reply.code(404).send({ error: "NOT_FOUND", message: "Het gevraagde onderdeel bestaat niet." });
    }
    const candidateStatus = typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode?: unknown }).statusCode : undefined;
    const status = typeof candidateStatus === "number" ? candidateStatus : 500;
    const safeMessage = error instanceof Error ? error.message : "Ongeldige aanvraag.";
    if (status >= 500) app.log.error({ err: error }, "Onverwachte API-fout");
    return reply.code(status).send({ error: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message: status >= 500 ? "Er ging intern iets mis." : safeMessage });
  });

  void app.register(healthRoutes);
  void app.register(authRoutes);
  void app.register(userRoutes);
  void app.register(cameraRoutes);
  void app.register(dashboardRoutes);
  void app.register(simulatorRoutes);
  void app.register(passageRoutes);
  void app.register(plateGroupRoutes);
  void app.register(plateRoutes);
  void app.register(hitRoutes);
  void app.register(searchRoutes);
  void app.register(notificationRoutes);
  void app.register(locationRoutes);
  return app;
}

const executedFile = process.argv[1];
if (executedFile && fileURLToPath(import.meta.url) === resolve(executedFile)) {
  const app = buildServer();
  let stopNotifications: () => void = () => undefined;
  let stopLocationHealth: () => void = () => undefined;
  const shutdown = async () => { stopNotifications(); stopLocationHealth(); await app.close(); await prisma.$disconnect(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  try { await app.listen({ host: "0.0.0.0", port: config.API_PORT }); stopNotifications = startNotificationDispatcher(app.log); stopLocationHealth=startLocationHealthChecks(); }
  catch (error) { app.log.error(error); await prisma.$disconnect(); process.exit(1); }
}
