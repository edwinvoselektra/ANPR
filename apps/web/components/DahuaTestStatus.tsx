export type DahuaTestResult = {
  success: boolean;
  tcpPortOpen: boolean;
  networkStatus: "REACHABLE" | "UNREACHABLE";
  deviceApi: "CONFIRMED" | "NOT_CONFIRMED" | "NOT_SUPPORTED" | "UNKNOWN";
  authentication: "SUCCESS" | "FAILED" | "NOT_TESTED";
  model?: string;
  firmware?: string;
  channels?: unknown[];
  message: string;
};

function Row({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "success" | "error" | "warning" | "neutral" }) {
  return <div><span>{label}</span><strong className={`test-status ${tone}`}>{value}</strong></div>;
}

export function DahuaTestStatus({ result }: { result?: DahuaTestResult }) {
  const device = !result
    ? { value: "Onbekend", tone: "neutral" as const }
    : result.deviceApi === "CONFIRMED"
      ? { value: "Bevestigd", tone: "success" as const }
      : result.deviceApi === "NOT_CONFIRMED"
        ? { value: "Niet bevestigd", tone: "warning" as const }
        : result.deviceApi === "NOT_SUPPORTED"
          ? { value: "Niet ondersteund", tone: "error" as const }
          : { value: "Onbekend", tone: "neutral" as const };
  const authentication = !result || result.authentication === "NOT_TESTED"
    ? { value: "Niet getest", tone: "neutral" as const }
    : result.authentication === "SUCCESS"
      ? { value: "Geslaagd", tone: "success" as const }
      : { value: "Mislukt", tone: "error" as const };
  const metadataConfirmed = result?.deviceApi === "CONFIRMED" && result.authentication === "SUCCESS";

  return (
    <>
      <div className="summary connection-test-summary">
        <Row label="Netwerk / TCP-poort" value={!result ? "Niet getest" : result.tcpPortOpen ? "Bereikbaar" : "Niet bereikbaar"} tone={result?.tcpPortOpen ? "success" : result ? "error" : "neutral"} />
        <Row label="Dahua apparaat/API" {...device} />
        <Row label="Authenticatie" {...authentication} />
      </div>
      {result ? <div className={result.success ? "alert success" : result.tcpPortOpen && result.deviceApi === "NOT_CONFIRMED" ? "alert info" : "alert error"}>{result.message}</div> : null}
      {metadataConfirmed ? (
        <div className="summary">
          <Row label="Model" value={result.model ?? "Niet opgegeven door apparaat"} />
          <Row label="Firmware" value={result.firmware ?? "Niet opgegeven door apparaat"} />
          <Row label="Kanalen" value={String(result.channels?.length ?? 0)} />
        </div>
      ) : null}
    </>
  );
}
