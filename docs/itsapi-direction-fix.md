# ITSAPI-rijrichting: productie versus lokaal

Onderzocht op 20 oktober 2026. Geen productie-push, databasewijzigingen, historische herverwerking of containerrecreatie uitgevoerd. Productiewaarden zijn door de gebruiker met tcpdump vastgesteld; deze opdracht heeft geen toegang tot de productiedatabase of een complete productiecapture.

## 1. Oorzaak en verschil tussen lokaal en productie

Het juiste veld werd al gelezen: `Picture.SnapInfo.Direction`. De gedeelde resolver herkende alleen expliciete travelwoorden, zoals Approach/Leave. Obverse/Reverse werden bewust niet geïnterpreteerd zolang geen firmwarebewijs beschikbaar was. Daardoor gaf juist de werkende ITSAPI-route `UNKNOWN` door. Er was geen verlies in PostgreSQL of een verkeerde frontendvertaling.

De lokale tests gebruikten een synthetisch Picture-profiel met Direction=Approach/Leave/Incoming/Outgoing. De simulator gebruikt rechtstreeks INCOMING/OUTGOING/UNKNOWN en doorloopt geen Dahua-parser. De oude gedeelde tests legden Obverse/Reverse juist als onbekend vast voor generieke/CGI-velden. Er ontbrak een ITSAPI-profieltest met de werkelijk waargenomen productievelden. Dezelfde commit kan daardoor lokaal correct lijken en op productie UNKNOWN opleveren.

De lokale camera gebruikt CGI, geen ITSAPI. Op 20 oktober zijn lokaal acht echte Approach- en vijf Leave-passages gevonden; alle dertien hebben een bekende richting. Een concreet opgeslagen spoor:

| Stap | Lokale echte passage |
| --- | --- |
| Passage-ID en UTC-tijd | `62a46d8f-b14c-46e0-8901-07460570c32e`, `2026-10-20T05:10:44.489Z` |
| Bewaarde bron | DAHUA_CGI, `Events[0].TrafficCar.DrivingDirection[0] = "Approach"` |
| Parser → intern event | `sourceDirection=TOWARD_CAMERA`, `direction=INCOMING` |
| Database | `Passage.direction=INCOMING`, directionSource=CAMERA_EVENT_MAPPED, status=MAPPED |
| API → frontend | Enum INCOMING blijft behouden → Inkomend |

De volledige raw-payload van dit event is niet bewaard. De bronstap komt uit de echte opgeslagen richtingmetadata; de parser- en presentatiestappen volgen uit de code en zijn afzonderlijk getest.

Het productiespoor vóór deze correctie:

`Picture.SnapInfo.Direction="Obverse"/"Reverse" → resolveDahuaDirection: UNMAPPED_VALUE, sourceDirection=undefined → event.direction=UNKNOWN → Passage.direction=UNKNOWN → API UNKNOWN → Onbekend`.

De eerste stap is de gebruikerswaarneming op productie. De rest is met dezelfde payloadstructuur door de receiver en opslagservice gereproduceerd in tests met gemockte PostgreSQL-opslag; er wordt geen specifieke productiepassage gereconstrueerd of hardwaretest geclaimd.

## 2–5. Veld, waarden, mapping en camera-instelling

De ITSAPI Picture-adapter gebruikt uitsluitend `Picture.SnapInfo.Direction`. De gemelde echte waarden zijn de strings `Obverse` en `Reverse`. Cijfers hebben geen bevestigde betekenis en blijven UNKNOWN.

| Invoer, ongeacht hoofdletters/omringende whitespace | Omkeren Uit | Omkeren Aan |
| --- | --- | --- |
| Obverse | INCOMING / Inkomend | OUTGOING / Uitgaand |
| Reverse | OUTGOING / Uitgaand | INCOMING / Inkomend |
| Unknown, ontbrekend, onbekende firmwarewaarde, numerieke waarde | UNKNOWN | UNKNOWN |

Dit is een instelbare platformconventie voor de rijstrookrichting, geen bewijs dat Obverse bij iedere montage fysiek naar de lens toe is. De adapter gebruikt daarvoor de bestaande tweestaten-bronrichting en vervolgens precies eenmaal `mapCameraDirection`. De CGI-resolver blijft ongewijzigd omgaan met Obverse/Reverse in andere velden. Bestaande Approach/Leave-ondersteuning blijft behouden.

**Camera's → camera bewerken → Richting omkeren**, eveneens beschikbaar bij normaal en geavanceerd toevoegen. Het vinkje hergebruikt Camera.directionMapping:

- Uit: TOWARD_CAMERA_IS_INCOMING, bestaande database- en API-default;
- Aan: AWAY_FROM_CAMERA_IS_INCOMING.

Bestaande camera's behouden hun configuratie; een eerder bewust omgekeerde mapping wordt niet uitgezet. Alle vijf lokale camera's stonden op Uit. De bestaande beheerdersrechten, PATCH-validatie, configVersion en auditlog blijven gelden. Nieuwe ITSAPI-passages bewaren ook de gebruikte directionMapping in metadata.

Alleen nieuwe events worden gemapt. Bestaande passages en retries krijgen geen nieuwe richting. Hit heeft in dit schema **geen eigen direction-kolom**: hit-API, hitweergave en push gebruiken de opgeslagen Passage.direction. Daardoor kan een latere camerawijziging een oude hit niet omkeren. Zoeken heeft nu ook een zichtbare richtingkolom met dezelfde centrale formatter als de andere passageweergaven.

## 6. Gewijzigde bestanden

Productiecode:

- `packages/shared/src/dahua-direction.ts`: expliciet ITSAPI_SNAP-profiel naast de bestaande generieke resolver.
- `apps/api/src/lib/itsapi-parser.ts`: profiel toepassen en gebruikte mapping als metadata bewaren.
- `apps/web/app/cameras/[id]/page.tsx`, `apps/web/app/cameras/new/page.tsx`, `apps/web/app/cameras/advanced/new/page.tsx`: bestaande configuratie als Richting omkeren presenteren.
- `apps/web/app/search/page.tsx`: richtingkolom.

Tests:

- `packages/shared/src/dahua-direction.test.ts`.
- `apps/api/src/itsapi-processing.test.ts`, `apps/api/src/lib/itsapi-direction.test.ts`, `apps/api/src/cameras.test.ts`.
- `apps/web/app/direction-consistency.test.tsx`, `apps/web/app/cameras/direction-setting.test.tsx`.

Documentatie: `README.md`, `docs/camera-direction.md`, `docs/itsapi-receiver.md`, `docs/dahua-direction-investigation.md` en dit rapport.

## 7. Migration

Geen nieuwe Prisma-migration nodig. De reeds bestaande directionMapping-kolom, enum, veilige default en geaudite PATCH worden hergebruikt. Geen bestaande migration herschreven.

## 8. Tests en controles

Regressies gebruiken de gemelde echte richtingvelden/waarden in een expliciet synthetische TollgateInfo-envelope. Geen echte kentekens, identiteit, beelden of complete captures opgenomen. Tests dekken beide waarden, case/whitespace, Unknown, ontbrekend, toekomstig en numeriek, beide camera-instellingen, meerdere camera's, opslag via de echte receiver/PassageService met DB-mocks, hit-presentatie en push, geaudite camera-PATCH en bestaande default. Frontendtests renderen dashboard, live, passage-detail, hitdetail en de zoekresultaten voor alle drie richtingen. Bestaande groeps-, hit-, opslag-, authenticatie-, beeld- en tijdtests blijven meedraaien.

Geslaagd: **454 relevante tests** (shared 75, ANPR-worker 53, volledige API 255, frontend 71), workspace-typecheck en lint. Daaronder de bestaande parser-, passage-service-, API-, hit-, groeps- en push-tests. De retrytest controleert ook dat een gewijzigde camera-instelling een bestaande passage niet omkeert.

Shared-, API- en Next.js-productiebuild slagen; ook de ongetagde API-Dockerbuild met target build slaagt. De standaard `npm run build` stopt bij reeds bestaande EACCES op niet-beschrijfbare bestanden in `apps/video-worker/dist`. Beide workers compileren wel met hun normale build-tsconfig naar aparte uitvoermappen in `data/itsapi-direction-build`. Er zijn geen rechten of bestaande buildbestanden destructief aangepast. De standaard totaalbuild blijft daarom een omgevingsbeperking. Geen draaiende container vervangen.

## 9. Historisch herstel

Alleen-lezen lokale PostgreSQL-meting:

| Echte passages | Aantal | Eerste opslag UTC | Laatste opslag UTC |
| --- | ---: | --- | --- |
| UNKNOWN | 304 | 2026-09-15 06:04:58.424 | 2026-10-19 18:27:59.763 |
| INCOMING | 8 | 2026-10-20 04:59:25.532 | 2026-10-20 05:10:45.537 |
| OUTGOING | 82 | 2026-09-12 06:48:47.800 | 2026-10-20 05:10:41.726 |

Geen null-richtingen. Daarnaast blijven zestien bestaande demo-records behouden. Vijftig echte hits: 33 bij UNKNOWN, 17 bij OUTGOING. Lokaal: nul ITSAPI-passages, nul registraties, nul inboxregels, nul opgeslagen rawDirection Obverse/Reverse. De dertien nieuwe bekende CGI-richtingen zijn Approach/Leave; 372 CGI-records bewaren nog string "0". Eerdere bekende richtingen kwamen deels uit de oude camerafallback; die bewijzen geen werkelijke beweging. Zie het eerdere [CGI-historieonderzoek](dahua-direction-investigation.md), inclusief onderzochte snapshots/dumps.

De 304 lokale UNKNOWN-passages zijn met het aanwezige materiaal niet betrouwbaar herstelbaar. Op productie **kunnen** passages met bewaarde rawDirection Obverse/Reverse herstelbaar zijn: de parser bewaarde dit veld al vóór de fix. Eerst apart alleen-lezen vaststellen welke records dat betreft en welke mapping op hun opstelling van toepassing was. ItsapiInbox bewaart doorgaans alleen structuur/typen, geen herstelbare volledige eventinhoud. Er is geen productietelling of backfill uitgevoerd.

## 10. Lokale echte praktijktest

Bouw uitsluitend de lokale omgeving wanneer je de wijziging wilt beoordelen:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build api anpr-worker web
```

1. Gebruik een **echte ITSAPI-camera** die TollgateInfo naar deze lokale receiver stuurt. De huidige lokale CGI-camera levert Approach/Leave en bewijst de ITSAPI-variant dus niet. Laat diens werkende transport intact.
2. Camera's → camera bewerken → Richting omkeren uitvinken → Opslaan.
3. Laat één voertuig passeren. Met bestaande tijdelijke ITSAPI-debugdiagnose kun je uitsluitend het ontvangen Direction-token controleren; zoek in de UI dezelfde nieuwe passage. Bij Obverse verwacht je Inkomend, bij Reverse Uitgaand. Controleer dashboard, live, detail en zoeken. Voor een hit moet het kenteken vooraf in een actieve hitgroep staan; controleer dan ook hitdetail en push.
4. Noteer het passage-ID. Zet bij dezelfde camera Richting omkeren aan en sla op. Laat een **nieuwe** passage in dezelfde fysieke richting plaatsvinden. Controleer dat hetzelfde ontvangen token nu de tegenovergestelde richting oplevert. De vorige passage en hit moeten gelijk blijven. Een retry van hetzelfde event is geen nieuwe passage.
5. Een andere camera met Uit moet zijn normale mapping behouden. Onbekende waarden blijven Onbekend; daarvoor is ook met omkering geen fysieke richting bekend.

Optionele richting-only logging binnen de bestaande admin-debugperiode van vijftien minuten:

```bash
docker compose logs --since=2m --no-log-prefix api | rg 'itsapi_direction_diagnostic'
```

Schakel daarvoor via de bestaande cameradiagnose de tijdelijke ITSAPI-debugactie in. Geen complete tcpdump, kentekens, beelden of credentials delen. Er is tijdens deze opdracht geen nieuwe fysieke ITSAPI-passage waargenomen.

## 11. Productie-uitrol na lokale acceptatie

Nog niets gepusht of uitgerold. Na lokale controle: review/commit deze wijziging, haal die commit op de server op en gebruik de bestaande productie-Composeconfiguratie. Bouw API, web en ANPR-worker samen zodat de gedeelde code overeenkomt. Behoud volumes, secrets en cameraconfiguratie; geen reset, seed of nieuwe migration.

Voor de bestaande externe HTTPS-overlay zijn de commando's **pas op de juiste doelomgeving na acceptatie**:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml build api anpr-worker web
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --no-deps api anpr-worker web
```

Gebruik voor een anders ingerichte productiehost diens bestaande deploymentprocedure. Herhaal daarna de echte passageproef met Uit/Aan, controleer beelden/tijden/groepen/hit/push en laat debuglogging verlopen. Eventueel historisch herstel blijft een aparte opdracht.
