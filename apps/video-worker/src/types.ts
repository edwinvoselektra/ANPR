export type ManagedCamera = {
  id: string;
  name: string;
  location: string;
  rtspProtocol: string;
  rtspHost: string | null;
  rtspPort: number;
  rtspPath: string | null;
  rtspUsernameEncrypted: string | null;
  rtspPasswordEncrypted: string | null;
  updatedAt: Date;
};

export type CaptureResult =
  | { success: true; snapshotObjectId: string; responseTimeMs: number }
  | { success: false; code: string; message: string; responseTimeMs: number };

export type WorkerLogger = {
  info(message: string, cameraName?: string): void;
  warn(message: string, cameraName?: string): void;
  error(message: string): void;
};

export type CameraRepository = {
  listActive(): Promise<ManagedCamera[]>;
  markOnline(cameraId: string, snapshotObjectId: string, attemptedAt: Date): Promise<void>;
  markOffline(cameraId: string, code: string, message: string, attemptedAt: Date): Promise<void>;
  markDisabled(cameraId: string): Promise<void>;
};
