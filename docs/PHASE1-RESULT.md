# Resultaat Fase 1

Datum: 27 augustus 2026

## Status van de oplevering

De volledige Fase-1-broncode is gebouwd en technisch gecontroleerd. Via toegestane
Docker-uitvoering zijn de images gebouwd, migratie en seed uitgevoerd, alle services
gestart en healthchecks gecontroleerd. De stack draait met PostgreSQL, Redis, API en web
gezond. De volledige dependency-audit meldt `0 vulnerabilities`.

Een zelfopruimende runtime-smoketest heeft tegen de echte PostgreSQL-database bewezen:

- login en opaque sessies;
- Administrator-toegang tot dashboard, camera's, gebruikers en simulator;
- camera aanmaken, activeren, RTSP testen en verwijderen;
- echte FFmpeg/RTSP-foutclassificatie voor een onbereikbare testhost;
- genereren van een echte, expliciet gemarkeerde DEMO-passage;
- Viewer mag camera's lezen, maar krijgt op een directe beheer-API-call `403`.

De tijdelijke testgebruikers, camera en passage zijn na de test verwijderd.

## Daadwerkelijk geïmplementeerd

- NPM-workspace-monorepo met afzonderlijke Next.js-webapp, Fastify-API, databasepackage
  en gedeelde utilities;
- PostgreSQL/Prisma-schema plus initiële migratie voor alle gevraagde kernmodellen;
- Redis-service en healthcheck (queues/workers volgen Fase 2);
- veilige opaque cookiesessies, bcrypt-wachtwoorden, login-rate-limit, lockout,
  sessie-intrekking en uitloggen op alle apparaten via API;
- databasegestuurde rollen en permissions voor Administrator, Operator en Viewer;
- server-side afgeschermd gebruikersbeheer;
- dashboard met echte databasecijfers, passages, hits en camerastoringen;
- camera CRUD, activeren/inactiveren en credentialveilige bewerkflow;
- vijfstaps-camerawizard met algemene gegevens, beide verbindingsmethoden, echte
  verbindingstest, snapshot, rechthoekzone, ANPR-TODO en afronden;
- AES-256-GCM encryption-at-rest voor RTSP-gebruikersnaam en -wachtwoord;
- echte `ffprobe`/FFmpeg-test met timeout en onderscheiden foutcategorieën;
- lokale snapshotopslag in persistent Docker-volume;
- development seed met Uddel Noord/Oost/West, Aandacht, 12-ABC-3, testpassages en hit;
- expliciete DEMO-simulator die echte databaserecords maakt, zonder ANPR te veinzen;
- liveness/readiness en beveiligde systeemstatus;
- tests voor normalisatie, hashing/encryptie, API-liveness, auth-afscherming,
  Viewer-permissions, retentie, hitbeslissing en schema-aanwezigheid;
- veilige interactieve eerste-administratorflow zonder standaardwachtwoord.
- reproduceerbare installs via `package-lock.json` en `npm ci`;
- gepatchte Next.js/Fastify/Vitest-versies en een schone npm-audit.
- geldig Git-repository op branch `main`, zonder initiële commit, met secrets en lokale
  runtime-/Codex-data uitgesloten via `.gitignore`.

## Architectuur

Zie [architecture.md](architecture.md). De hoofdstroom blijft gescheiden in camera,
ingest, detectie/tracking, ANPR-provider, passage, persistence, hits, notificaties en UI.
Fase 1 implementeert camera/configuratie en management; video/ANPR blijven aparte
toekomstige workers.

## Docker-services en poorten

| Service | Functie | Hostpoort |
|---|---|---:|
| `web` | Next.js-interface | 3000 |
| `api` | Fastify REST API + FFmpeg | 4000 |
| `postgres` | PostgreSQL 16 | niet gepubliceerd |
| `redis` | Redis 7 | niet gepubliceerd |
| `migrate` | eenmalige Prisma-migratie | geen |
| `seed` | handmatige tools-profile seed | geen |

Persistente volumes: `postgres_data`, `redis_data`, `storage_data`.

## Starten, stoppen en URL's

Eerste installatie:

```bash
cd /home/edwin/projects/anpr-platform
bash scripts/setup-env.sh
docker compose up -d --build
docker compose --profile tools run --rm seed
docker compose run --rm api npm run admin:create
```

Open webapp: `http://localhost:3000`

API liveness: `http://localhost:4000/health`

Stoppen zonder data te verwijderen:

```bash
docker compose down
```

## Eerste administrator en inloggen

De interactieve `admin:create`-opdracht vraagt om e-mail, gebruikersnaam,
weergavenaam en tweemaal een verborgen wachtwoord. Daarna log je op de webapp in met
e-mail óf gebruikersnaam en dat wachtwoord. Er is geen hardcoded beheerder.

## Simulator testen

Open na login **Demo / simulator**, kies een Uddel-camera en genereer een passage.
`12-ABC-3` maakt door de seed een expliciete DEMO-hit. Ververs daarna Dashboard.

## Camera toevoegen en RTSP testen

Open **Camera's → Camera toevoegen**, doorloop de wizard en klik in stap 2 op
**Verbinding testen**. Bij succes verschijnt waar de stream dit toelaat een snapshot.
Fouten noemen authenticatie, DNS/netwerk, gesloten poort, stream/path, timeout of een
algemene FFmpeg-fout. In stap 3 kan met muis of touchscreen een rechthoek worden
getekend. Stap 4 vermeldt eerlijk dat echte ANPR in Fase 2 komt.

## Bekende beperkingen / TODO

- echte ANPR, voertuigdetectie, tracking en continue RTSP-ingest: Fase 2;
- polygon-editor (rechthoek werkt) en kaartklik voor coördinaten: latere UI-uitbreiding;
- live HLS/WebRTC, live passages en workers: Fase 2;
- kenteken-/groep-/hitbeheer en zoeken: Fase 3 (datamodel bestaat al);
- PWA, Web Push en meldkamer: Fase 4;
- automatische retentiecleanup, back-upautomatisering en uitgebreide monitoring: Fase 5;
- tijdelijke testsnapshots worden nog niet periodiek opgeschoond;
- frontend voor actieve sessies/uitloggen-op-alle-apparaten volgt; API is aanwezig;
- een succesvolle RTSP-test en snapshot met een echte camera vereist uiteraard geldige
  camera-inloggegevens en moet door de beheerder op het eigen cameranetwerk worden getest.

## Uitgevoerde kwaliteits- en runtimecontrole

De volgende controles zijn succesvol uitgevoerd:

- Docker Compose-configuratie en development-imagebuilds;
- Prisma-schema en initiële migratie;
- API TypeScript/productiebouw;
- Next.js TypeScript/productiebouw voor alle negen routes;
- database-TypeScriptcontrole;
- API-, web- en shared linting zonder waarschuwingen;
- 32 geautomatiseerde tests: 6 API, 7 shared, 18 database en 1 web;
- zelfopruimende echte runtime-smoketest;
- npm-audit inclusief dev-dependencies: `0 vulnerabilities`;
- PostgreSQL, Redis, API en web: Docker-health `healthy`;
- readiness: database, Redis, storage en FFmpeg `healthy`;
- video- en ANPR-worker correct als `not_implemented / TODO Fase 2`.

## Nog benodigde persoonlijke handeling

Er is bewust geen standaardadministrator aangemaakt. Maak nu je persoonlijke eerste
administrator aan met exact:

```bash
cd /home/edwin/projects/anpr-platform
docker compose run --rm api npm run admin:create
```

Open daarna `http://localhost:3000`, log in en test een echte camera via de wizard. Een
succesvolle snapshot kan alleen met jouw eigen bereikbare RTSP-camera worden bevestigd.

## Troubleshooting

- Buildfout: `docker compose logs --tail=200 migrate api web`.
- API niet ready: controleer `/health/ready` en de PostgreSQL/Redis-health in `docker compose ps`.
- RTSP-test faalt: controleer of de camera vanaf het Docker-netwerk bereikbaar is en
  gebruik de specifieke foutmelding uit de wizard.
- `.env` bestaat al: `setup-env.sh` stopt bewust en overschrijft niets.
- Verwijder nooit volumes om een gewone startfout op te lossen; daarin staat data.

## Fase 2

Fase 2 bouwt afzonderlijke video- en ANPR-workers, Redis/BullMQ-jobs, continue RTSP-
ingest, frame-selectie, tracking, een verwisselbare `ANPRProvider`, eerste echte engine,
passagevorming, beeldopslag en duplicate detection.
