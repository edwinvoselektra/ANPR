# Architectuur ANPR-platform

Status: bijgewerkt tot en met patroonanalyse, mobiele tijd/richting en de externe
HTTPS-testopzet van september 2026. Historische fase-resultaten blijven afzonderlijk
in `docs/PHASE*-RESULT.md` bewaard.

## 1. Doel en afbakening

Het huidige platform is container-first en bevat veilige authenticatie, modulair
rechtenbeheer, gebruikers- en camerabeheer, RTSP/FFmpeg-diagnose, een video-worker,
Dahua CGI-eventinname via een afzonderlijke ANPR-worker, passages, hits, Web Push en
patroonanalyse. De simulator blijft expliciet DEMO. De ITSAPI-ontvanger is diagnostisch;
live browservideo en server-OCR worden nergens als werkend gepresenteerd.

De eerste installatie is bedoeld voor drie camera's en 5–10 gebruikers. De grenzen
tussen web, API, database, queue, video en ANPR blijven zo dat later afzonderlijke
workers en meerdere instanties toegevoegd kunnen worden.

## 2. Monorepo en directorystructuur

```text
apps/
  api/                 Node.js/TypeScript REST API
  anpr-worker/         Dahua-eventinname, passages en patroonanalyse
  video-worker/        Afzonderlijke RTSP/frame-sampling worker
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

Belangrijkste pagina's:

- dashboard;
- cameraoverzicht en cameradetails;
- camerawizard met algemene gegevens, verbinding, zone, optionele ANPR-provider en bevestiging;
- gebruikersbeheer voor administrators;
- demo/simulator;
- systeemstatus en instellingen;
- live passages, hits, zoeken, kentekens en groepen;
- locaties/VPN en opvallende patronen.

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
- `/passages`, `/hits`, `/plates`, `/plate-groups` en `/search` voor observaties en beheer;
- `/locations` en `/device-connections` voor VPN- en apparaatdiagnose;
- `/attention` voor score, historie, review en opvallende patronen;
- `/admin/overview` voor het beperkte ADMIN-overzicht.

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
De wizard kan de zone alleen over een echte snapshot tekenen. Een ontbrekende zone
blokkeert de Device/API-, RTSP- of snapshottest niet en is in deze fase optioneel bij
opslaan. Daardoor kan een gebruiker eerst de videoverbinding herstellen en pas daarna
een betrouwbaar herkenningsgebied tekenen. Camerastatus wordt afgeleid uit actiefstatus,
laatste testresultaat en offline-timeout.

Camera-delete is idempotent en archiveert de camerareferentie. De actieve configuratie,
credentials, zones en device-connections worden verwijderd; de oorspronkelijke naam
blijft voor historische weergave beschikbaar. Passages en Hits behouden hun `Restrict`-
relaties. ADMIN/Administrator kan verwijderen zonder historische registraties te wissen.
De naam wordt vrijgegeven; workers stoppen bij de volgende configuratiepoll. Zie
[Dahua native ANPR](dahua-native-anpr.md) voor de native interface, tests en lifecycle.

## 9. RTSP-test en snapshot

De API bouwt de RTSP-URL uitsluitend in geheugen op en start FFmpeg met een argumenten-
array (geen shell). `ffprobe` controleert bereikbaarheid en streammetadata met een harde
timeout. `ffmpeg` leest daarna maximaal één frame en schrijft dat via de storageprovider
als snapshot. URL's en subprocess-output worden gesaneerd voordat ze worden gelogd of
teruggestuurd.

De testrespons houdt vier verschillende signalen uit elkaar: Device/API, RTSP-video,
snapshot/frame en ANPR-events. Een geslaagde `ffprobe` betekent uitsluitend dat de
RTSP-videostream is geopend. `POST /cameras/test-connection` voert alleen die videoprobe
uit; de aparte tijdelijke endpoint `POST /cameras/test-snapshot` haalt op verzoek één
frame op en rapporteert een mislukte extractie expliciet als
`Snapshot: Niet beschikbaar`. Een ANPR-eventverbinding wordt in de aanmaakwizard
niet als geslaagd voorgesteld: vóór opslag en het starten van de eventworker blijft deze
status `Onbekend`.

Ook de Dahua TCP-test scheidt netwerkbereikbaarheid van apparaatidentiteit en
authenticatie. Een open poort 37777 levert zonder officiële NetSDK-adapter geen algemene
successtatus op: apparaat/API blijft `Niet bevestigd` en authenticatie `Niet getest`.
Model, firmware en kanalen worden alleen getoond wanneer een officiële adapter zowel
het Dahua-apparaat als de authenticatie daadwerkelijk heeft bevestigd. Het private
Dahua-protocol wordt niet in eigen code nagebouwd.

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

## 12. ANPR-providerarchitectuur

Fase 2.2 implementeert eerst camera-eventproviders via `AnprEventProvider`. Een latere
server-OCR-provider kan daarnaast de reeds voorziene beeldinterface gebruiken:

```ts
interface ANPRProvider {
  detectPlate(image: ImageInput): Promise<PlateResult[]>;
  detectVehicle(image: ImageInput): Promise<VehicleResult>;
  healthCheck(): Promise<ProviderHealth>;
}
```

Voor server-OCR publiceert video-ingest later jobs met storage-object-ID's naar
Redis/BullMQ. De huidige ANPR-worker ontvangt camera-events; de PassageService blijft
in beide gevallen provider-onafhankelijk. CPU-, GPU-, camera- en externe API-providers
kunnen zo worden verwisseld zonder web/API/database opnieuw te ontwerpen.

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
Redis, storage en aanwezigheid van FFmpeg. Vanaf Fase 2.1 rapporteert de API de
video-worker via een actuele Redis-heartbeat. Vanaf Fase 2.2 heeft de ANPR-worker een
eigen heartbeat en per camera een eigen eventstatus. Camerahealth blijft daarnaast via
de RTSP-workerstatus en handmatige verbindingstest zichtbaar.

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

## 18. Bewuste open punten

- tracking, slimme frame-selectie en server-OCR-provider (latere Fase 2-stap);
- live HLS/WebRTC; de passagelijst gebruikt nu betrouwbare korte polling;
- een volledige ITSAPI V1.19-parser en ACK pas na echt protocolbewijs;
- meldkamerfuncties buiten de bestaande hits, push en patroonanalyse;
- volledige retentiejobs, back-ups, monitoring en performancebeheer (Fase 5).

De transparante patroonanalyse inclusief dossierkaart, historie, review, zoekfilter,
pagina Opvallende patronen en simulator-scenario's is actief. Zie
[Aandachtsscore en patroonanalyse](attention-analysis.md).

Voor deze open punten blijven bestaande datamodellen en providerinterfaces behouden
waar die toekomstige migraties beperken. De interface presenteert ze niet als werkend.

## 19. Fase 2.1 — video-worker en RTSP-basis

Fase 2.1 activeert een afzonderlijke `video-worker` zonder de API of webinterface met
videowerk te belasten. De worker bevraagt PostgreSQL periodiek op `active=true` en start
voor iedere gevonden camera een geïsoleerde asynchrone cameraloop. Nieuwe, gewijzigde
en uitgeschakelde camera's worden daardoor zonder hardcoded configuratie verwerkt.

Een cameraloop bouwt de RTSP-URL uitsluitend in procesgeheugen op. De bestaande
AES-256-GCM camera-encryptiesleutel ontsleutelt gebruikersnaam en wachtwoord vlak vóór
de FFmpeg-aanroep. Normale logs bevatten alleen de cameranaam en een vaste melding;
nooit de URL, credentials, subprocess-output of encryptiesleutel.

FFmpeg leest per cyclus maximaal één JPEG-frame. `VIDEO_SAMPLE_FPS` is begrensd op
maximaal 1 FPS en staat in development standaard op 0,1 FPS (één frame per tien
seconden). Het nieuwste frame wordt atomair geschreven naar één vast object per
camera onder `worker-snapshots/`, zodat sampling geen onbeperkte bestandsgroei
veroorzaakt. Er is geen permanente opname, browsertranscoding of passage-opslag.

Bij succes schrijft de worker `ONLINE`, verbindingsmoment en snapshot-object-ID naar
de bestaande Camera-velden. Bij een veilige geclassificeerde fout schrijft hij
`OFFLINE`, foutcode en foutmelding en probeert hij na `VIDEO_RETRY_SECONDS` opnieuw.
Omdat iedere camera een eigen loop heeft, blokkeert een offline camera de overige
camera's niet. Een configuratiewijziging herstart alleen de betreffende cameraloop.

De worker publiceert iedere vijf seconden een Redis-heartbeat met TTL en biedt intern
`GET /health` op poort 4100. De API vertaalt een recente heartbeat naar
`videoWorker=healthy`; een ontbrekende of verlopen heartbeat wordt eerlijk als
`unhealthy` getoond. Ook een langdurig mislukte database-refresh maakt de workerhealth
degraded. De beveiligde systeemstatus-API haalt daarnaast alle camerastatussen
uit PostgreSQL. De API-readiness blijft onafhankelijk van workeruitval, zodat een
offline videoworker de beheerinterface niet onbereikbaar maakt.

Fase 2.1 wijzigt het Prisma-schema niet. De bestaande velden dekken status,
laatste poging, laatste succes, foutdiagnose en snapshot. ANPR/OCR, voertuigdetectie,
passages, live video en notificaties blijven expliciet TODO voor latere stappen.

## 20. Fase 2.2 — merk-onafhankelijke ANPR-eventinname

Fase 2.2 voegt een afzonderlijke `anpr-worker` toe. Die worker beheert uitsluitend
actieve camera's waarvoor `anprProvider` expliciet is ingesteld. De API en video-worker
blijven onafhankelijk: een verbroken ANPR-eventstream verandert de RTSP-status niet en
legt de webinterface niet stil.

De interne grens is `AnprEventProvider`. Iedere provider levert hetzelfde
`NormalizedAnprEvent` met camera-ID, tijd, origineel en genormaliseerd kenteken,
optionele voertuigkenmerken, richting/lane, bron-ID en maximaal een overzichts- en
kentekenfoto. Alleen de provider kent het leveranciersformaat:

```text
Dahua multipart event stream
  -> Dahua parser
  -> NormalizedAnprEvent
  -> PassageService (validatie, deduplicatie, storage)
  -> PostgreSQL + lokale objectopslag
  -> beveiligde passage-API
  -> webinterface (polling)
```

### Gekozen Dahua-interface en validatiegrens

De officiële Dahua-productinformatie voor de ITC413-PW4D-IZ1 bevestigt ondersteuning
voor CGI, ITSAPI, HTTP/HTTPS en JPEG. Dahua's HTTP API-specificatie beschrijft
`TrafficJunction` als ANPR-event en de CGI-opdracht `snapManager.cgi` met actie
`attachFileProc` als multipart-abonnement op events met snapshots. Daarom gebruikt de
eerste provider deze read-only CGI-eventstream, met HTTP Digest-authenticatie en alleen
de vaste, door de adapter samengestelde endpoint/query.

De publiek beschikbare productdocumentatie bevat niet de volledige firmware-specifieke
payload voor iedere ITC413-uitvoering. De adapter accepteert daarom alleen gedocumenteerde
key/value-velden en JPEG-parts, negeert onbekende metadata en verzint geen ontbrekende
waarden. De exacte eventvelden, afbeeldingsvolgorde en Digest-variant moeten nog met de
daadwerkelijke firmware worden gevalideerd. Als die firmware een afwijkende officiële
ITSAPI-variant vereist, wordt alleen de Dahua-provider aangepast.

### Camera-capabilities en configuratie

`CameraAnprProvider` bepaalt de adapter (`NONE` of `DAHUA_CGI`). Protocol, HTTP-poort en
Dahua-kanaal zijn losse gevalideerde velden. `capabilities` is gestructureerde JSON voor
onder meer RTSP, snapshots, camera-ANPR, plate crop en voertuigmetadata. De frontend
baseert weergave op capabilities/provider en niet op een merknaam. De worker gebruikt
uitsluitend de bestaande opgeslagen camerahost en AES-256-GCM-versleutelde credentials;
een gebruiker kan geen willekeurige event-URL invoeren.

### Passage, deduplicatie en opslag

Echte Dahua-records krijgen `source=DAHUA_CAMERA`. `sourceEventId` is uniek binnen
camera en bron. Als de camera geen bruikbare ID levert, controleert de PassageService
dezelfde camera en exact hetzelfde genormaliseerde kenteken binnen een korte,
configureerbare tijd. Er vindt geen O/0-, I/1- of andere gokcorrectie plaats.

JPEG-parts worden vóór opslag gecontroleerd op type, JPEG-signature en begrensde
bestandsgrootte. De lokale storageprovider genereert willekeurige objectnamen onder een
vaste passage-prefix; kentekens en camerageheimen komen niet in bestandsnamen. PostgreSQL
bevat alleen object-ID's. Bij een duplicate of databasefout ruimt de service zojuist
geschreven objecten weer op. De bestaande `expiresAt` maakt latere gezamenlijke cleanup
van rij en media mogelijk; een retention scheduler valt buiten Fase 2.2.

### Betrouwbaarheid en status

Elke camera draait in een geïsoleerde loop. Verbroken streams gebruiken begrensde
exponential backoff met jitter. Een fout bij één camera blokkeert andere camera's niet.
Redis bevat alleen een workerheartbeat zonder credentials of kentekens. PostgreSQL houdt
per camera afzonderlijk de ANPR-connectiestatus, laatste verbinding, laatste event en
een veilige foutcategorie bij. Productielogs gebruiken geen volledige kentekens.

### Live passages

De browser pollt de beveiligde `/passages`-API met `passages.view`; hij maakt nooit
rechtstreeks verbinding met een camera. De lijst toont nieuwste eerst en markeert
`DEMO` zichtbaar als demo. Afbeeldingen lopen via een geauthenticeerde API-route met
object-ID/path-validatie. Polling is voor 5–10 gebruikers de eenvoudigste betrouwbare
keuze en kan later achter dezelfde API-contracten door SSE worden vervangen.

## 21. Fase 3 — kentekens, groepen, hits en analyse

Fase 3 bouwt voort op de bestaande `PlateGroup` en `PlateGroupMember`-modellen. Een
conceptueel kenteken is de verzameling memberships met dezelfde
`normalizedLicensePlate`. Metadata wordt bij een wijziging transactioneel over alle
memberships gelijkgetrokken. Dit voorkomt een risicovolle omzetting van bestaande data
naar een extra tabel, terwijl één kenteken wel aan meerdere groepen kan zijn gekoppeld.

`hitEnabled` staat los van toekomstige pushnotificaties. Alleen een actief kenteken dat
op het passage-tijdstip geldig is én in een actieve groep met hitdetectie zit, matcht.
Simulator en Dahua-ingest voeren deze controle direct na passage-aanmaak binnen dezelfde
databasetransactie uit. Eén passage krijgt maximaal één `Hit`; `HitGroup` legt alle
gematchte groepen en de reden op dat moment vast. Daarmee blijft hithistorie correct als
een groep of kenteken later verandert. Push wordt nog niet verstuurd en staat daarom
eerlijk op notificatiestatus `SKIPPED`.

```text
Simulator of Dahua NormalizedAnprEvent
  -> Passage (één record na bestaande deduplicatie)
  -> exacte centrale kenteken-normalisatie
  -> actieve/geldige PlateGroupMember + actieve hitgroep
  -> maximaal één Hit + één of meer HitGroup-koppelingen
  -> dashboard, Hits, zoeken en kentekendossier
```

De zoek-API past alle filters in PostgreSQL toe en gebruikt begrensde paginering.
Kentekenfilters worden vóór de query centraal genormaliseerd. Datum- en tijdfilters
worden als Nederlandse lokale kalenderintervallen naar UTC vertaald; ook een nachtelijk
venster zoals 22:00–03:00 werkt over middernacht. Voor tijdvensters geldt een veilige
maximale periode van 92 dagen.

Leesroutes vereisen `passages.view` of `hits.view`. Mutaties op kentekens en groepen
vereisen altijd `plates.manage` in de API. Administrator en Operator krijgen deze
permission via het bestaande rollenmodel; Viewer niet. De browser verbergt beheerknoppen
zonder permission, maar is niet de beveiligingsgrens. Mutaties schrijven via de bestaande
auditinfrastructuur geen secrets en geen camera-credentials.

De migratie `20260903000100_plate_management_hits_search` is uitsluitend additief. Ze
voegt `hitEnabled`, `HitGroup`, één-hit-per-passage en zoekindexes toe en neemt bestaande
primaire hitgroepen over. Er is geen database-reset nodig. Verwijderen van een actief
kenteken verwijdert de memberships daadwerkelijk; passages en auditregels blijven
historie. Een groep met bestaande hithistorie wordt bij verwijderen gedeactiveerd in
plaats van de historische koppeling te verbreken.

De reparatiemigratie `20260903000200_fix_empty_plate_validity` corrigeert een vroege
Fase 3-validatiefout: `null` werd door datumcoercion als Unix-epoch opgeslagen. Alleen
exacte epochwaarden in de twee optionele geldigheidsvelden worden teruggezet naar
`NULL`. Nieuwe API-input controleert voortaan `null` vóór datumcoercion. Een leeg
optioneel groepsicoon wordt eveneens expliciet als `NULL` behandeld, zodat bestaande
seed- en demogroepen normaal bewerkbaar zijn.

Live browservideo, server-OCR, retentiescheduler en productiedeployment vallen
uitdrukkelijk buiten deze fase.

## 22. Fase 2.4 — PWA en Web Push

De Next.js-app levert een manifest, schaalbaar applicatie-icoon en een kleine service
worker. De service worker cachet bewust geen beveiligde pagina- of API-data; hierdoor
kan oude gevoelige ANPR-inhoud niet uit een offline cache verschijnen. Als service
worker-registratie niet wordt ondersteund, blijft de gewone webapp ongewijzigd werken.
Browsertoestemming wordt uitsluitend aangevraagd na een expliciete gebruikersklik.

Pushabonnementen behoren altijd aan de ingelogde gebruiker. `endpoint`, `p256dh` en
`auth` worden opgeslagen voor server-side aflevering, maar komen niet terug in API-
responses, auditmetadata of logs. Meerdere apparaten per gebruiker zijn toegestaan.
Een 404/410 van de pushprovider schakelt alleen het verlopen apparaat uit.

`NotificationPreference` bevat de persoonlijke hoofdschakelaar en de keuze voor alle
hitgroepen of een dynamische selectie. `NotificationPreferenceGroup` legt deze selectie
vast. `Notification` is de afleverhistorie/outbox met status, ontvanger, optioneel hit-
en apparaat-ID, beperkt aantal pogingen en een veilige foutcategorie. De VAPID private
key bestaat uitsluitend in de API-omgeving.

```text
Simulator / Dahua / toekomstige bron
  -> transactioneel opgeslagen Passage + Hit(PENDING)
  -> asynchrone database-outbox-dispatcher
  -> actieve gebruiker + persoonlijke groepsvoorkeur
  -> ieder actief PushSubscription maximaal één delivery
  -> Web Push-provider
  -> service worker -> beveiligde /hits/<id>-pagina
```

De unieke `deduplicationKey` maakt aflevering per hit/apparaat idempotent bij normale
workerherstarts en retries. Een delivery wordt vóór de externe call `PROCESSING`, zodat
een crash niet automatisch een mogelijk al verzonden bericht herhaalt. Tijdelijke
providerfouten krijgen maximaal drie directe pogingen; er is geen oneindige retryloop.
Een pushfout verandert de al opgeslagen hit of passage niet.

De dispatcher draait in Fase 2.4 als niet-blokkerende achtergrondtaak in het API-proces.
De outboxgrens maakt latere verplaatsing naar een aparte schaalbare notification-worker
mogelijk zonder hitproducenten of frontendcontracten te wijzigen. Ontbrekende VAPID-
configuratie wordt op Systeemstatus als `not_configured` getoond en laat hits `PENDING`,
zodat het platform niet crasht en ze na configuratie alsnog verwerkt kunnen worden.

## 23. Fase 2.4.5 — VPN-locaties en ER605-wizard

`VpnLocation` scheidt een fysieke locatie en zijn generieke VPN/routergegevens van
`Recorder` en `Camera`. Een camera houdt zijn bestaande vrije locatietekst en kan
daarnaast optioneel via `locationId` en `recorderId` worden gekoppeld. Bestaande en
standalone camera's blijven daardoor intact. Foreign keys gebruiken `Restrict`; een
locatie met camera's kan niet stilzwijgend worden verwijderd.

De standaardtopologie is Mode B: ER605 initieert WireGuard uitgaand naar de centrale
server. Mode A is als configuratiekeuze voorbereid. Het centrale endpoint is
configuratie en geen eigenschap die hard in camera's zit. Daardoor kan een latere
cloudserver worden ingevoerd zonder alle locaties opnieuw te modelleren.

WireGuard gebruikt X25519-keypairs. De centrale en locatie-private keys worden met de
bestaande AES-256-GCM secretlaag encrypted-at-rest opgeslagen. De centrale private key
verlaat de API nooit. Een nieuwe locatie-private key verschijnt technisch noodzakelijk
eenmalig in de directe generatierespons om hem handmatig op de ER605 te installeren;
daarna leveren GET- en nieuwe generatieresponses hem niet uit. Auditdata en logs
filteren secret-, password-, credential-, token- en private-keyvelden.

De API-container beheert geen WireGuard-interface en krijgt geen `NET_ADMIN` of
`privileged`. Een optionele alleen-lezen statusfile-adapter levert handshake-tijden.
Recorderbereikbaarheid gebruikt uitsluitend de opgeslagen recorder en RTSP-poort met
een korte TCP-timeout; er is geen ping- of subnetscan. Iedere locatiecheck is geïsoleerd
met `Promise.allSettled`, zodat één storing de rest niet blokkeert.

## 24. Dahua TCP / SDK-apparaattransport

Camera's behouden hun bestaande RTSP-configuratie. Een additief `DeviceConnection`-record
kan daarnaast aan precies één camera of recorder toebehoren. Hierdoor is een hybride
configuratie mogelijk: Dahua TCP voor apparaatinfo, events en kanalen, en RTSP voor het
videobeeld. De generieke apparaattransportgrens is `DeviceConnectionProvider`; de
huidige implementatie is `DahuaTcpProvider`. RTSP-diagnose en framecapture blijven in
hun bestaande, afzonderlijke camera- en video-workerlagen.

```text
Dahua NVR
  +-- DeviceConnection: DAHUA_TCP_SDK / TCP 37777
  |     apparaatinfo, capabilities en kanalen (alleen indien SDK-bevestigd)
  +-- Recorder.rtspPort / Camera RTSP-configuratie
        videostream en snapshot
```

TCP 37777 is door Dahua gedocumenteerd als de standaard private-protocolpoort. Het
platform implementeert dat private protocol bewust niet zelf. De huidige provider doet
DNS-validatie en een begrensde TCP-connectietest. De interface `DahuaSdkAdapter` is het
integratiepunt voor een later geïnstalleerde officiële native NetSDK. Zolang die adapter
niet aanwezig is, blijven authenticatie, apparaattype, model, firmware, kanalen en alle
capabilities `UNKNOWN`; een open TCP-poort wordt niet als geslaagde Dahua-authenticatie
voorgesteld.

Capabilities gebruiken uitsluitend `SUPPORTED`, `UNSUPPORTED` en `UNKNOWN`. Alleen een
officiële adapter mag bevestigde apparaatwaarden invullen. Devicecredentials gebruiken
dezelfde AES-256-GCM-secretlaag als RTSP, worden uit API-responses verwijderd en zijn
expliciet geredigeerd in requestlogging. De TCP-probe verstuurt geen payload, gebruikt
een korte timeout en blokkeert localhost, loopback, link-local, multicast en adressen
waarnaar een hostnaam veilig opnieuw is geresolved. Alleen `cameras.manage` mag testen of
wijzigen. De video-worker selecteert alleen actieve camera's met een RTSP-host, zodat een
TCP-only configuratie geen foutieve videoloop start.


## Mobiel, tijdzones en rijrichting (14 september 2026)

De bestaande `VpnLocation` draagt nu een IANA-tijdzone. Nieuwe passages bewaren de opgeloste zone naast de UTC-timestamp. Gedeelde Luxon-utilities verzorgen presentatie en lokale zoekgrenzen; genormaliseerde passage-richting is INCOMING/OUTGOING/UNKNOWN. Historische BOTH blijft leesbaar als Onbekend. CGI geeft RealUTC voorrang op UTC, zonder historische herschrijving.

Livebeelden blijven op verzoek buiten deze fase. De bestaande video-worker blijft uitsluitend snapshots en cameragezondheid verwerken; HLS/WebRTC, browserrestreaming en main/substreamkeuzes zijn toekomstwerk. Zie [ontwerp, tests, grenzen en handmatige stappen](mobile-time-direction.md).

## Compact ADMIN-overzicht op Instellingen (14 september 2026)

`GET /admin/overview` gebruikt de strikte ADMIN-rolcontrole. Programma meet de bestanden die in de draaiende API-container zichtbaar zijn, inclusief haar dependencies en build. Opslag telt de huidige PostgreSQL-database en het gedeelde mediavolume op. Docker-image­lagen, andere containerlagen en Docker-logs zijn niet in de API-container beschikbaar en worden daarom niet geschat. Een niet meetbare categorie en daarmee het totaal wordt als `null`/“Niet beschikbaar” weergegeven.

Dezelfde endpoint selecteert de laatste twintig `AuditLog`-regels op `createdAt DESC, id DESC`. Alleen ID, UTC-tijdstip, actor, vertaald actielabel, afgeleid objectlabel en een korte omschrijving verlaten de API. `oldValue`, `newValue`, `metadata`, IP-adres en alle mogelijke secrets blijven server-side. De UI formatteert het tijdstip centraal in `PLATFORM_TIMEZONE`. Bestaande logging dekt authenticatie, gebruikers/rollen, camera’s, locaties/VPN, kentekens, groepen, pushinstellingen en bestaande passage-acties; de pagina maakt geen nieuwe auditkopieën.

## Patroonanalyse en onderhoudsgrenzen (18 september 2026)

Na iedere opgeslagen passage maakt dezelfde transactie een begrensde
`AttentionAnalysisJob`. De ANPR-worker verwerkt deze jobs asynchroon en schrijft één
`AttentionSnapshot` per passage. API en web lezen score, confidence en redenen; de
frontend berekent geen eigen score. Reviews zijn gekoppeld aan de snapshot en vereisen
de bestaande ADMIN-controle. Verlopen snapshots volgen de passage-retentie.

Een conservatieve codebase-audit verwijderde uitsluitend statisch aantoonbaar dode
helpers. Historische migrations, fase-resultaten, demo-seed, rooktests, providergrenzen
en ongebruikte datamodellen met mogelijk bestaande data blijven behouden. Frequente
frontendpolling werkt de sessieactiviteit hoogstens eens per vijf minuten bij, zodat
`lastSeenAt` bruikbaar blijft zonder iedere poll als database-write uit te voeren.
