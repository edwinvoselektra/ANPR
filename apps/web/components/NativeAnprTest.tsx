"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";

type Result = { success: boolean; authenticated: boolean; apiAvailable: boolean; code: string; message: string };
export function NativeAnprTest({ connection }: { connection: Record<string, unknown> }) {
  const [result, setResult] = useState<{ fingerprint: string; value: Result }>();
  const [busy, setBusy] = useState(false);
  const fingerprint = JSON.stringify(connection);
  const latest = useRef(fingerprint);
  latest.current = fingerprint;
  const current = result?.fingerprint === fingerprint ? result.value : undefined;
  const test = async () => {
    setBusy(true);
    try {
      const value = await api<Result>("/cameras/test-anpr", { method: "POST", body: fingerprint });
      if (latest.current === fingerprint) setResult({ fingerprint, value });
    } catch (error) {
      if (latest.current === fingerprint) setResult({ fingerprint, value: { success: false, authenticated: false, apiAvailable: false, code: "REQUEST_FAILED", message: error instanceof Error ? error.message : "Test mislukt." } });
    } finally { setBusy(false); }
  };
  return <div className="field full">
    <p>Native Dahua ANPR gebruikt de camera voor kentekenherkenning. RTSP verzorgt video en snapshots. De HTTP-interface hergebruikt de camera-inloggegevens.</p>
    <button type="button" className="button secondary" disabled={busy} onClick={test}>{busy ? "ANPR-interface testen…" : "ITSAPI / ANPR testen"}</button>
    <div className="summary" aria-live="polite">
      <p>Dahua API: {current ? current.apiAvailable ? "Beschikbaar" : "Niet bevestigd" : "Niet getest"}</p>
      <p>Authenticatie: {current ? current.authenticated ? "Geslaagd" : "Niet geslaagd" : "Niet getest"}</p>
      <p>ANPR events: {current ? current.success ? "Beschikbaar" : "Mislukt / niet ondersteund" : "Niet getest"}</p>
      {current && <p className={current.success ? "alert" : "alert error"}>{current.message}</p>}
    </div>
  </div>;
}
