import type { CameraDirection, VehicleColor, VehicleType } from "@prisma/client";

export type ManagedAnprCamera = {
  id: string;
  name: string;
  location: string;
  direction: CameraDirection;
  rtspHost: string | null;
  rtspUsernameEncrypted: string | null;
  rtspPasswordEncrypted: string | null;
  anprProvider: "NONE" | "DAHUA_CGI" | "DAHUA_ITSAPI";
  anprHttpProtocol: string;
  anprHttpPort: number;
  anprChannel: number;
  updatedAt: Date;
};

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
  lane?: number;
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

export interface AnprEventProvider {
  readonly kind: Exclude<ManagedAnprCamera["anprProvider"], "NONE">;
  connect(camera: ManagedAnprCamera, handlers: {
    onConnected: () => Promise<void>;
    onEvent: (event: NormalizedAnprEvent) => Promise<void>;
  }, signal: AbortSignal): Promise<void>;
}

export type CameraRepository = {
  listEnabled(): Promise<ManagedAnprCamera[]>;
  markConnecting(id: string): Promise<void>;
  markConnected(id: string, at: Date): Promise<void>;
  markDisconnected(id: string, code: string, message: string): Promise<void>;
  markDisabled(id: string): Promise<void>;
};
