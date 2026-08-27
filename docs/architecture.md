# Architectuur ANPR-platform

Status: vastgesteld voor Fase 1. Latere fases zijn alleen als uitbreidingspunt beschreven.

## 1. Doel en afbakening

Fase 1 levert een lokaal, container-first platform met veilige authenticatie, modulair
rechtenbeheer, gebruikersbeheer, een dashboard, camerabeheer, een bruikbare
camerawizard, echte server-side RTSP/FFmpeg-verbindingstests, een expliciet gemarkeerde
demo/simulator en basis-healthchecks. Echte voertuigdetectie en ANPR zijn **niet** actief
in Fase 1 en worden nergens als werkend gepresenteerd.

De eerste installatie is bedoeld voor drie camera's en 5–10 gebruikers. De grenzen
tussen web, API, database, queue, video en ANPR blijven zo dat later afzonderlijke
workers en meerdere instanties toegevoegd kunnen worden.

## 2. Monorepo en directorystructuur

```text
apps/
  api/                 Node.js/TypeScript REST API
  web/                 Next.js/React/TypeScript webinterface
packages/
  database/            Prisma-schema, migraties en seed
  shared/              gedeelde TypeScript-typen en constanten
docs/                   ontwerp- en opleverdocumentatie
storage/                lokale runtime-opslag (Git-negeren)
docker-compose.yml      lokale ontwikkelstack
```

NPM workspaces beheren de JavaScript-packages. Iedere app houdt eigen scripts en een
eigen Dockerfile, terwijl `database` en `shared` herbruikbaar blijven.

## 3. Frontendarchitectuur

De webapp gebruikt Next.js App Router, React en TypeScript. De gebruikersinterface is
standaard Nederlands en houdt zichtbare teksten centraal genoeg om latere i18n niet te
blokkeren. De interface is responsive en bestaat uit een loginpagina en een beveiligde
app-shell met zijmenu.

De browser benadert de API via dezelfde origin onder `/api`. Next.js rewrites sturen
dit intern door naar de API-container. Hierdoor blijven sessiecookies first-party en is
geen brede CORS-configuratie nodig. Serverstatus en formulieren geven echte API-status
weer; nog niet gebouwde menuonderdelen zijn zichtbaar gemarkeerd als toekomstige fase.

Fase 1-pagina's:

- dashboard;
- cameraoverzicht en cameradetails;
- camerawizard met algemene gegevens, verbinding, zone, ANPR-TODO en bevestiging;
- gebruikersbeheer voor administrators;
- demo/simulator;
- systeemstatus.

## 4. Backendarchitectuur

De API is een afzonderlijke Node.js/TypeScript-service op basis van Fastify. Routes,
services en infrastructuur zijn gescheiden. Zod valideert alle invoer. Prisma is de
enige database-toegangslaag.

De API-groepen zijn:

- `/health` en `/health/ready`;
- `/auth` voor login, sessie, logout en sessiebeheer;
- `/users` voor administrator-gebruikersbeheer;
- `/roles` voor rollen en permissions;
- `/cameras` voor CRUD, activeren, verbindingstest en snapshots;
- `/dashboard` voor werkelijke samenvattingen;
- `/simulator` voor expliciete demo-passages;
- `/system` voor beperkte statusinformatie.

API-antwoorden van camera's bevatten nooit decryptiesleutels, wachtwoorden of een
volledige RTSP-URL met credentials.

## 5. Database en Prisma

PostgreSQL is de transactionele bron. UUID's zijn primaire sleutels. Het schema bevat
de modellen uit de productspecificatie, ook wanneer de bijbehorende workflow pas later
wordt gebouwd. Toekomstige tabellen worden in Fase 1 alleen gebruikt wanneer nodig voor
demo-passages en dashboards; dat wordt expliciet als demo aangeduid.

Belangrijke relaties:

- User ↔ Role ↔ Permission is many-to-many via koppeltabellen;
- User heeft revocable UserSessions;
- Camera heeft CameraZones en Passages;
- Passage koppelt Vehicle, PlateDetections, media-object-ID's en Hits;
- PlateGroup ↔ kentekenleden ondersteunt signaleringslijsten;
- AuditLog bewaart beveiligings- en beheeracties zonder secrets;
- RetentionException bereidt gecontroleerd langer bewaren voor.

Indexes worden toegevoegd voor tijd, camera, genormaliseerd kenteken, voertuigkleur,
voertuigtype, hitstatus en groepslidmaatschap. Foto's staan nooit als blobs in
PostgreSQL; alleen storage-object-ID's worden opgeslagen.

## 6. Authenticatie en sessies

Wachtwoorden worden met bcrypt (cost 12) gehasht. Login accepteert e-mail of
gebruikersnaam. Een succesvolle login maakt een cryptografisch willekeurig opaque
sessietoken. Alleen de SHA-256-hash wordt in PostgreSQL opgeslagen; de browser krijgt
het token in een `HttpOnly`, `SameSite=Strict` cookie met `Secure` in productie.

Sessies hebben een vervaldatum, kunnen afzonderlijk of op alle apparaten worden
ingetrokken en werken daardoor zonder client-side tokens. Login krijgt rate limiting
en tijdelijke accountvergrendeling na herhaalde mislukte pogingen. De API logt geen
wachtwoord of sessietoken. Muterende cookie-authenticatieroutes controleren Origin/
Host als CSRF-verdediging naast SameSite-cookies.

De eerste administrator wordt uitsluitend via een interactieve CLI-opdracht gemaakt.
Er bestaat geen standaard- of hardcoded adminwachtwoord.

## 7. Rechtenmodel

Permissions zijn losse databaseobjecten en worden per route afgedwongen, niet alleen
via rolnamen. Seed maakt Administrator, Operator en Viewer met afzonderlijke
permissions. Voorbeelden zijn `users.manage`, `cameras.manage`, `cameras.view`,
`passages.view`, `simulator.run` en `system.view`.

De frontend verbergt ontoegankelijke acties voor gebruiksgemak, maar de API blijft de
autoritatieve beveiligingsgrens. Integratietests bewijzen onder meer dat een Viewer
geen beheeractie via een directe API-call kan uitvoeren.

## 8. Camera- en credentialarchitectuur

Een camera bewaart algemene gegevens los van geheime verbindingseigenschappen. De API
accepteert óf een volledige RTSP-URL óf losse host/poort/path/credentials. Vóór opslag
wordt de URL ontleed. Gebruikersnaam en wachtwoord worden afzonderlijk versleuteld met
AES-256-GCM en een 32-byte sleutel uit `CAMERA_CREDENTIALS_KEY`.

Niet-geheime host-, poort- en pathvelden mogen naar de frontend. De API retourneert
alleen booleans zoals `hasUsername` en `hasPassword`; nooit plaintext credentials of
een samengestelde URL met credentials. Bij bewerken betekent een leeg wachtwoord:
bestaand geheim behouden.

CameraZones bewaren genormaliseerde JSON-coördinaten (0–1) voor rechthoek of polygon.
De wizard kan de zone over een echte snapshot tekenen. Camerastatus wordt afgeleid uit
actiefstatus, laatste testresultaat en offline-timeout.

## 9. RTSP-test en snapshot

De API bouwt de RTSP-URL uitsluitend in geheugen op en start FFmpeg met een argumenten-
array (geen shell). `ffprobe` controleert bereikbaarheid en streammetadata met een harde
timeout. `ffmpeg` leest daarna maximaal één frame en schrijft dat via de storageprovider
als snapshot. URL's en subprocess-output worden gesaneerd voordat ze worden gelogd of
teruggestuurd.

Fouten worden op basis van netwerkfout, timeout en gesaneerde FFmpeg-categorie vertaald
naar: authenticatie mislukt, host/DNS onbereikbaar, poort gesloten, stream/path fout,
timeout of generieke FFmpeg/RTSP-fout. Omdat leveranciers verschillend reageren blijft
de classificatie een best-effort diagnose.

## 10. Simulator

De simulator is alleen beschikbaar wanneer `DEMO_MODE=true`. Seed maakt Uddel Noord,
Uddel Oost en Uddel West, groep Aandacht en testkenteken 12-ABC-3. Een bevoegde gebruiker
kan via de webinterface een duidelijk als **DEMO** gemarkeerde passage genereren.

De simulator schrijft echte databasegegevens en dashboardtellingen bij, maar roept geen
ANPR-engine aan. Records dragen `source=DEMO`; de interface presenteert ze nooit als
werkelijke detectie.

## 11. Storage

`StorageProvider` definieert opslaan, lezen en verwijderen. Fase 1 gebruikt lokale disk
in een persistent Docker-volume. Object-ID's zijn willekeurig en paden worden niet door
gebruikers bepaald. De API biedt snapshots alleen via een geauthenticeerd endpoint.
NAS en S3-compatible providers kunnen later dezelfde interface implementeren.

## 12. Toekomstige ANPR-providerarchitectuur

Een later package `anpr-provider` krijgt minimaal:

```ts
interface ANPRProvider {
  detectPlate(image: ImageInput): Promise<PlateResult[]>;
  detectVehicle(image: ImageInput): Promise<VehicleResult>;
  healthCheck(): Promise<ProviderHealth>;
}
```

Video-ingest publiceert jobs met storage-object-ID's naar Redis/BullMQ. Een afzonderlijke
video-worker kiest frames; een ANPR-worker gebruikt de gekozen provider. De Passage-
service blijft provider-onafhankelijk. CPU-, GPU- en externe API-providers kunnen zo
worden verwisseld zonder web/API/database opnieuw te ontwerpen.

## 13. Security-overzicht

- secrets komen alleen uit environmentvariabelen en `.env` blijft buiten Git;
- productie start niet met voorbeeldsleutels;
- credentials zijn encrypted-at-rest en worden nooit teruggestuurd;
- bcrypt beschermt wachtwoorden, opaque hashes beschermen sessies;
- Zod-inputvalidatie, bodylimieten en rate limiting staan op de API;
- permissions worden server-side per endpoint gecontroleerd;
- SameSite/HttpOnly cookies, Origin-controle en securityheaders beperken CSRF/XSS;
- auditlogs bevatten actor, actie en object, maar geen secrets;
- subprocessen gebruiken geen shell en krijgen timeouts;
- containers draaien waar mogelijk als niet-root gebruiker;
- database en Redis krijgen geen hostpoort in de standaard Compose-stack;
- reverse proxy/TLS is productievoorbereiding; lokaal gebruikt men HTTP op localhost.

## 14. Docker-architectuur

Fase 1 gebruikt:

- `web`: Next.js, intern poort 3000, publiek `http://localhost:3000`;
- `api`: Fastify en FFmpeg, intern poort 4000, healthcheck actief;
- `postgres`: PostgreSQL 16 met persistent volume;
- `redis`: Redis 7 met persistent volume en healthcheck;
- `migrate`: eenmalige Prisma-migratie vóór API-start;
- `seed`: optioneel profiel/handmatige opdracht voor demo-data.

De API is lokaal ook bereikbaar op `http://localhost:4000` voor health/debug; PostgreSQL
en Redis blijven standaard alleen op het Compose-netwerk. Een reverse proxy is voor
productiedeployment voorzien, maar Fase 1 voegt geen schijn-HTTPS toe.

## 15. Healthchecks

`/health` is een eenvoudige livenesscheck. `/health/ready` controleert PostgreSQL,
Redis, storage en aanwezigheid van FFmpeg. De respons noemt ANPR/video-workers als
`not_implemented` en niet als gezond. Camerahealth is per camera zichtbaar na een echte
verbindingstest.

## 16. Schaalbaarheid

De API is stateless buiten PostgreSQL/Redis/storage en kan later horizontaal schalen.
Queue jobs bevatten geen afbeeldingsblob. Workers schalen onafhankelijk en kunnen aan
CPU/GPU-nodes worden toegewezen. Eén ingestproces per camera kan later meerdere HLS/
WebRTC-consumenten voeden, zodat browsers niet elk een RTSP-sessie openen. Tabellen en
indexes ondersteunen tijdgebaseerde cleanup en latere partitionering.

## 17. Implementatievolgorde Fase 1

1. Prisma-schema en migratie.
2. Workspace-, environment- en Dockerconfiguratie.
3. API-infrastructuur, security, auth en RBAC.
4. Gebruikers- en camera-API, RTSP-test en lokale storage.
5. Simulator, dashboard en health.
6. Nederlandse responsive webinterface en camerawizard.
7. Seed, admin-CLI en tests.
8. TypeScript, lint, tests, Prisma, Compose/build en runtimecontrole.
9. README en gecontroleerd Fase 1-resultaat.

## 18. Bewuste TODO's na Fase 1

- echte RTSP-ingest, tracking, frame-selectie en ANPR-provider (Fase 2);
- live HLS/WebRTC en passages via SSE/WebSocket (Fase 2);
- echte hit-, zoek-, groep- en dossierworkflows (Fase 3);
- PWA/Web Push/meldkamer (Fase 4);
- volledige retentiejobs, back-ups, monitoring en performancebeheer (Fase 5).

Deze onderdelen hebben datamodellen of interfaces waar dat migratierisico vermindert,
maar worden in Fase 1 niet als werkende functionaliteit aangeboden.
