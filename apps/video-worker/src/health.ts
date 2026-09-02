import { createServer, type Server } from "node:http";
import { VIDEO_WORKER_HEARTBEAT_KEY } from "@anpr/shared";
import type { Redis } from "ioredis";

export type WorkerState = { managedCameras: number; running: boolean; lastDatabaseRefreshAt?: string };

export function startHealthServer(port: number, state: () => WorkerState): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ status: "not_found" }));
    }
    const current = state();
    response.writeHead(current.running ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ status: current.running ? "ok" : "degraded", service: "video-worker", ...current, timestamp: new Date().toISOString() }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

export async function publishHeartbeat(redis: Redis, state: WorkerState) {
  await redis.set(VIDEO_WORKER_HEARTBEAT_KEY, JSON.stringify({ ...state, timestamp: new Date().toISOString() }), "EX", 20);
}
