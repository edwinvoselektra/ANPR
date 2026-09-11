export function historicalCamera<T extends { camera?: { name: string; historicalName?: string | null } | null }>(record: T): T {
  if (!record.camera?.historicalName) return record;
  return { ...record, camera: { ...record.camera, name: record.camera.historicalName } };
}
