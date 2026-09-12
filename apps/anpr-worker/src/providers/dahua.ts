import { splitDahuaImages } from "./dahua-images.js";
import { dahuaEventPath } from "@anpr/shared/dahua";
import { boundaryFromContentType } from "../multipart.js";
import { decryptCredential } from "../credentials.js";
import { openDigestStream } from "../digest.js";
import { consumeMultipart, type MultipartPart } from "../multipart.js";
import type { AnprEventProvider, ManagedAnprCamera, NormalizedAnprEvent, ProviderLogger } from "../types.js";
import { imageKind, normalizeDahuaEvent, parseDahuaFields, type DahuaRawEvent } from "./dahua-parser.js";

function validateHost(host: string): string {
  if (!/^(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+$/.test(host) && !/^\[[0-9a-fA-F:]+\]$/.test(host) && !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new Error("INVALID_CAMERA_HOST");
  }
  return host;
}

export class DahuaAnprProvider implements AnprEventProvider {
  readonly kind = "DAHUA_CGI" as const;
  constructor(private readonly options: {
    keyHex: string; timeoutMs: number; maxPartBytes: number; settleMs?: number; logger: ProviderLogger;
    openStream?: typeof openDigestStream; consume?: typeof consumeMultipart;
  }) {}

  async connect(camera: ManagedAnprCamera, handlers: { onConnected: () => Promise<void>; onEvent: (event: NormalizedAnprEvent) => Promise<void> }, signal: AbortSignal) {
    if (!camera.rtspHost) throw new Error("INVALID_CAMERA_HOST");
    const protocol = camera.anprHttpProtocol === "https" ? "https" : camera.anprHttpProtocol === "http" ? "http" : undefined;
    if (!protocol) throw new Error("INVALID_ANPR_PROTOCOL");
    const username = decryptCredential(camera.rtspUsernameEncrypted, this.options.keyHex);
    const password = decryptCredential(camera.rtspPasswordEncrypted, this.options.keyHex);
    const path = dahuaEventPath(camera.anprChannel);
    const response = await (this.options.openStream ?? openDigestStream)({ protocol, host: validateHost(camera.rtspHost), port: camera.anprHttpPort, path, username, password, signal, timeoutMs: this.options.timeoutMs });
    try { boundaryFromContentType(response.headers["content-type"]); } catch (error) { response.destroy(); throw error; }
    await handlers.onConnected();
    let pending: DahuaRawEvent | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let chain = Promise.resolve();
    const flush = () => {
      if (!pending) return;
      const raw = pending;
      pending = undefined;
      if (timer) clearTimeout(timer);
      const event = normalizeDahuaEvent(camera, raw);
      if (event) chain = chain.then(() => handlers.onEvent(event)).catch(() => {
        this.options.logger.error("[dahua-anpr] event could not be stored; stream remains isolated");
      });
    };
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(flush, this.options.settleMs ?? 1000); };
    const onPart = async (part: MultipartPart) => {
      const contentType = part.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType === "text/plain") {
        const fields = parseDahuaFields(part.body);
        // Some firmwares send an empty text heartbeat after the images. Treat
        // that as an event boundary so the pending event can be stored now.
        if (Object.keys(fields).length === 0) {
          flush();
          return;
        }
        flush();
        await chain;
        pending = { fields };
        schedule();
      } else if (contentType === "image/jpeg" && pending) {
        const split = splitDahuaImages(pending.fields,part.body);
        if(split.declared){
          pending.overviewImage=split.overviewImage??pending.overviewImage;
          pending.plateImage=split.plateImage??pending.plateImage;
          pending.extraImage=split.extraImage??pending.extraImage;
          pending.imageDiagnostics={...pending.imageDiagnostics};
          for(const [kind,status] of Object.entries(split.diagnostics)) if(pending.imageDiagnostics[kind]!=="RECEIVED") pending.imageDiagnostics[kind]=status;
          schedule();return;
        }
        const image = { contentType: "image/jpeg" as const, data: part.body };
        if (imageKind(part.headers) === "plate") pending.plateImage = image;
        else if (!pending.overviewImage) pending.overviewImage = image;
        else if (!pending.extraImage) pending.extraImage = image;
        schedule();
      }
    };
    try {
      await (this.options.consume ?? consumeMultipart)(response, { maxPartBytes: this.options.maxPartBytes, signal, onPart });
    } finally {
      flush();
      await chain;
    }
  }
}
