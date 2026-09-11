# Resultaat Dahua native ANPR — 11 september 2026

## Aangetroffen

Het project had al een Dahua Digest/multipart-worker, TrafficJunction-parser, beeldenopslag en passage/hitverwerking. De wizard bood een CGI-provider naast een afzonderlijke TCP/NetSDK-transporttest, maar geen geauthenticeerde native ANPR-test. Verwijderen met historie werd expliciet geblokkeerd met HTTP 409; historische foreign keys staan terecht op Restrict.

Herstelpunt vóór wijzigingen: `5c1c261` (inclusief de bestaande, nog niet gecommitte RTSP/TCP-wijzigingen).

## Gekozen interface en lokale cameraverificatie

Gedocumenteerde `snapManager.cgi?action=attachFileProc`-subscriptie met `TrafficJunction`, HTTP(S) Digest en multipart JPEG/metadata. De bestaande interne provider-ID `DAHUA_CGI` blijft compatibel. De productnaam is **Dahua Native ANPR (ITSAPI)**. Geen verzonnen ITSAPI-endpoint, geen camerareset of wijziging van camera-instellingen.

De DHI-ITC413-PW4D-IZ3 op `192.168.178.248:80`, kanaal 1, antwoordde zonder authenticatie met 401 en met de versleuteld opgeslagen credentials met HTTP 200 en `multipart/x-mixed-replace; boundary=myboundary`. Dezelfde test is daarna via de echte webinterface uitgevoerd: API beschikbaar, authenticatie geslaagd, ANPR-eventstream beschikbaar.

Systeemstatus: API/database/Redis/storage/FFmpeg en beide workers gezond; testcamera RTSP online, snapshot beschikbaar, native worker CONNECTED. Nog geen fysieke ANPR-passage bevestigd.

## Implementatie

- Geauthenticeerde, begrensde en rate-limited test met Nederlandse onderscheidbare auth-, timeout-, HTTP- en TLS-fouten. Anonieme 200 en HTML worden niet als ondersteunde eventstream gepresenteerd.
- Native test op wizard en bestaande camera; hergebruik van versleutelde credentials. Hostnormalisatie en behoud van volledige RTSP-URL-invoer.
- Gedeelde hitdetectie voor API en worker; behoud van centrale pushdispatcher.
- Database-uniciteit voor bron-ID en deterministische fallback-key; lane in het bestaande tijdvenster. PostgreSQL-test bevestigt één passage/hit bij concurrente duplicaten.
- Optionele derde afbeelding; identieke beeldinhoud per event één bestand; passage blijft behouden bij ontbrekende of onbruikbare beelden/opslagfouten.
- Reconnect groeit ook bij direct afbrekende HTTP 200-streams. Een nieuwe loop wacht op de oude; statusupdates veroorzaken niet langer onnodige herstarts via updatedAt.
- Archive/ingest worden op de camerarecord geserialiseerd: een binnenkomend event kan een gearchiveerde camera niet opnieuw activeren.
- Admin-verwijdering verwijdert configuratie, secrets, zones en device-connections; historie blijft gekoppeld aan een niet-bewerkbare referentie. Oorspronkelijke naam blijft in passages, hits, dashboard, zoeken, kentekendossier en uitgestelde notificaties zichtbaar.

## Migratie

`20260911000100_camera_archive`: `archivedAt`, `historicalName`, `rtspEnabled`. Additief en toegepast op zowel de afzonderlijke testdatabase als de lokale applicatiedatabase. De bestaande unieke event-index blijft gebruikt. Geen historische passages of hits verwijderd.

## Uitgevoerde controles

- Prisma-clientgeneratie en migraties: geslaagd.
- TypeScript voor alle workspaces: geslaagd.
- Lint voor alle workspaces: geslaagd.
- 228 automatische tests: geslaagd (24 ANPR-worker, 116 API, 9 video-worker, 30 web, 30 database, 19 shared).
- Productiebuild inclusief Next.js: geslaagd.
- Docker-builds API, beide workers, web en migratieservice: geslaagd.
- Docker Compose-configuratie: geldig; bijgewerkte lokale services gestart.
- PostgreSQL-integratietest in `anpr_native_test`: native fixture → passage → actieve watchlist → één hit; concurrente deduplicatie; 401 zonder login; ADMIN-verwijdering; historie behouden; zones verwijderd; oude cameranaam via API; naam opnieuw bruikbaar.
- Browser: wizard en bewerkpagina laden; native test met echte camera slaagt; systeemstatus toont verbonden worker; geen JavaScript-fouten. Tijdelijke browserdata wordt niet gecommit.

## Exacte vervolgstappen

De camera bestaat al onder **Camera’s**. Open **Bewerken**, kies **Dahua Native ANPR (ITSAPI)**, **HTTP**, poort **80**, kanaal **1**. Laat opgeslagen credentials leeg om ze te behouden, klik **ITSAPI / ANPR testen** en houd **Camera actief** ingeschakeld. RTSP blijft host `192.168.178.248`, poort `554`, pad `/cam/realmonitor?channel=1&subtype=0` gebruiken.

Laat voor fysieke acceptatie één voertuig passeren. Controleer Live passages → passage-detail → Zoeken; voeg vooraf desgewenst het testkenteken aan een actieve hitgroep toe en controleer Hits/push. Zie de [volledige configuratie- en testprocedure](dahua-native-anpr.md).

## Grenzen

Een verbonden stream bewijst nog geen fysieke kentekenherkenning. Werkelijke fototypes, eventuele firmwarevarianten, merk/model/snelheid en fysieke pushontvangst moeten bij een echte passage worden bevestigd. Geen fysieke passage of pushontvangst als geslaagd gerapporteerd. Draai één ANPR-worker; geen gedistribueerde leases voor meerdere replicas. Zonder stabiele bron-ID/eventtijd is alleen korte deduplicatie betrouwbaar. Niet alle firmware levert drie beelden of expliciet benoemde crops. Snapshotverwijzingen worden gewist bij archiveren; bestaande tijdelijke snapshotbestanden worden niet als onderdeel van historische media verwijderd.

## Gewijzigde bestanden

- `README.md`
- `apps/anpr-worker/Dockerfile`
- `apps/anpr-worker/src/digest.ts`
- `apps/anpr-worker/src/passage-service.test.ts`
- `apps/anpr-worker/src/passage-service.ts`
- `apps/anpr-worker/src/providers/dahua-parser.ts`
- `apps/anpr-worker/src/providers/dahua.test.ts`
- `apps/anpr-worker/src/providers/dahua.ts`
- `apps/anpr-worker/src/types.ts`
- `apps/anpr-worker/src/worker.test.ts`
- `apps/anpr-worker/src/worker.ts`
- `apps/api/Dockerfile`
- `apps/api/src/cameras.test.ts`
- `apps/api/src/dahua-test.test.ts`
- `apps/api/src/dashboard.test.ts`
- `apps/api/src/lib/auth.test.ts`
- `apps/api/src/lib/auth.ts`
- `apps/api/src/lib/camera.ts`
- `apps/api/src/lib/dahua-test.ts`
- `apps/api/src/lib/historical-camera.ts`
- `apps/api/src/lib/hit-detection.ts`
- `apps/api/src/lib/notification-dispatcher.ts`
- `apps/api/src/routes/cameras.ts`
- `apps/api/src/routes/dashboard.ts`
- `apps/api/src/routes/health.ts`
- `apps/api/src/routes/hits.ts`
- `apps/api/src/routes/passages.ts`
- `apps/api/src/routes/plates.ts`
- `apps/api/src/routes/search.ts`
- `apps/api/src/runtime-smoke.ts`
- `apps/video-worker/Dockerfile`
- `apps/video-worker/src/repository.test.ts`
- `apps/video-worker/src/repository.ts`
- `apps/web/Dockerfile`
- `apps/web/app/cameras/[id]/page.tsx`
- `apps/web/app/cameras/new/page.tsx`
- `apps/web/app/cameras/page.tsx`
- `apps/web/app/passages/[id]/page.tsx`
- `apps/web/app/system/page.tsx`
- `apps/web/components/NativeAnprTest.tsx`
- `docs/PHASE-DAHUA-NATIVE-RESULT.md`
- `docs/architecture.md`
- `docs/dahua-native-anpr.md`
- `packages/database/prisma/migrations/20260911000100_camera_archive/migration.sql`
- `packages/database/prisma/schema.prisma`
- `packages/shared/package.json`
- `packages/shared/src/camera-host.test.ts`
- `packages/shared/src/dahua.ts`
- `packages/shared/src/hit-detection.ts`
- `packages/shared/src/index.ts`
- `scripts/native-anpr-smoke.mts`
