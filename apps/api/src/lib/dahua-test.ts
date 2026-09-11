import { openDigestStream, dahuaEventPath } from "@anpr/shared/dahua";

export async function testDahua(input: { host: string; protocol: "http" | "https"; port: number; channel: number; username?: string; password?: string }, open = openDigestStream) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let authenticated = false;
  let apiAvailable = false;
  try {
    const response = await open({ ...input, path: dahuaEventPath(input.channel), signal: controller.signal, timeoutMs: 10_000, requireAuthentication: true });
    authenticated = true;
    apiAvailable = true;
    const contentType = response.headers["content-type"] ?? "";
    response.destroy();
    if (!/^multipart\/x-mixed-replace\s*;/i.test(contentType) || !/boundary\s*=\s*(?:"[^"\r\n]{1,200}"|[^;\s]{1,200})/i.test(contentType)) {
      return { success: false, authenticated, apiAvailable, code: "ANPR_UNSUPPORTED", message: "Authenticatie geslaagd, maar geen ondersteunde ANPR-eventstream gevonden." };
    }
    return { success: true, authenticated, apiAvailable, code: "ANPR_AVAILABLE", message: "Authenticatie geslaagd; de native Dahua-eventstream is beschikbaar. Een echte passage moet kentekenherkenning nog bevestigen." };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const systemCode = (error as NodeJS.ErrnoException)?.code ?? "";
    const code = controller.signal.aborted || raw === "CONNECT_TIMEOUT" ? "TIMEOUT"
      : /CERT|TLS|SSL|SELF_SIGNED/.test(systemCode) ? "TLS_ERROR"
      : /^(AUTH_[A-Z_]+|AUTHENTICATION_FAILED|HTTP_\d+)$/.test(raw) ? raw : "CONNECTION_FAILED";
    const message = code === "AUTHENTICATION_FAILED" ? "Authenticatie mislukt. Controleer gebruikersnaam en wachtwoord."
      : code === "AUTH_NOT_VERIFIED" ? "De camera vraagt geen authenticatie; het wachtwoord kon niet worden gecontroleerd."
      : code === "TIMEOUT" ? "Time-out tijdens de verbinding met de Dahua-interface."
      : code === "TLS_ERROR" ? "TLS/certificaatprobleem. Gebruik een geldig en vertrouwd cameracertificaat."
      : code === "HTTP_404" || code === "HTTP_501" ? "Geen ondersteunde ANPR-interface gevonden op deze camera."
      : code.startsWith("HTTP_") ? `De camera gaf HTTP-status ${code.slice(5)} terug.`
      : code.startsWith("AUTH_") ? "De authenticatiemethode van de camera wordt niet ondersteund."
      : "De camera is niet bereikbaar via de ingestelde Dahua HTTP-verbinding.";
    return { success: false, authenticated, apiAvailable, code, message };
  } finally { clearTimeout(timer); controller.abort(); }
}
