import { calendarDate, nextCalendarDate, localToUtc, resolveTimeZone, searchTimeWindows } from "@anpr/shared";
import { config } from "../config.js";
import { historicalCamera } from "../lib/historical-camera.js";
import type { CameraDirection, VehicleColor, VehicleType } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeLicensePlate, PERMISSIONS } from "@anpr/shared";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const colors = ["BLACK", "WHITE", "GRAY", "SILVER", "RED", "BLUE", "GREEN", "YELLOW", "BROWN", "ORANGE", "OTHER", "UNKNOWN"] as const;
const types = ["CAR", "VAN", "TRUCK", "MOTORCYCLE", "BUS", "TRAILER", "UNKNOWN"] as const;
const directions = ["INCOMING", "OUTGOING", "UNKNOWN", "BOTH"] as const;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

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
    const camera=query.cameraId?await prisma.camera.findUnique({where:{id:query.cameraId},select:{vpnLocation:{select:{timezone:true}}}}):null;
    const timeZone=resolveTimeZone(camera?.vpnLocation?.timezone,config.PLATFORM_TIMEZONE);
    const dateAt=(date:string,time:string,edge:"start"|"end"="start")=>localToUtc(date,time,timeZone,edge);
    const dateString=(date:Date)=>calendarDate(date,timeZone);
    const now = new Date();
    const defaultFrom = dateString(new Date(now.getTime() - 14 * 86_400_000));
    const dateFrom = query.dateFrom ?? defaultFrom;
    const dateTo = query.dateTo ?? dateString(now);
    if (dateFrom > dateTo) return reply.code(400).send({ error: "DATE_RANGE_INVALID", message: "Datum tot moet op of na datum vanaf liggen." });
    let windows: Array<{ timestamp: { gte: Date; lte: Date } }> | undefined;
    try {
      windows = query.timeFrom && query.timeTo ? searchTimeWindows(dateFrom, dateTo, query.timeFrom, query.timeTo,timeZone) : undefined;
      dateAt(dateFrom,"00:00");dateAt(dateTo,"23:59","end");
    } catch {
      return reply.code(400).send({ error: "DATE_RANGE_TOO_LARGE", message: "Kies geldige lokale tijden en bij tijdvensters maximaal 92 dagen. Een tijd die door zomertijd niet bestaat is niet geldig." });
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
      direction: query.direction==="UNKNOWN"?{in:["UNKNOWN","BOTH"] as CameraDirection[]}:query.direction as CameraDirection | undefined,
      timestamp: windows ? undefined : {
        gte: dateAt(dateFrom, "00:00"),
        lte: new Date(dateAt(nextCalendarDate(dateTo), "00:00").getTime() - 1)
      },
      OR: windows,
      hits: hitFilter
    };
    const select = {
      id: true, displayLicensePlate: true, normalizedLicensePlate: true, timestamp: true, timezone: true, location: true,
      direction: true, vehicleColor: true, vehicleType: true, vehicleImage1ObjectId: true,
      plateImageObjectId: true, isHit: true, source: true, camera: { select: { id: true, name: true, historicalName: true, location: true, vpnLocation: { select: { timezone: true } } } }
    } as const;
    const [passages, total] = await Promise.all([
      prisma.passage.findMany({ where, select, orderBy: [{ timestamp: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.passage.count({ where })
    ]);
    return reply.header("Cache-Control", "private, no-store").send({ passages: passages.map(historicalCamera), page: query.page, limit: query.limit, total, timeZone, timeZonePolicy: query.cameraId?"CAMERA_LOCATION":"PLATFORM_DEFAULT" });
  });
}
