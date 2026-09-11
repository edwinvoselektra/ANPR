"use client";
import { NativeAnprTest } from "@/components/NativeAnprTest";

import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { DahuaTestStatus, type DahuaTestResult } from "@/components/DahuaTestStatus";
import type { VpnLocation } from "@/lib/locations";

type Point = { x: number; y: number };
type MediaCheck = {
  status: "SUCCESS" | "FAILED" | "AVAILABLE" | "UNAVAILABLE" | "NOT_REQUESTED";
  code?: string;
  message?: string;
};
type RtspTest = {
  success: boolean;
  responseTimeMs: number;
  code?: string;
  message?: string;
  snapshotObjectId?: string;
  rtspVideo: MediaCheck;
  snapshot: MediaCheck;
};
const nameConflictMessage = "Er bestaat al een camera met deze naam. Kies een andere cameranaam of bewerk de bestaande camera.";
const initial = {
  name: "",
  location: "",
  locationId: "",
  recorderId: "",
  description: "",
  direction: "INCOMING",
  latitude: "",
  longitude: "",
  primaryConnection: "RTSP",
  rtspEnabled: false,
  connectionMode: "FIELDS",
  rtspUrl: "",
  rtspHost: "",
  rtspPort: "554",
  rtspPath: "/",
  username: "",
  password: "",
  dahuaHost: "",
  dahuaPort: "37777",
  dahuaUsername: "",
  dahuaPassword: "",
  deviceCategory: "AUTO",
  active: true,
  anprProvider: "NONE",
  anprHttpProtocol: "http",
  anprHttpPort: "80",
  anprChannel: "1"
};

function StatusRow({ label, value, tone = "neutral", detail }: { label: string; value: string; tone?: "success" | "error" | "warning" | "neutral"; detail?: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={`test-status ${tone}`}>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export default function CameraWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initial);
  const [locations, setLocations] = useState<VpnLocation[]>([]);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceTest, setDeviceTest] = useState<DahuaTestResult>();
  const [rtspTest, setRtspTest] = useState<RtspTest>();
  const [zone, setZone] = useState<Point[]>([]);
  const [start, setStart] = useState<Point>();
  const area = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ locations: VpnLocation[] }>("/locations")
      .then((data) => {
        setLocations(data.locations);
        const query = new URLSearchParams(window.location.search);
        const locationId = query.get("locationId") ?? "";
        const recorderId = query.get("recorderId") ?? "";
        const selected = data.locations.find((item) => item.id === locationId);
        const channel = query.get("channel");
        const host = query.get("host") ?? "";
        setForm((current) => ({
          ...current,
          locationId,
          recorderId,
          location: selected?.name ?? current.location,
          rtspHost: host || current.rtspHost,
          dahuaHost: host || current.dahuaHost,
          rtspPort: query.get("port") ?? current.rtspPort,
          anprChannel: channel ?? current.anprChannel,
          rtspPath: channel ? `/cam/realmonitor?channel=${channel}&subtype=0` : current.rtspPath
        }));
      })
      .catch(() => undefined);
  }, []);

  const selectLocation = (locationId: string) => {
    const selected = locations.find((item) => item.id === locationId);
    setForm((current) => ({ ...current, locationId, recorderId: "", location: selected?.name ?? current.location }));
  };
  const set = (key: string, value: unknown) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "name") {
      setNameError("");
      if (error === nameConflictMessage) setError("");
    }
  };
  const setConnection = (key: string, value: unknown) => {
    set(key, value);
    setDeviceTest(undefined);
    setRtspTest(undefined);
    setZone([]);
  };

  const connection = useMemo(() => ({
    connectionMode: form.connectionMode,
    rtspUrl: form.rtspUrl || undefined,
    rtspHost: form.rtspHost || form.dahuaHost || undefined,
    rtspPort: Number(form.rtspPort),
    rtspPath: form.rtspPath || undefined,
    username: form.username || form.dahuaUsername || undefined,
    password: form.password || form.dahuaPassword || undefined
  }), [form]);
  const dahuaConnection = useMemo(() => ({
    host: form.dahuaHost,
    port: Number(form.dahuaPort),
    username: form.dahuaUsername || undefined,
    password: form.dahuaPassword || undefined,
    category: form.deviceCategory
  }), [form.dahuaHost, form.dahuaPort, form.dahuaUsername, form.dahuaPassword, form.deviceCategory]);
  const rtspConfigured = form.primaryConnection === "RTSP" || form.rtspEnabled;
  const snapshotAvailable = rtspTest?.snapshot.status === "AVAILABLE" && Boolean(rtspTest.snapshotObjectId);

  const validate = () => {
    if (step === 1 && (!form.name.trim() || !form.location.trim())) return "Vul minimaal cameranaam en locatie in.";
    if (step === 2 && form.primaryConnection === "RTSP" && rtspTest?.rtspVideo.status !== "SUCCESS") return "Test eerst de RTSP-videostream succesvol.";
    if (step === 2 && form.primaryConnection === "DAHUA_TCP_SDK" && !deviceTest?.tcpPortOpen) return "Test eerst de Dahua TCP-verbinding.";
    return "";
  };

  const next = async () => {
    const issue = validate();
    if (issue) {
      setError(issue);
      return;
    }
    if (step === 1) {
      setBusy(true);
      try {
        const result = await api<{ available: boolean }>(`/cameras/name-availability?name=${encodeURIComponent(form.name.trim())}`);
        if (!result.available) {
          setNameError(nameConflictMessage);
          setError(nameConflictMessage);
          return;
        }
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "De cameranaam kon niet worden gecontroleerd. Probeer het opnieuw.");
        return;
      } finally {
        setBusy(false);
      }
    }
    setError("");
    setStep((current) => Math.min(5, current + 1));
  };

  const testDeviceConnection = async () => {
    setBusy(true);
    setError("");
    setDeviceTest(undefined);
    try {
      const result = await api<DahuaTestResult>("/device-connections/dahua/test", { method: "POST", body: JSON.stringify(dahuaConnection) });
      setDeviceTest(result);
      if (!result.tcpPortOpen || result.authentication === "FAILED" || result.deviceApi === "NOT_SUPPORTED") setError(result.message ?? "Device/API-test mislukt.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Device/API-test mislukt.");
    } finally {
      setBusy(false);
    }
  };

  const testRtspConnection = async (snapshotOnly = false) => {
    setBusy(true);
    setError("");
    try {
      const result = await api<RtspTest>(snapshotOnly ? "/cameras/test-snapshot" : "/cameras/test-connection", {
        method: "POST",
        body: JSON.stringify(connection)
      });
      setRtspTest(result);
      if (result.rtspVideo.status === "FAILED") setError(result.rtspVideo.message ?? "RTSP-videotest mislukt.");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : snapshotOnly ? "Snapshot ophalen mislukt." : "RTSP-videotest mislukt.");
    } finally {
      setBusy(false);
    }
  };

  const point = (event: PointerEvent) => {
    const rect = area.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    };
  };
  const down = (event: PointerEvent) => {
    if (!snapshotAvailable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const selected = point(event);
    setStart(selected);
    setZone([selected, selected]);
  };
  const move = (event: PointerEvent) => {
    if (!start || !snapshotAvailable) return;
    setZone([start, point(event)]);
  };
  const up = () => setStart(undefined);
  const box = zone.length === 2 ? {
    left: `${Math.min(zone[0]!.x, zone[1]!.x) * 100}%`,
    top: `${Math.min(zone[0]!.y, zone[1]!.y) * 100}%`,
    width: `${Math.abs(zone[1]!.x - zone[0]!.x) * 100}%`,
    height: `${Math.abs(zone[1]!.y - zone[0]!.y) * 100}%`
  } : undefined;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const points = zone.length === 2 ? [zone[0], { x: zone[1]!.x, y: zone[0]!.y }, zone[1], { x: zone[0]!.x, y: zone[1]!.y }] : undefined;
      const body = {
        ...connection,
        primaryConnection: form.primaryConnection,
        rtspEnabled: rtspConfigured,
        dahuaTcp: form.primaryConnection === "DAHUA_TCP_SDK" ? dahuaConnection : undefined,
        name: form.name,
        location: form.location,
        locationId: form.locationId || null,
        recorderId: form.recorderId || null,
        description: form.description || undefined,
        direction: form.direction,
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        active: form.active,
        anprProvider: form.anprProvider,
        anprHttpProtocol: form.anprHttpProtocol,
        anprHttpPort: Number(form.anprHttpPort),
        anprChannel: Number(form.anprChannel),
        zone: points ? { type: "RECTANGLE", points } : undefined
      };
      const created = await api<{ camera: { id: string } }>("/cameras", { method: "POST", body: JSON.stringify(body) });
      if (rtspConfigured && rtspTest?.rtspVideo.status === "SUCCESS") await api(`/cameras/${created.camera.id}/test`, { method: "POST" });
      router.push("/cameras");
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "CAMERA_NAME_ALREADY_EXISTS") {
        const message = caught.fields?.name?.[0] ?? nameConflictMessage;
        setNameError(message);
        setError(message);
        setStep(1);
      } else {
        setError(caught instanceof ApiError ? caught.message : "Camera opslaan mislukt. Probeer het opnieuw.");
      }
    } finally {
      setBusy(false);
    }
  };

  const rtspStatus = !rtspConfigured
    ? { value: "Niet ingesteld", tone: "neutral" as const }
    : !rtspTest
      ? { value: "Niet getest", tone: "neutral" as const }
      : rtspTest.rtspVideo.status === "SUCCESS"
        ? { value: "Geslaagd", tone: "success" as const, detail: `${rtspTest.responseTimeMs} ms` }
        : { value: "Mislukt", tone: "error" as const, detail: rtspTest.rtspVideo.message };
  const snapshotStatus = !rtspConfigured
    ? { value: "Niet beschikbaar", tone: "neutral" as const, detail: "RTSP is niet ingesteld." }
    : snapshotAvailable
      ? { value: "Beschikbaar", tone: "success" as const }
      : rtspTest?.snapshot.status === "NOT_REQUESTED"
        ? { value: "Niet getest", tone: "neutral" as const, detail: "Gebruik ‘Snapshot opnieuw ophalen’ om één frame op te halen." }
        : { value: "Niet beschikbaar", tone: rtspTest ? "error" as const : "neutral" as const, detail: rtspTest?.snapshot.message };
  const anprStatus = form.anprProvider === "NONE"
    ? { value: "Niet ingesteld", tone: "neutral" as const }
    : { value: "Onbekend", tone: "warning" as const, detail: "De eventverbinding start na opslaan; controleer daarna de camerastatus." };

  const connectionStatuses = (
    <>
      {form.primaryConnection === "DAHUA_TCP_SDK" ? <DahuaTestStatus result={deviceTest} /> : <div className="summary connection-test-summary"><StatusRow label="Dahua apparaat/API" value="Niet ingesteld" /></div>}
      <div className="summary connection-test-summary">
        <StatusRow label="RTSP video" {...rtspStatus} />
        <StatusRow label="Snapshot" {...snapshotStatus} />
        <StatusRow label="ANPR events" {...anprStatus} />
      </div>
    </>
  );

  const rtspFields = (
    <>
      <div className="mode-select">
        <button type="button" className={form.connectionMode === "FIELDS" ? "active" : ""} onClick={() => setConnection("connectionMode", "FIELDS")}>
          <strong>Losse gegevens</strong><span>Host, poort, pad en inloggegevens</span>
        </button>
        <button type="button" className={form.connectionMode === "URL" ? "active" : ""} onClick={() => setConnection("connectionMode", "URL")}>
          <strong>Volledige RTSP URL</strong><span>De API ontleedt en beveiligt credentials</span>
        </button>
      </div>
      {form.connectionMode === "URL" ? (
        <div className="field">
          <label>RTSP URL *</label>
          <input type="password" autoComplete="off" value={form.rtspUrl} onChange={(event) => setConnection("rtspUrl", event.target.value)} placeholder="rtsp://gebruiker:wachtwoord@camera:554/stream" />
        </div>
      ) : (
        <div className="form-grid">
          <div className="field"><label>IP-adres of hostnaam *</label><input value={form.rtspHost} onChange={(event) => setConnection("rtspHost", event.target.value)} placeholder={form.dahuaHost || "192.168.1.50"} /><small>Leeg gebruikt bij de gecombineerde Dahua-modus hetzelfde apparaatadres.</small></div>
          <div className="field"><label>RTSP-poort</label><input type="number" min="1" max="65535" value={form.rtspPort} onChange={(event) => setConnection("rtspPort", event.target.value)} /></div>
          <div className="field full"><label>Stream/path</label><input value={form.rtspPath} onChange={(event) => setConnection("rtspPath", event.target.value)} placeholder="/cam/realmonitor?channel=1&subtype=0" /></div>
          <div className="field"><label>Gebruikersnaam</label><input autoComplete="off" value={form.username} onChange={(event) => setConnection("username", event.target.value)} /></div>
          <div className="field"><label>Wachtwoord</label><input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setConnection("password", event.target.value)} /></div>
        </div>
      )}
    </>
  );

  const labels = ["Algemeen", "Verbinding", "Herkenningsgebied", "Test ANPR", "Afronden"];
  return (
    <div className="wizard">
      <div className="page-header"><div><h1>Camera toevoegen</h1><p>Doorloop vijf overzichtelijke stappen.</p></div></div>
      {step === 1 && (
        <section className="card camera-location-link">
          <h2>Optionele VPN-locatie</h2>
          <div className="form-grid">
            <div className="field"><label>Locatie</label><select value={form.locationId} onChange={(event) => selectLocation(event.target.value)}><option value="">Standalone camera</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            {form.locationId ? <div className="field"><label>Recorder</label><select value={form.recorderId} onChange={(event) => set("recorderId", event.target.value)}><option value="">Geen recorder</option>{locations.find((item) => item.id === form.locationId)?.recorders.map((recorder) => <option value={recorder.id} key={recorder.id}>{recorder.name}</option>)}</select></div> : null}
          </div>
        </section>
      )}
      <div className="steps">{labels.map((label, index) => <div className={`step ${step === index + 1 ? "active" : step > index + 1 ? "done" : ""}`} key={label}><div className="step-number">{step > index + 1 ? "✓" : index + 1}</div><span className="step-label">{label}</span></div>)}</div>
      <section className="card wizard-card">
        {error ? <div className="alert error">{error}</div> : null}

        {step === 1 && (
          <>
            <h2>Algemene informatie</h2><p className="subtitle">Geef de camera een herkenbare naam en locatie.</p>
            <div className="form-grid">
              <div className="field"><label htmlFor="camera-name">Cameranaam *</label><input id="camera-name" value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Bijvoorbeeld Uddel Noord" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "camera-name-error" : undefined} />{nameError ? <small id="camera-name-error" className="field-error" role="alert">{nameError}</small> : null}</div>
              <div className="field"><label>Locatie *</label><input value={form.location} onChange={(event) => set("location", event.target.value)} placeholder="Straat of gebied" /></div>
              <div className="field full"><label>Omschrijving</label><textarea value={form.description} onChange={(event) => set("description", event.target.value)} placeholder="Aanvullende informatie" /></div>
              <div className="field"><label>Rijrichting</label><select value={form.direction} onChange={(event) => set("direction", event.target.value)}><option value="INCOMING">Inkomend</option><option value="OUTGOING">Uitgaand</option><option value="BOTH">Beide richtingen</option></select></div><div />
              <div className="field"><label>Latitude</label><input type="number" step="any" value={form.latitude} onChange={(event) => set("latitude", event.target.value)} placeholder="52.25" /><small>Kaartselectie is TODO voor een latere interfacefase; coördinaten werken nu al.</small></div>
              <div className="field"><label>Longitude</label><input type="number" step="any" value={form.longitude} onChange={(event) => set("longitude", event.target.value)} placeholder="5.78" /></div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Verbindingsmethode</h2><p className="subtitle">Device/API, RTSP-video en snapshots worden afzonderlijk getest.</p>
            <div className="mode-select">
              <button type="button" className={form.primaryConnection === "RTSP" ? "active" : ""} onClick={() => { setConnection("primaryConnection", "RTSP"); set("rtspEnabled", true); }}><strong>RTSP</strong><span>Videostream en snapshot</span></button>
              <button type="button" className={form.primaryConnection === "DAHUA_TCP_SDK" ? "active" : ""} onClick={() => setConnection("primaryConnection", "DAHUA_TCP_SDK")}><strong>Dahua TCP / SDK</strong><span>TCP 37777, apparaatinfo en capabilities</span></button>
            </div>
            {form.primaryConnection === "DAHUA_TCP_SDK" ? (
              <>
                <div className="form-grid">
                  <div className="field"><label>Dahua IP-adres of hostnaam *</label><input value={form.dahuaHost} onChange={(event) => setConnection("dahuaHost", event.target.value)} placeholder="192.168.178.210" /></div>
                  <div className="field"><label>TCP-poort</label><input type="number" min="1" max="65535" value={form.dahuaPort} onChange={(event) => setConnection("dahuaPort", event.target.value)} /></div>
                  <div className="field"><label>Apparaatcategorie</label><select value={form.deviceCategory} onChange={(event) => setConnection("deviceCategory", event.target.value)}><option value="AUTO">Automatisch detecteren</option><option value="CAMERA">Camera</option><option value="NVR">NVR / Recorder</option></select></div><div />
                  <div className="field"><label>Gebruikersnaam</label><input autoComplete="off" value={form.dahuaUsername} onChange={(event) => setConnection("dahuaUsername", event.target.value)} /></div>
                  <div className="field"><label>Wachtwoord</label><input type="password" autoComplete="new-password" value={form.dahuaPassword} onChange={(event) => setConnection("dahuaPassword", event.target.value)} /></div>
                </div>
                <div className="actions" style={{ justifyContent: "flex-start" }}><button type="button" className="button" disabled={busy} onClick={testDeviceConnection}>{busy ? "Device/API testen…" : "Device/API testen"}</button></div>
                <label className="checkbox"><input type="checkbox" checked={form.rtspEnabled} onChange={(event) => setConnection("rtspEnabled", event.target.checked)} />Ook RTSP configureren voor videobeeld en snapshot</label>
                <div className="alert info">Zonder geïnstalleerde officiële Dahua NetSDK-adapter bevestigt de test alleen host en TCP-poort. Authenticatie, apparaattype en capabilities blijven dan eerlijk op “Onbekend”.</div>
                {form.rtspEnabled ? rtspFields : null}
              </>
            ) : rtspFields}
            {rtspConfigured ? <div className="actions" style={{ justifyContent: "flex-start" }}><button type="button" className="button" disabled={busy} onClick={() => testRtspConnection(false)}>{busy ? "RTSP testen…" : "RTSP video testen"}</button><button type="button" className="button secondary" disabled={busy} onClick={() => testRtspConnection(true)}>{busy ? "Snapshot ophalen…" : "Snapshot opnieuw ophalen"}</button></div> : null}
            {connectionStatuses}
            {snapshotAvailable ? <div className="wizard-preview"><img src={`/api/cameras/test-snapshot/${rtspTest!.snapshotObjectId!.split("/").pop()}`} alt="RTSP testsnapshot" /></div> : null}
          </>
        )}

        {step === 3 && (
          <>
            <h2>Herkenningsgebied</h2><p className="subtitle">Een snapshot is nodig om een zone praktisch te tekenen. De zone blokkeert de RTSP- of snapshottest niet.</p>
            {!snapshotAvailable ? <div className="alert info">Er is nog geen snapshot beschikbaar. Controleer de oorzaak hieronder en haal opnieuw een snapshot op. Je kunt zonder zone verdergaan.</div> : null}
            <div ref={area} className="snapshot-zone" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
              {snapshotAvailable ? <img draggable={false} src={`/api/cameras/test-snapshot/${rtspTest!.snapshotObjectId!.split("/").pop()}`} alt="Camera snapshot" /> : <span>Geen snapshot beschikbaar; tekenen is uitgeschakeld.</span>}
              {box ? <div className="zone-box" style={box} /> : null}
            </div>
            {rtspTest?.snapshot.status === "UNAVAILABLE" && rtspTest.snapshot.message ? <div className="alert error">{rtspTest.snapshot.message}</div> : null}
            <div className="actions" style={{ justifyContent: "flex-start" }}>
              {rtspConfigured ? <button type="button" className="button" disabled={busy} onClick={() => testRtspConnection(true)}>{busy ? "Snapshot ophalen…" : "Snapshot opnieuw ophalen"}</button> : null}
              <button type="button" className="button secondary" disabled={!zone.length} onClick={() => setZone([])}>Zone wissen</button>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2>Test ANPR</h2><p className="subtitle">Configureer de eventinname. De echte eventverbinding start pas nadat de camera is opgeslagen.</p>
            <div className="form-grid">
              <div className="field"><label>ANPR-provider</label><select value={form.anprProvider} onChange={(event) => set("anprProvider", event.target.value)}><option value="NONE">Uitgeschakeld</option><option value="DAHUA_CGI">Dahua Native ANPR (ITSAPI)</option></select></div>
              <div className="field"><label>HTTP-protocol</label><select value={form.anprHttpProtocol} onChange={(event) => set("anprHttpProtocol", event.target.value)}><option value="http">HTTP</option><option value="https">HTTPS</option></select></div>
              <div className="field"><label>HTTP-poort</label><input type="number" min="1" max="65535" value={form.anprHttpPort} onChange={(event) => set("anprHttpPort", event.target.value)} /></div>
              <div className="field"><label>Dahua-kanaal</label><input type="number" min="1" max="64" value={form.anprChannel} onChange={(event) => set("anprChannel", event.target.value)} /></div>
              {form.anprProvider === "DAHUA_CGI" && <NativeAnprTest connection={{ ...connection, anprHttpProtocol: form.anprHttpProtocol, anprHttpPort: Number(form.anprHttpPort), anprChannel: Number(form.anprChannel) }} />}
            </div>
            {connectionStatuses}
            <div className="alert info">“Onbekend” is hier bewust: vóór opslaan draait nog geen langdurige eventworker. Na opslaan wordt de status Verbonden, Onbekend of Mislukt zichtbaar in de camerastatus. Er wordt geen succes gesimuleerd.</div>
          </>
        )}

        {step === 5 && (
          <>
            <h2>Camera afronden</h2><p className="subtitle">Controleer de afzonderlijke testresultaten en kies of de camera direct actief wordt.</p>
            {connectionStatuses}
            <div className="summary">
              <StatusRow label="Naam" value={form.name} />
              <StatusRow label="Locatie" value={form.location} />
              <StatusRow label="Rijrichting" value={form.direction} />
              <StatusRow label="Herkenningszone" value={zone.length ? "Ingesteld" : "Niet ingesteld (optioneel)"} tone={zone.length ? "success" : "warning"} detail={zone.length ? undefined : "De camera kan worden opgeslagen; stel de zone later in zodra een snapshot beschikbaar is."} />
            </div>
            <label className="checkbox" style={{ marginTop: 20 }}><input type="checkbox" checked={form.active} onChange={(event) => set("active", event.target.checked)} />Camera na opslaan activeren</label>
          </>
        )}

        <div className="actions wizard-navigation">
          {step > 1 ? <button className="button secondary" onClick={() => { setError(""); setStep((current) => current - 1); }}>Vorige</button> : null}
          {step < 5 ? <button className="button" disabled={busy} onClick={next}>{busy && step === 1 ? "Naam controleren…" : "Volgende"}</button> : <button className="button" disabled={busy} onClick={save}>{busy ? "Camera opslaan…" : "Camera activeren en opslaan"}</button>}
        </div>
      </section>
    </div>
  );
}
