# Dahua ITSAPI: heartbeat, passages en uitrol

## Status — 2 oktober 2026

De receiver heeft afzonderlijke POST-handlers voor `/NotificationInfo/KeepAlive` en `/NotificationInfo/TollgateInfo`. Voor het ondersteunde **Picture-profiel** verwerkt hij identiteit, heartbeat, passage, JPEG-beelden, watchlist-hit en de bestaande pushopdracht. Succes volgt pas na een databasecommit of herkenning van een bestaande passage. `ItsapiInbox` blijft uitsluitend een begrensde diagnostische laag; ruwe payloads worden daar niet opgeslagen.

**De fysieke camera is nog niet met deze implementatie getest.** Volgens de gebruiker stuurt `192.168.178.248` JSON naar `192.168.178.52:7070`. Er is geen geschoonde payload of ACK-capture van die camera aangeleverd. De implementatie ondersteunt een expliciet afgebakend profiel; een afwijkende firmwarestructuur krijgt een fout, geen verzonnen succes. `/health` houdt daarom `protocolVerified:false` en `cameraConnectionProven:false`: deze endpoint is geen camera-acceptatietest.

Protocolbasis: [Dahua Web 5.0-handleiding §9.4.9.3](https://material.dahuasecurity.com/uploads/cpq/DOR/PUM0004975/Smart_ANPR_Camera_Web_5.0_Operation_Manual_V1.0.0.pdf) bevestigt HTTP/JSON/Digest, maar specificeert niet alle payloadvelden. De [gepubliceerde push-integratiespecificatie §§4.2–4.3](https://www.scribd.com/document/964042803/Integration-Push-function-2) beschrijft het geïmplementeerde Picture-profiel en de ACKs; dit document betreft Intelbras, **geen bewijs voor Dahua V1.19 op deze specifieke camera**. Een [door de auteur gepubliceerde ITC413-implementatie](https://gist.github.com/paindefender/cf74164ade12f8a2954f271f3d5972e7) gebruikt eveneens `Picture`, maar een andere heartbeat-response. Die variatie maakt de fysieke acceptatietest noodzakelijk. De referentie-implementatie is niet gekopieerd; onder meer bestandsnamen en ongecontroleerde succesresponses worden hier niet overgenomen.

## Ondersteunde velden

Heartbeat: object met `Active: "keepAlive"` en `DeviceID`. Device ID moet exact overeenkomen met `ItsapiRegistration.expectedDeviceId`; geconfigureerde protocolversie moet `V1.19` zijn.

TollgateInfo: één object onder `Picture`, geen batch of multipart.

| Payloadveld | Verwerking |
| --- | --- |
| `Plate.PlateNumber` | Verplicht kenteken; origineel, genormaliseerd en weergavewaarde in passage |
| `Plate.IsExist` | Indien false: geen passage; 422 |
| `SnapInfo.DeviceID` | Verplicht; exact vergelijken met registratie |
| `SnapInfo.AccurateTime`, anders `SnapTime` | Verplichte gebeurtenistijd; milliseconden behouden |
| `Plate.Channel` | Onderdeel van eventidentiteit; standaard 0 |
| `Plate.Confidence` | Optioneel geheel getal 0–255, opgeslagen als waarde / 255 |
| `Vehicle.VehicleType` | Bekende teksttypen naar platformenum; anders UNKNOWN |
| `Vehicle.VehicleColor` | Bekende tekstkleuren naar platformenum; anders OTHER |
| `Vehicle.VehicleSign` | Optioneel merk |
| `SnapInfo.Direction` | Approach/Incoming en Away/Outgoing via bestaande camerarichtingmapping |
| `SnapInfo.SnapAddress` | Optionele passagelocatie; anders geconfigureerde cameralocatie |
| `SnapInfo.LanNo` | Optionele rijstrook |
| `NormalPic.Content` | Original Image, base64 JPEG |
| `CutoutPic.Content` | Plate Cutout, base64 JPEG |
| `VehiclePic.Content` | Vehicle Body Cutout, base64 JPEG |

Niet herkende richtingswaarden, waaronder `Obverse` en `Reverse`, worden als `rawDirection` bewaard en geven richting UNKNOWN. Hun relatie tot de opgestelde camera is nog niet vastgesteld; er wordt geen rijrichting verzonnen. Ook de confidence-schaal 0–255 moet bij de fysieke camera worden bevestigd. Ontbrekende of onbruikbare optionele voertuigmetadata blokkeert geen passage.

Tijd zonder offset gebruikt de tijdzone van de cameralocatie, anders `PLATFORM_TIMEZONE`. Ongeldige tijden en dubbelzinnige of niet-bestaande lokale zomertijdmomenten worden geweigerd. Er is **geen ontvangsttijd-fallback**, omdat die retries tot nieuwe events zou maken.

Ontbrekende beelden of lege `Content` zijn toegestaan. Aangeleverde beelden moeten canonieke base64 met JPEG-begin/eindmarkeringen zijn, maximaal 8 MB per beeld en gezamenlijk binnen de 16 MB requestlimiet. Dit is formaat-/groottevalidatie, geen volledige JPEG-decodering. Geen downloads vanaf payload-URL's, geen gebruik van `PicName` als opslagpad en geen beeldbewerking in de API. De modulaire async opslagprovider schrijft naar disk/NAS; PostgreSQL bevat alleen objectverwijzingen. Een ongeldige aangeleverde afbeelding geeft 422; een opslagfout geeft 503.

## Responses en authenticatie

Authenticatie is per ITSAPI-registratie instelbaar en staat standaard aan. Met authenticatie aan blijft HTTP Digest verplicht. Met authenticatie uit zoekt de receiver de camera uitsluitend op via het exacte Device ID uit de payload en accepteert hij het bericht alleen wanneer het rechtstreekse socket-bron-IP exact gelijk is aan het vaste `Camera.rtspHost`. Alleen actieve camera's of geldige conceptcamera's met provider `DAHUA_ITSAPI` komen in aanmerking. `X-Forwarded-For` en vergelijkbare headers worden niet vertrouwd. Een onbekend of niet-uniek Device ID en een afwijkend bron-IP geven geen onbeveiligde terugval.

Alleen geldige en gecommitte berichten krijgen HTTP **200** met `Content-Type: application/json; charset=utf-8` en de door Fastify bepaalde juiste `Content-Length`:

```json
{"Active":true,"DeviceID":"<gevalideerde Device ID>"}
```

Bovenstaand is KeepAlive. TollgateInfo, inclusief een idempotent herkende retry:

```json
{"Result":true,"DeviceID":"<gevalideerde Device ID>"}
```

De body bevat geen kenteken, whitelist-/blacklistopdracht of slagboomcommando.

| Status | Betekenis |
| --- | --- |
| 401, lege body | Digest staat voor deze camera aan en ontbreekt/is ongeldig, of nonce-count replay; nieuwe Digest-challenge |
| 403 | Onbekend/afwijkend Device ID, verkeerd vast bron-IP of ingetrokken/gewijzigde cameraconfiguratie |
| 422 | Onbekende/ongeldige payload, tijd of beeld; ontbrekende configuratie; conceptcamera bij passage |
| 400 / 413 / 415 | Ongeldige JSON / request te groot / content-type niet ondersteund |
| 429 | Rate limit |
| 503 | Receiver bezet, databasefout of beeldopslagfout; geen ACK |
| 501 | Ander, niet ondersteund endpoint of methode via de fallback-handler |

Fouten hebben een veilige `error`-code. Payloadfouten bevatten ook een vaste uitleg en `missing` met verwachte schemavelden, nooit aangeleverde waarden. De eerste 401 in een Digest-handshake is normaal wanneer Digest voor die camera aan staat. Een herhaalde Digest-upload moet een nieuwe geldige nonce-count of een nieuwe challenge gebruiken: eventdeduplicatie schakelt de Digest-replaybeveiliging niet uit.

## Transactie, retries en status

De gedeelde `PassageService` wordt door CGI en ITSAPI gebruikt. Het bestaande CGI-gedrag blijft beschikbaar. Voor ITSAPI geldt:

1. De per-camera-authenticatiemodus, bronidentiteit en payload valideren; Device ID vergelijken. Met Digest uit moeten Device ID en rechtstreeks socket-bron-IP beide bij dezelfde configuratie horen. Alleen actieve, niet-gearchiveerde productiecamera's mogen passages maken. Concepten kunnen een geldige heartbeat leveren, maar geen echte passages.
2. Eventkey: `itsapi:picture:v1:` plus SHA-256 van camera-ID, Device ID, exacte UTC-gebeurtenistijd, genormaliseerd kenteken en kanaal. Ontvangsttijd, uploadteller, beeldbytes en optionele voertuigvelden zitten niet in deze sleutel.
3. Ontbrekende beelden via de opslagprovider opslaan. Een reeds volledig opgeslagen retry heeft geen nieuwe beeldwrites nodig.
4. Camera in een PostgreSQL-transactie vergrendelen en actieve status, provider en configuratieversie opnieuw controleren. Binnen die lock de eventidentiteit opnieuw opzoeken. De bestaande unieke constraint `(cameraId, source, sourceEventId)` blijft de databasegarantie.
5. Nieuwe passage, voertuig/plate-detection, attention-job en `detectAndCreateHit` in dezelfde transactie. Een hit krijgt de bestaande PENDING-pushstatus; de centrale dispatcher handelt die af.
6. Een retry maakt geen nieuwe passage/hit/job. Later meegeleverde beelden vullen lege beeldslots en hit-beeldverwijzingen aan. Bestaande beelden worden niet overschreven.
7. Device ID onder dezelfde lock opnieuw controleren en identiteit-/ontvangststatus vastleggen. Pas daarna ACK.

Voor idempotentie moeten kenteken, gebeurtenistijd en kanaal bij retries gelijk blijven. Bij alleen secondeprecisie kunnen twee verder identieke events binnen dezelfde seconde niet worden onderscheiden; het gebruik van `AccurateTime` verdient de voorkeur. Na definitieve passageverwijdering bestaat de bijbehorende deduplicatiesleutel niet meer. Dit is geen levenslang replayarchief.

`lastHeartbeatAt` wordt alleen door een geldige KeepAlive bijgewerkt. Geldige passages werken `lastEventAt` bij. Beide bevestigen `lastIdentityAt` en `anprConnectionStatus=CONNECTED`; een Digest-handtekening alleen doet dit niet. De heartbeatdiagnose wordt STALE na twee intervallen plus 30 seconden. `CONNECTED` is de laatst bevestigde ANPR-verbinding; de RTSP/videostatus blijft afzonderlijk. Configuratieversies voorkomen dat oud bewijs als nieuwe ontvangst geldt.

De pushdispatcher gebruikt al unieke ontvanger-/hitkeys. De integratietest bewijst één geslaagde verzending via een stub bij camera-retries; dit bewijst geen toestelontvangst en verandert de bestaande retries van de externe pushdienst niet.

## Logging en diagnose

Voor beide paden verschijnt één `itsapi_response`-log na de response met method, vast pad zonder querystring, statuscode, request-content-type, request-content-length en begrensde payloadstructuur. Content-type wordt gereduceerd tot application/json/other/none. Content-length is de opgegeven header, geen gemeten bytes. Voor vroege afwijzingen is de body `not_parsed`.

Geen scalarwaarden, credentials, Authorization, kentekens, beeldbytes of ruwe exceptions worden gelogd. Alleen toegestane schemaveldnamen blijven herkenbaar; overige namen worden `field_N`. De tijdelijke database-structuurdiagnose blijft maximaal 15 minuten inschakelbaar en kent een bewaartermijn van 24 uur, maximaal 32 regels per camera. `ItsapiInbox` bevat foutcode, ontbrekende velden en eventueel structuur; geen opnieuw verwerkbare passagepayload. Een gelijk diagnostisch fingerprint verhoogt `attempts`.

## Gewijzigde bestanden en productieartefacten

Neem de bronwijzigingen als één release mee; alleen `itsapi-receiver.ts` kopiëren is onvoldoende.

Runtime/build:

- `apps/api/src/itsapi-receiver.ts`
- `apps/api/src/lib/itsapi-parser.ts` (nieuw)
- `apps/api/src/lib/itsapi-protocol.ts`
- `apps/api/src/lib/camera-diagnostics.ts`
- `apps/api/src/routes/camera-onboarding.ts`
- `apps/web/components/ItsapiSetup.tsx`
- `apps/web/next.config.ts`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/migrations/20261002000100_itsapi_optional_authentication/migration.sql`
- `packages/shared/package.json`
- `packages/shared/src/anpr-event.ts` (nieuw)
- `packages/shared/src/passage-service.ts` (verplaatst uit worker, uitgebreid)
- `packages/shared/src/passage-storage.ts` (verplaatst uit worker)
- `apps/anpr-worker/src/passage-service.ts`, `storage.ts`, `types.ts` (hergebruik gedeelde code)

Tests/documentatie:

- `apps/api/src/itsapi.test.ts`
- `apps/api/src/itsapi-processing.test.ts` (nieuw)
- `scripts/itsapi-smoke.mts`
- `scripts/itsapi-processing-smoke.mts` (nieuw)
- `README.md`, `docs/itsapi-receiver.md`

De authenticatiemodus voegt een databasekolom met veilige standaardwaarde `true` toe. Bestaande camera's blijven daardoor Digest vereisen totdat een administrator de optie voor die specifieke camera uitzet. Voor deze aanvulling moeten database-migratie, API en web worden uitgerold. Geen `.env`, `node_modules`, lokale beelden, databases of testlogs naar Git/productie kopiëren.

## Uitgevoerde verificatie

- 195 API-tests geslaagd, waaronder de eerdere receiver-/verwerkingstests; de aanvullende authenticatiesuite bevat nu 40 gerichte tests.
- 42 ANPR-worker- en 46 shared-tests geslaagd.
- Beide ITSAPI-smoketests geslaagd tegen een afzonderlijke PostgreSQL 16-container, inclusief echte transacties, gelijktijdige retries, bestandopslag en push-stub.
- Lint, TypeScript en builds van API/shared/worker geslaagd. Voor deze aanvulling slaagden ook web-lint, web-TypeScript en de webproductiebouw. Workerbuild lokaal met afzonderlijke outputmap wegens bestaande bestandsrechten.
- Docker-productieimages van API en worker gebouwd; bestaande Compose-overlay gevalideerd. Prisma-migratiestatus vanuit de API-productieimage tegen de testdatabase gecontroleerd.
- Tijdelijke databasecontainer en bijbehorend testvolume opgeruimd. Geen productie-uitrol, wijziging van camerainstellingen of echte push uitgevoerd.

## Lokaal testen

Node 22+ met de repositorydependencies. Werk vanuit de projectmap:

```bash
cd /home/edwin/projects/anpr-platform
npm run db:generate
DATABASE_URL=postgresql://validate:validate@127.0.0.1:5432/validate npm run db:validate
npm run build -w @anpr/shared
npm run typecheck -w @anpr/api
npm run typecheck -w @anpr/web
npm run lint -w @anpr/api
npm run lint -w @anpr/web
npm run test -w @anpr/api -- src/itsapi.test.ts src/itsapi-processing.test.ts --configLoader native
npm run build -w @anpr/api
npm run build -w @anpr/web
```

Isolatie voor de echte PostgreSQL-/beeldopslagtest: deze container bevat alleen synthetische testgegevens. Gebruik in deze WSL-installatie `docker.exe` in plaats van `docker` wanneer de Linux-CLI niet beschikbaar is. Dit is geen opdracht om productiecontainers te wijzigen.

```bash
cd /home/edwin/projects/anpr-platform
docker run --rm --detach --name anpr-itsapi-local-test --publish 127.0.0.1:55439:5432 --env POSTGRES_DB=anpr_native_test --env POSTGRES_USER=itsapi_test --env POSTGRES_PASSWORD=synthetic_local_test postgres:16-alpine
until docker exec anpr-itsapi-local-test pg_isready -U itsapi_test -d anpr_native_test; do sleep 1; done
(
  export DATABASE_URL=postgresql://itsapi_test:synthetic_local_test@127.0.0.1:55439/anpr_native_test
  export CAMERA_CREDENTIALS_KEY=0000000000000000000000000000000000000000000000000000000000000000
  export REDIS_URL=redis://127.0.0.1:6379
  export WEB_ORIGIN=http://localhost:3000
  npm run db:migrate && npx tsx scripts/itsapi-processing-smoke.mts && npx tsx scripts/itsapi-smoke.mts
)
docker stop anpr-itsapi-local-test
```

De tests weigeren een andere databasenaam, gebruiken synthetische fixtures, verwijderen hun eigen records/beeldmap en versturen geen echte pushmeldingen. De nieuwe integratietest controleert ook gelijktijdige uploads, drie beeldkoppelingen, later aangeleverde beelden en één push per hit na een retry.

Lokaal aangetroffen root-owned gegenereerde dependencies/buildoutput zijn waar nodig herstelbaar gekopieerd onder `node_modules` om Prisma en API/shared te kunnen bouwen. De workerbuild is daarnaast naar `node_modules/.itsapi-worker-build` uitgevoerd; de bestaande root-owned worker-distmap is niet verwijderd.

## Veilig uitrollen op de bestaande installatie

De huidige installatie gebruikt aantoonbaar `docker-compose.yml` plus `docker-compose.external.yml`; de API start gecompileerde JavaScript. Onderstaande commando's behouden die opstartvorm, bestaande secrets, poorten en volumes. **Niet uitgevoerd tijdens deze implementatie.**

Breng eerst de hierboven genoemde bronbestanden/release naar de productiecheckout. Bewaar een terugkeerpunt van de bronrelease. Maak vóór de migratie een backup volgens het bestaande beheerproces. De migratie voegt alleen `ItsapiRegistration.authenticationEnabled BOOLEAN NOT NULL DEFAULT true` toe; bestaande registraties blijven dus veilig op Digest staan.

```bash
cd /home/edwin/projects/anpr-platform
set -e
docker compose -f docker-compose.yml -f docker-compose.external.yml config --quiet
ITSAPI_OLD_API_CONTAINER=$(docker compose -f docker-compose.yml -f docker-compose.external.yml ps -q api)
ITSAPI_OLD_WEB_CONTAINER=$(docker compose -f docker-compose.yml -f docker-compose.external.yml ps -q web)
ITSAPI_OLD_API_IMAGE=$(docker inspect --format '{{.Image}}' "$ITSAPI_OLD_API_CONTAINER")
ITSAPI_OLD_WEB_IMAGE=$(docker inspect --format '{{.Image}}' "$ITSAPI_OLD_WEB_CONTAINER")
docker image tag "$ITSAPI_OLD_API_IMAGE" anpr-platform-api:before-itsapi
docker image tag "$ITSAPI_OLD_WEB_IMAGE" anpr-platform-web:before-itsapi
docker compose -f docker-compose.yml -f docker-compose.external.yml build api web
docker compose -f docker-compose.yml -f docker-compose.external.yml run --rm --no-deps api node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --no-deps api web
docker compose -f docker-compose.yml -f docker-compose.external.yml ps api web
docker compose -f docker-compose.yml -f docker-compose.external.yml exec -T api node -e 'fetch("http://127.0.0.1:7070/health").then(async r=>{console.log(await r.text());process.exitCode=r.ok?0:1}).catch(()=>{process.exitCode=1})'
docker compose -f docker-compose.yml -f docker-compose.external.yml logs --since 5m api
```

Stop bij een fout; gebruik geen `down -v`, reset of automatische databaseherstelactie. De twee `before-itsapi`-tags bewaren de vorige API- en webimages; voor terugkeer herstel je de vorige bronrelease en gebruik je deze images met dezelfde Compose-configuratie. De extra kolom kan bij een applicatieterugrol blijven bestaan. Geen migraties terugdraaien of historie verwijderen.

Cameratest na de uitrol:

1. Controleer platformcamera: provider DAHUA_ITSAPI, actieve camera voor passages, juiste bestaande Device ID, V1.19 en Camera-IP `192.168.178.248`. Zet **Digest-authenticatie staat in de camera aan** uit en sla de ITSAPI-configuratie op. Verander de video-/camera-admincredentials niet.
2. Gebruik het door de camera bereikbare adres `http://192.168.178.52:7070` als dit nog de bedoelde receiver is. Eerdere documentatie met `192.168.178.18:7071` betrof een oudere AnyDesk/Windows-poortconflictconfiguratie en is geen huidig advies.
3. Observeer voor deze camera direct 200 voor een geldige KeepAlive en een bijgewerkte heartbeatdiagnose. Een 401 betekent dat de per-camera-optie nog aan staat of dat de nieuwe API/migratie niet actief is. Een 403 betekent een onbekend Device ID of dat het socket-bron-IP niet exact `192.168.178.248` is. Bij Docker-NAT moet eerst worden vastgesteld welk bron-IP de receiver werkelijk ziet; vertrouw geen doorgestuurde IP-header. Als de camera bij 200 blijft retryen, onderzoek de firmware-ACK; zet geen generieke nep-success in.
4. Laat één echte passage vastleggen. Controleer passage, opnametijd, richting, beelden en ontbrekende optionele gegevens. Controleer of de retries stoppen of dezelfde passage blijven gebruiken.
5. Test met één expliciete test-watchlistmatch een hit en de push naar het bedoelde toestel. Synthetische tests bewijzen geen fysieke camera- of toestelwerking.
6. Bij 422: gebruik foutcode, `missing` en structuurdiagnose om de werkelijk afwijkende firmwarevelden vast te stellen. Deel geen ongeschoonde payload, kentekenfoto of Authorization-header.

TODO vóór claim “hardwaregeverifieerd”: eigen echte payloads en ACK-acceptatie, confidence-schaal, richtingsbetekenis, tijdzone en daadwerkelijk ontvangen beeldrollen bevestigen. Andere registratie-endpoints en payloadvarianten blijven expliciet niet ondersteund.
