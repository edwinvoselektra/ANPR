# Resultaat Fase 2.1 — video-worker/RTSP-basis

Datum controle: 2 september 2026

## Wat daadwerkelijk werkt

- Een afzonderlijke `video-worker`-service start via Docker Compose.
- De worker haalt actieve camera's dynamisch uit PostgreSQL; er zijn geen hardcoded
  cameranamen of RTSP-verbindingen.
- Iedere actieve camera heeft een eigen asynchrone verwerkingslus. Een offline camera
  blokkeert andere camera's niet.
- FFmpeg leest periodiek maximaal één JPEG-testframe per camera.
- Het nieuwste frame wordt atomair overschreven in `worker-snapshots/<camera-id>.jpg`.
- Camera's worden in PostgreSQL `ONLINE` of `OFFLINE`, met laatste poging, laatste
  succesvolle verbinding en een veilige foutcode/-melding.
- Uitgevallen camera's worden standaard na tien seconden opnieuw geprobeerd en worden
  na herstel automatisch weer online gemarkeerd.
- Nieuwe, gewijzigde en uitgeschakelde camera's worden periodiek opnieuw ingelezen.
- De worker heeft een interne healthcheck op poort 4100 en publiceert een Redis-heartbeat.
- De API en pagina Systeemstatus tonen de actuele workerstatus en alle databasecamera's.
- De systeemstatuspagina ververst automatisch iedere vijf seconden.
- Credentials worden alleen in workergeheugen ontsleuteld en verschijnen niet in
  normale logs, API-responses of foutmeldingen.

Tijdens de runtimecontrole beheerde de worker vier actieve databasecamera's. De echte
camera `hal vos` werd daadwerkelijk `ONLINE`, produceerde een JPEG-frame van circa
224 KiB en bleef online over meerdere samplecycli. De drie demo-camera's zonder echte
RTSP-stream werden onafhankelijk `OFFLINE` en bleven opnieuw proberen.

## Afbakening

Fase 2.1 bevat bewust geen OCR, kentekenherkenning, voertuigdetectie, watchlistmatching,
notificaties, passages, permanente video-opname of live browsertranscoding. Deze
functionaliteit wordt niet als werkend gepresenteerd.

## Database

Er is geen Prisma-schemawijziging en geen nieuwe migratie. De bestaande Camera-velden
waren voldoende. `prisma migrate deploy` vond één bestaande migratie en geen openstaande
migraties. Er zijn geen databasegegevens of Docker-volumes verwijderd.

## Nieuwe environmentvariabelen

Alle variabelen hebben veilige developmentdefaults in Compose:

```dotenv
VIDEO_WORKER_PORT=4100
VIDEO_SAMPLE_FPS=0.1
VIDEO_RETRY_SECONDS=10
VIDEO_CAMERA_REFRESH_SECONDS=10
VIDEO_CAPTURE_TIMEOUT_SECONDS=15
```

`VIDEO_SAMPLE_FPS=0.1` betekent één frame per tien seconden per camera. De configuratie
accepteert maximaal 1 FPS. Een hogere waarde vraagt meer CPU, netwerkbandbreedte en
cameracapaciteit.

## Docker-service

De service heet `video-worker`, gebruikt FFmpeg, PostgreSQL, Redis en hetzelfde
persistente `storage_data`-volume als de API. Poort 4100 blijft alleen binnen het
Compose-netwerk beschikbaar. Bij een onverwachte procescrash start Compose de worker
automatisch opnieuw.

## Starten

Voer in de VS Code WSL-terminal uit:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build
docker compose ps
```

De regels voor `web`, `api`, `postgres`, `redis` en `video-worker` horen `healthy` te
worden. Open daarna:

```text
http://localhost:3000/system
```

## Handmatig testen met een echte camera

1. Log in en controleer onder **Camera's** dat de gewenste camera actief staat.
2. Open **Systeemstatus**. `videoWorker` hoort Online te zijn.
3. Wacht maximaal de capture-timeout plus refreshperiode. De echte camera hoort Online
   te worden en een actuele snapshot te tonen in het cameraoverzicht.
4. Volg desgewenst de veilige logs:

```bash
cd /home/edwin/projects/anpr-platform
docker compose logs -f video-worker
```

Stop het volgen met `Ctrl+C`; de worker blijft draaien.

5. Test recovery alleen wanneer het veilig is om de stream kort te onderbreken. Stop
   bijvoorbeeld tijdelijk de RTSP-stream/camera, wacht op `camera offline`, en herstel
   hem daarna. Zonder containerherstart moet `camera connected` verschijnen en de
   systeemstatus weer Online worden.

Interne workerhealth controleren:

```bash
docker compose exec video-worker wget -qO- http://127.0.0.1:4100/health
```

API-readiness inclusief heartbeat controleren:

```bash
curl http://localhost:4000/health/ready
```

## Uitgevoerde kwaliteitscontroles

- TypeScript/typecheck: API, web, database en video-worker geslaagd.
- ESLint: API, web, shared en video-worker geslaagd.
- Video-worker: 9 tests geslaagd.
- API: 43 tests geslaagd.
- Web: 15 tests geslaagd.
- Database: 20 tests geslaagd.
- Shared: 7 tests geslaagd.
- Prisma-schema: geldig.
- Prisma migrations: geen openstaande migraties.
- Docker Compose-configuratie: geldig.
- Developmentimages: API, web, migrate en video-worker gebouwd.
- Productiebuilds: API, Next.js-web en video-worker geslaagd.
- Runtime-smoketest: login, sessies, dashboard, camera CRUD, RTSP-foutafhandeling,
  simulator en Viewer-RBAC geslaagd.
- Runtimehealth: PostgreSQL, Redis, storage, FFmpeg, API, web en video-worker gezond.
- `npm ci`: 0 bekende kwetsbaarheden gerapporteerd.

## Bekende beperkingen

- Sampling gebruikt RTSP-over-TCP en één korte FFmpeg-aanroep per sample.
- Retry gebruikt een vaste wachttijd; geavanceerde exponential backoff volgt later.
- Er hoort voorlopig precies één video-worker-instance actief te zijn. Een distributed
  camera lease/lock voor horizontaal schalen is nog TODO.
- Alleen het nieuwste workerframe wordt bewaard; er is geen historie of video-opname.
- De drie demo-camera's hebben bewust geen echte RTSP-stream en worden daarom door de
  echte worker Offline gemarkeerd wanneer ze actief staan.
- De ANPR-worker blijft `not_implemented` tot een afzonderlijk goedgekeurde vervolgstap.

## Kleine bestaande Fase 1-correcties tijdens validatie

De brede kwaliteitscontrole vond type- en testfouten in het eerder toegevoegde
gebruikersbeheer. Alleen de Prisma-role-selectie en twee foutieve testmocks zijn minimaal
gecorrigeerd; het functionele gedrag is niet herontworpen. Daarna waren alle bestaande
controles groen.

## Volgende stap

Niet automatisch gestart. Na handmatige goedkeuring kan Fase 2.2 afzonderlijk worden
gespecificeerd. ANPR/OCR wordt pas dan ontworpen en geïmplementeerd.
