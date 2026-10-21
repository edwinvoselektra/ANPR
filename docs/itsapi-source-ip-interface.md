# Verwachte bron-IP instellen via cameradiagnose

## Gevonden oorzaak en afbakening

In de onderzochte checkout (`6194983`, vóór deze correctie) bestond het veld al in `ItsapiSetup`, inclusief PUT-payload en GET-teruglezing. De database, migratie `20261021000100_itsapi_source_identity` en de receiver bevatten `expectedSourceIp` eveneens al. Een migratie alleen maakt geen veld zichtbaar in de interface.

De diagnosepagina plaatste het hele adminformulier onderaan, na alle diagnosekaarten, in een standaard gesloten `<details>`. Daarnaast verborg `.catch(()=>setSetup(false))` bij een fout in `/auth/me` of `/cameras/:id` het formulier zonder melding. Deze twee concrete oorzaken van onzichtbaarheid zijn hersteld. Zonder inspectie van de productiecontainer kan niet worden bewezen of daar de gesloten sectie, een laadfout of een oudere checkout/build de melding verklaarde. De uitrolcontrole hieronder controleert daarom ook de bronversie.

**Camera bewerken** verwijst naar **Diagnose en ITSAPI instellen**. De algemene camera-GET/PATCH gebruiken `Camera`; `publicCamera` publiceert de uploadregistratie niet. ITSAPI-instellingen horen bij de aparte, admin-beveiligde GET/PUT `/cameras/:id/itsapi`, die `ItsapiRegistration` leest en binnen een Prisma-transactie opslaat. Dat onderscheid blijft behouden: er is geen tweede opslagplek of parallel bron-IP-veld aan Camera toegevoegd. Het frontend-registratietype bevat `expectedSourceIp`; er was geen gedeeld ITSAPI-formuliertype dat dit veld wegfilterde.

## Veranderingen

- Het adminformulier staat direct zichtbaar boven de diagnosekaarten. De pagina toont een Nederlandse foutmelding en herlaadknop als de toegangs-/cameracontrole mislukt. Operatoren krijgen het formulier niet; de API controleert adminrechten onafhankelijk hiervan.
- Het veld heet **Verwachte bron-IP (VPN/NAT)**, met de gevraagde volledige uitleg. Het bestaande camera-IP voor RTSP/camerabeheer wordt afzonderlijk getoond.
- Het formulier haalt instellingen met `cache: no-store` op en leest ze na opslaan opnieuw terug. Bij een laadfout is opslaan niet beschikbaar. Bij mislukte herlezing wordt dat expliciet gemeld; een nieuwe pagina leest nooit uitsluitend frontend-state terug.
- Nederlandse API-veldvalidatie wordt zichtbaar gemaakt. De backend accepteert uitsluitend een geldig IPv4-adres of leeg/NULL voor dit veld. IPv6, hostnamen en subnetten worden afgewezen. Leeg wordt NULL in PostgreSQL. Een oudere client die het veld weglaat behoudt de opgeslagen waarde.
- De bestaande unieke DeviceID, broncontrole op beide ITSAPI-endpoints, transactie en `configVersion`-intrekking blijven behouden. Geen wijzigingen aan RTSP, WireGuard of cameracredentials. Voor de gemelde camera met authenticatie uit betekent een leeg veld weer broncontrole tegen het camera-IP. Het bestaande Digest-beleid is niet veranderd.
- Geen nieuwe migratie nodig; volgens de gebruiker is de bestaande migratie al uitgevoerd op productie.

Gewijzigde bestanden:

| Bestand | Doel |
| --- | --- |
| `apps/web/app/cameras/[id]/diagnose/page.tsx` | Direct zichtbare admininstellingen, onderscheid adressen, zichtbare toegangs-/laadfouten |
| `apps/web/components/ItsapiSetup.tsx` | Veldtekst, laden/teruglezen en foutafhandeling |
| `apps/api/src/routes/camera-onboarding.ts` | IPv4-validatie met Nederlandse foutmelding |
| `apps/web/app/cameras/[id]/diagnose/page.test.tsx` | Vindbaarheid, admin/operator, herstel bij laadfout |
| `apps/web/components/ItsapiSetup.test.tsx` | Opslaan, wijzigen, leegmaken, heropenen en foutmeldingen |
| `apps/api/src/itsapi-configuration.test.ts` | Echte auth-middleware, GET, IPv4-validatie, bestaande registratiechecks |
| `scripts/itsapi-configuration-smoke.mts` | Echte PostgreSQL-test via beheer-API tot receiver/passages |
| `README.md`, `docs/itsapi-vpn-identification.md`, dit document | Gedrag, verificatie en exacte uitrolinstructies |

## Lokaal testen

```bash
cd /home/edwin/projects/anpr-platform
npm run db:generate
npm run typecheck
npm run lint
npm run test -w @anpr/api -- --configLoader runner
npm run test -w @anpr/web -- --configLoader runner
npm run build -w @anpr/api
npm run build -w @anpr/web
```

De runner-optie voorkomt de hier aanwezige niet-schrijfbare Vite-configcache. De bestaande Dahua-tests in de volledige API-set starten een tijdelijke lokale HTTP-server en hebben toestemming voor lokale sockets nodig.

Voor echte PostgreSQL-integratie: start eerst Docker Desktop, daarna onderstaande opdrachten. De test weigert iedere databasenaam behalve `anpr_native_test`; het gaat om synthetische fixtures. Geen productie-.env laden.

```bash
cd /home/edwin/projects/anpr-platform
docker.exe run --rm --detach --name anpr-itsapi-source-test --publish 127.0.0.1:55439:5432 --env POSTGRES_DB=anpr_native_test --env POSTGRES_USER=itsapi_test --env POSTGRES_PASSWORD=synthetic_local_test postgres:16-alpine
docker.exe exec anpr-itsapi-source-test pg_isready -U itsapi_test -d anpr_native_test
```

Herhaal alleen de tweede opdracht als de database nog opstart. Bij "accepting connections":

```bash
(
  export DATABASE_URL=postgresql://itsapi_test:synthetic_local_test@127.0.0.1:55439/anpr_native_test
  export CAMERA_CREDENTIALS_KEY=0000000000000000000000000000000000000000000000000000000000000000
  export REDIS_URL=redis://127.0.0.1:6379
  export WEB_ORIGIN=http://localhost:3000
  npm run db:migrate && npx tsx scripts/itsapi-configuration-smoke.mts && npx tsx scripts/itsapi-processing-smoke.mts
)
docker.exe stop anpr-itsapi-source-test
```

Gebruik op Linux `docker` in plaats van `docker.exe`. De nieuwe smoke test gebruikt de echte sessie-/admincontrole, schrijft via PUT, controleert de database onafhankelijk, haalt via GET terug, wijzigt en wist de waarde, controleert ongeldige invoer en niet-adminrechten, en verwerkt daarna synthetische KeepAlive/TollgateInfo vanaf directe en VPN-bronnen. Fixtures worden opgeruimd; er vindt geen database-reset plaats.

Aanvankelijk was Docker Desktop niet bereikbaar. Op 21 oktober 2026 zijn de PostgreSQL-smokes en Docker-controles alsnog succesvol uitgevoerd via de Linux Docker-CLI in WSL (engine 29.8.1). De echte databasecontrole is dus nu ook bevestigd; zie de resultaten hieronder.

## Naar productie brengen — alleen zelf uitvoeren na review

Er is niets gecommit, gepusht of gedeployd tijdens deze correctie. Controleer eerst lokaal de tests en de wijzigingen. Deze checkout gebruikt branch `main` en remote `origin` naar `edwinvoselektra/ANPR`.

Lokaal, om alleen deze correctie vast te leggen en te pushen:

```bash
cd /home/edwin/projects/anpr-platform
git diff --check
git add README.md docs/itsapi-source-ip-interface.md docs/itsapi-vpn-identification.md apps/api/src/routes/camera-onboarding.ts apps/api/src/itsapi-configuration.test.ts 'apps/web/app/cameras/[id]/diagnose/page.tsx' 'apps/web/app/cameras/[id]/diagnose/page.test.tsx' apps/web/components/ItsapiSetup.tsx apps/web/components/ItsapiSetup.test.tsx scripts/itsapi-configuration-smoke.mts
git diff --cached --stat
git commit -m "Make ITSAPI source IP settings accessible and validate IPv4"
git push origin main
git rev-parse --short HEAD
```

Op de productieserver, vanuit de bestaande projectcheckout (het absolute productiepad is niet bekend), eerst:

```bash
git status --short
git branch --show-current
```

Ga alleen verder als je de bedoelde `main`-checkout zonder lokale bronwijzigingen hebt; behoud bestaande .env en volumes. Onderstaande opdrachten halen de correctie op, controleren de nieuwe broncode en bouwen dezelfde bestaande Compose-productiontargets:

```bash
git pull --ff-only origin main
git rev-parse --short HEAD
rg -n 'Verwachte bron-IP|setLoadError' apps/web/components/ItsapiSetup.tsx
rg -n 'itsapi-settings-heading|setError' 'apps/web/app/cameras/[id]/diagnose/page.tsx'
docker compose -f docker-compose.yml -f docker-compose.external.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.external.yml build api web
docker compose -f docker-compose.yml -f docker-compose.external.yml run --rm --no-deps api node_modules/.bin/prisma migrate status --schema packages/database/prisma/schema.prisma
```

Vergelijk de commit met de lokale uitvoer. De migratiestatus moet bevestigen dat de database actueel is, inclusief `20261021000100_itsapi_source_identity`. Deze correctie voegt geen migratie toe. Pas na succesvolle build en controle:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --no-deps --force-recreate api web
docker compose -f docker-compose.yml -f docker-compose.external.yml ps api web
docker compose -f docker-compose.yml -f docker-compose.external.yml logs --since 5m api web
```

Geen `down -v`, reset of automatische verandering van productie-instellingen uitvoeren. De bestaande overlay blijft de API starten uit gecompileerde JavaScript en de webapp uit de Next standalone-build.

## Productiecontrole Staverhul

1. Log in als administrator. Open **Camera’s → Staverhul → Diagnose en ITSAPI instellen**. Boven de diagnosekaarten staat direct **ITSAPI-uploadinstellingen (admin)**. Als het laden mislukt verschijnt nu een foutmelding; als deze nieuwe paginaopbouw helemaal ontbreekt, controleer dan eerst de getoonde commit/build en de daadwerkelijk bezochte server.
2. Controleer het afzonderlijk getoonde camera-IP `10.20.10.201`. Vul **Verwachte bron-IP (VPN/NAT)** in met `10.99.0.11`. Behoud Device ID `853db863-a19f-f41d-74a0-a81642aaa19f`, ontvangstadres `http://10.99.0.1:7070`, protocol `V1.19` en Digest uit, overeenkomstig de fysieke camera.
3. Klik **Uploadinstellingen opslaan**, controleer de teruggelezen opgeslagen bron, verlaat de pagina en open deze opnieuw. Het veld moet nog `10.99.0.11` bevatten; het camera-IP blijft `10.20.10.201`. Dit is de eerste productiecontrole op persistentie.
4. Laat de camera zelf een nieuwe KeepAlive en daarna één echte voertuigpassage sturen. Controleer de 200-responsen op beide paden en actuele heartbeat/passagediagnose voor dezelfde camera en configuratieversie. **Opnieuw testen** test RTSP; die knop verstuurt geen camera-ITSAPI-event.
5. Controleer bij **Live passages/Zoeken** een nieuw opgeslagen event van Staverhul met ontvangsttijd en bijbehorende beelden waar de camera die meestuurt. Een retry mag geen extra passage opleveren. Een testhit ontstaat alleen bij een bestaande bewuste testlijstmatch.

De receiverlogs zijn op te vragen met:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml logs --since 5m api
```

Bewaar bij een resterende fout alleen tijdstip, pad, HTTP-status en foutcode. Geen payload-/Authorization-capture nodig. Onbekende DeviceID en verkeerde socketbron blijven 403 in de tests. Voer negatieve synthetische uploads uitsluitend op een aparte testregistratie uit; verander daarvoor niet de echte Staverhul-registratie.

## Uitgevoerde controles bij deze correctie

- Volledige API-suite: **286/286 geslaagd**, inclusief de bestaande directe/NAT-receiverchecks en adminmiddleware op de configuratie-API.
- Volledige websuite: **83/83 geslaagd**, inclusief 10 nieuwe formulier-/diagnosegevallen.
- Workspace-TypeScript en lint: geslaagd.
- API-build en Next.js-webbuild: geslaagd.
- Syntaxcontrole nieuwe PostgreSQL-smoke en `git diff --check`: geslaagd.
- Echte PostgreSQL-integratie: alle drie scripts geslaagd, inclusief onafhankelijke DB-teruglezing van `expectedSourceIp`, wijzigen/leegmaken, bronpolicy op beide endpoints, unique DeviceID, passage-/beeldopslag, hits, retries en Digest/replaycontrole.
- Alle 14 bestaande migraties succesvol toegepast op uitsluitend de nieuwe lokale testdatabase; geen schemawijziging, reset of wijziging aan bestaande databases.
- API- en webproductieimages lokaal gebouwd onder aparte tags; beide runtimecontroles geslaagd. De webimage bevat aantoonbaar het bron-IP-veld in de browserassets.
- Compose-basisconfiguratie en external-overlay beide gevalideerd met `.env.example`, zonder bestaande services te starten.
- Volledige workspace-testset opnieuw uitgevoerd: **537/537 tests in 69 testbestanden geslaagd** (ANPR-worker 53, API 286, video-worker 9, web 83, database 31, shared 75). Workspace-TypeScript en lint opnieuw geslaagd.

Daarmee zijn de formulier-/API-controles, daadwerkelijke PostgreSQL-persistentie en verwerking tot passageopslag lokaal bevestigd. Socketbronnen zijn in de tests synthetisch geïnjecteerd; de fysieke WireGuard-route en camera op productie zijn niet getest. Er is geen productie-deployment uitgevoerd.


### Isolatie en controlebewijs van de hervatte tests

Alle Docker-acties gebruikten de nieuw aangemaakte containers `anpr-itsapi-source-check-20261021-a` en `anpr-itsapi-web-check-20261021-a`, met label `anpr.scope=itsapi-source-local-verification`. De PostgreSQL-container gebruikte tmpfs, geen bestaand volume, en een willekeurige localhostpoort (deze run: `63316`). De web-runtimecontrole had `--network none`; de API-runtimecontrole deelde alleen het netwerk van de testdatabase. Bestaande containers, configuraties en databases zijn niet aangepast. Alleen eigen synthetische records zijn door de tests opgeruimd; de eindcontrole telde nul camera's, registraties en passages in de testdatabase. De twee testcontainers zijn na afronding gestopt; de aparte testimages blijven beschikbaar.

Gebouwde images: `anpr-platform-api:itsapi-source-local-check` en `anpr-platform-web:itsapi-source-local-check`. Er zijn geen bestaande imagetags overschreven.

Lokale bewijslogs zijn genegeerd door Git:

- `itsapi-source-postgres-migrate.log`, `itsapi-source-postgres-summary.log`
- `itsapi-source-postgres-configuration.log`, `itsapi-source-postgres-processing.log`, `itsapi-source-postgres-protocol.log`
- `itsapi-source-docker-api-build.log`, `itsapi-source-docker-web-build.log`
- `itsapi-source-docker-api-runtime.log`, `itsapi-source-docker-web-runtime.log`
- `itsapi-source-all-tests.log`, `itsapi-source-typecheck.log`, `itsapi-source-lint.log`
