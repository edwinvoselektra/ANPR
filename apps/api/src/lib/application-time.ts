import { localDay } from "@anpr/shared";
import { config } from "../config.js";
export const APPLICATION_TIME_ZONE = config.PLATFORM_TIMEZONE;
export const applicationDay = (now=new Date()) => localDay(now,APPLICATION_TIME_ZONE);
