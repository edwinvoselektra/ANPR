import { historicalCamera } from "../lib/historical-camera.js";
import type { CameraDirection, VehicleColor, VehicleType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeLicensePlate, PERMISSIONS } from "@anpr/shared";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const colors = ["BLACK", "WHITE", "GRAY", "SILVER", "RED", "BLUE", "GREEN", "YELLOW", "BROWN", "ORANGE", "OTHER", "UNKNOWN"] as const;
const types = ["CAR", "VAN", "TRUCK", "MOTORCYCLE", "BUS", "TRAILER", "UNKNOWN"] as const;
const directions = ["INCOMING", "OUTGOING", "BOTH"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const amsterdamParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function dateAt(date: string, time: string) {
  const intendedUtc = new Date(`${date}T${time}:00.000Z`);
  const parts = Object.fromEntries(amsterdamParts.formatToParts(intendedUtc).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  // Sommige ICU-locales schrijven middernacht als 24:00 op dezelfde kalenderdatum.
  // Voor offsetberekening betekent dit 00:00, niet de volgende dag.
  const hour = parts.hour === 24 ? 0 : parts.hour!;
  const representedLocal = Date.UTC(parts.year!, parts.month! - 1, parts.day!, hour, parts.minute!, parts.second!);
  return new Date(intendedUtc.getTime() - (representedLocal - intendedUtc.getTime()));
}
function dateString(date: Date) { return date.toISOString().slice(0, 10); }

function timeWindows(fromDate: string, toDate: string, fromTime: string, toTime: string) {
  // Gebruik kalenderdatums als UTC-tellers. `dateAt` geeft een echt UTC-tijdstip
  // terug en kan daardoor op de voorafgaande UTC-datum vallen (22:00 in de zomer).
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days < 1 || days > 92) throw new Error("SEARCH_DATE_RANGE");
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000);
    const from = dateAt(dateString(day), fromTime);
    const crossesMidnight = fromTime > toTime;
    const untilDay = crossesMidnight ? new Date(day.getTime() + 86_400_000) : day;
    const until = dateAt(dateString(untilDay), toTime);
    return { timestamp: { gte: from, lte: until } };
  });
}

export async function searchRoutes(app: FastifyInstance) {
  app.get("/search/passages", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (request, reply) => {
    const query = z.object({
      plate: z.string().max(20).optional(), color: z.enum(colors).optional(), type: z.enum(types).optional(),
      cameraId: z.string().uuid().optional(), location: z.string().trim().max(200).optional(),
      dateFrom: z.string().regex(datePattern).optional(), dateTo: z.string().regex(datePattern).optional(),
      timeFrom: z.string().regex(timePattern).optional(), timeTo: z.string().regex(timePattern).optional(),
      groupId: z.string().uuid().optional(), onlyHits: z.enum(["true", "false"]).default("false"), direction: z.enum(directions).optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(25)
    }).parse(request.query);
    if ((query.timeFrom && !query.timeTo) || (!query.timeFrom && query.timeTo)) return reply.code(400).send({ error: "TIME_RANGE_INCOMPLETE", message: "Vul zowel tijd vanaf als tijd tot in." });
    const now = new Date();
    const defaultFrom = dateString(new Date(now.getTime() - 14 * 86_400_000));
    const dateFrom = query.dateFrom ?? defaultFrom;
    const dateTo = query.dateTo ?? dateString(now);
    if (dateFrom > dateTo) return reply.code(400).send({ error: "DATE_RANGE_INVALID", message: "Datum tot moet op of na datum vanaf liggen." });
    let windows: Array<{ timestamp: { gte: Date; lte: Date } }> | undefined;
    try {
      windows = query.timeFrom && query.timeTo ? timeWindows(dateFrom, dateTo, query.timeFrom, query.timeTo) : undefined;
    } catch {
      return reply.code(400).send({ error: "DATE_RANGE_TOO_LARGE", message: "Kies bij zoeken op tijd een periode van maximaal 92 dagen." });
    }
    const hitFilter = query.groupId
      ? { some: { OR: [{ groupId: query.groupId }, { groups: { some: { groupId: query.groupId } } }] } }
      : query.onlyHits === "true" ? { some: {} } : undefined;
    const where = {
      status: { not: "DELETED" as const },
      normalizedLicensePlate: query.plate ? { contains: normalizeLicensePlate(query.plate) } : undefined,
      vehicleColor: query.color as VehicleColor | undefined,
      vehicleType: query.type as VehicleType | undefined,
      cameraId: query.cameraId,
      location: query.location ? { contains: query.location, mode: "insensitive" as const } : undefined,
      direction: query.direction as CameraDirection | undefined,
      timestamp: windows ? undefined : {
        gte: dateAt(dateFrom, "00:00"),
        lte: new Date(dateAt(dateTo, "23:59").getTime() + 59_999)
      },
      OR: windows,
      hits: hitFilter
    };
    const select = {
      id: true, displayLicensePlate: true, normalizedLicensePlate: true, timestamp: true, location: true,
      direction: true, vehicleColor: true, vehicleType: true, vehicleImage1ObjectId: true,
      plateImageObjectId: true, isHit: true, source: true, camera: { select: { id: true, name: true, historicalName: true, location: true } }
    } as const;
    const [passages, total] = await Promise.all([
      prisma.passage.findMany({ where, select, orderBy: [{ timestamp: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.passage.count({ where })
    ]);
    return reply.header("Cache-Control", "private, no-store").send({ passages: passages.map(historicalCamera), page: query.page, limit: query.limit, total });
  });
}
