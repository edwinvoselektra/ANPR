import type { CameraDirection, VehicleColor, VehicleType } from "@prisma/client";
import type { CameraSourceDirection } from "./index.js";

export type EventImage = { contentType: "image/jpeg"; data: Buffer };
export type NormalizedAnprEvent = {
  cameraId: string;
  occurredAt: Date;
  originalPlate: string;
  normalizedPlate: string;
  plateCountry?: string;
  confidence?: number;
  vehicleType?: VehicleType;
  vehicleColor?: VehicleColor;
  vehicleBrand?: string;
  direction?: CameraDirection;
  sourceDirection?: CameraSourceDirection;
  lane?: number;
  location?: string;
  overviewImage?: EventImage;
  plateImage?: EventImage;
  extraImage?: EventImage;
  source: "DAHUA_CAMERA";
  sourceEventId?: string;
  rawMetadata?: Record<string, string | number | boolean>;
};

export type ProviderLogger = {
  info(message: string, cameraName?: string): void;
  warn(message: string, cameraName?: string): void;
  error(message: string): void;
};

