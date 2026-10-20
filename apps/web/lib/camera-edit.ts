// PATCH only fields the user edited. Existing nulls, legacy enums, transport
// configuration and encrypted credentials must not be round-tripped as edits.
export function cameraEditPatch(form: Record<string, unknown>, changed: ReadonlySet<string>) {
  const body: Record<string, unknown> = {};
  const fields = ["name","location","locationId","recorderId","description","direction","directionMapping","active","offlineTimeoutSeconds","rtspEnabled","rtspHost","rtspPort","rtspPath","anprProvider","anprHttpProtocol","anprHttpPort","anprChannel"];
  for (const field of fields) if (changed.has(field)) body[field] = form[field];
  for (const field of ["latitude", "longitude"]) {
    if (changed.has(field)) {
      const value = form[field];
      body[field] = value == null || typeof value === "string" && !value.trim() ? null : value;
    }
  }
  for (const field of ["username", "password"]) if (changed.has(field) && form[field]) body[field] = form[field];
  if (changed.has("rtspHost")) body.connectionMode = "FIELDS";
  if (["dahuaEnabled","dahuaHost","dahuaPort","deviceCategory","dahuaUsername","dahuaPassword"].some(field => changed.has(field))) {
    body.dahuaTcp = form.dahuaEnabled ? {
      host: form.dahuaHost, port: form.dahuaPort, category: form.deviceCategory,
      ...(form.dahuaUsername ? {username:form.dahuaUsername} : {}),
      ...(form.dahuaPassword ? {password:form.dahuaPassword} : {})
    } : null;
  }
  return body;
}

export const cameraEditFieldLabels: Record<string, string> = {
  name:"Cameranaam", location:"Locatietekst", locationId:"VPN-locatie", recorderId:"Recorder", description:"Omschrijving",
  direction:"Rijrichting", directionMapping:"Fysieke richtingsmapping / Richting omkeren", latitude:"Latitude", longitude:"Longitude",
  offlineTimeoutSeconds:"Offline-timeout", rtspHost:"RTSP-host", rtspPort:"RTSP-poort", rtspPath:"Stream/path",
  username:"RTSP-gebruikersnaam", password:"RTSP-wachtwoord", dahuaTcp:"Dahua TCP-instellingen", anprProvider:"ANPR-provider",
  anprHttpProtocol:"HTTP-protocol", anprHttpPort:"HTTP-poort", anprChannel:"Recorderkanaal", rtspEnabled:"RTSP-videotransport"
};
