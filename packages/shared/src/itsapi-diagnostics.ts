/** Privacy-safe diagnostics contract: these fields never contain camera payload values. */
export type ItsapiSchemaViolation = {
  path: string; reason: string; received?: string; expected?: string;
  minimum?: number; maximum?: number; inclusive?: boolean;
};
export type ItsapiDiagnosticMessage = {
  id: string; kind: string; httpStatus: number | null; errorCode: string;
  firstReceivedAt: string; lastReceivedAt: string; expiresAt: string; attempts: number;
  capturedAt: string | null; deviceIdentityVerified: boolean;
  violations: ItsapiSchemaViolation[]; shape: unknown | null;
};
export type ItsapiStructureReport = {
  camera: { id: string; name: string; configVersion: number };
  capture: { active: boolean; until: string | null; startedAt: string | null; serverTime: string };
  lastRequestAt: string | null; lastHeartbeatAt: string | null; lastSuccessfulEventAt: string | null;
  messages: ItsapiDiagnosticMessage[];
};
