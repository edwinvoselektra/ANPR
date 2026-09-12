import { historicalCamera } from "./historical-camera.js";
export const hitGroupSelect = { id: true, name: true, color: true, icon: true } as const;
// Historical Hit/HitGroup records are authoritative, even after a rule is disabled or removed.
export function publicHit(hit: any) {
  const groups = hit.groups?.length ? hit.groups.map((link: any) => ({ ...link.group, reason: link.reason })) : hit.group ? [{ ...hit.group, reason: hit.reason }] : [];
  return { ...historicalCamera(hit), groups };
}
