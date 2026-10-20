# Onderzoek Dahua-rijrichting — 19 oktober 2026

## Conclusie en afbakening

De lokale overgang naar **Onbekend** ontstaat vóór opslag, bij de richtinginterpretatie. De ontvangen waarde die daadwerkelijk bewaard is, is string `"0"`. Die wordt niet als fysieke rijrichting herkend. Oudere OUTGOING-waarden waren een fallback op de vaste camerainstelling, geen bewezen eventrichting. Commit `9bfc6f3` verwijderde die fallback op 15 september; daarna verschijnen UNKNOWN-records. De frontend geeft de opgeslagen richting correct weer. De richtingkolom is NOT NULL en de relevante migraties zijn toegepast.

De lokale actieve camera blijkt `DAHUA_CGI` te gebruiken. Model via een alleen-lezen camera-GET bevestigd: **DHI-ITC413-PW4D-IZ3**. Een bruikbare geïnstalleerde firmwareversie is niet vastgesteld. In de huidige lokale database staan geen ITSAPI-registraties, geen ITSAPI-inboxrijen, geen ITSAPI-providerpassages en geen `itsapi:`-eventkeys. Dit bewijst niets over het transport van een afzonderlijke productieomgeving. Er is geen echte lokale TollgateInfo-payload waarmee een ITSAPI-firmwareveld kan worden bewezen.

Een tweede softwaretekort is aantoonbaar: de opgeslagen CGI-structuurlijst noemt `TrafficCar.DrivingDirection[0]`, maar de parser las uitsluitend een veld met suffix `.Direction`. De waarden van DrivingDirection zijn destijds niet bewaard. De wijziging ondersteunt nu expliciete Approach/Leave-teksten in dat extra veld, zonder de betekenis van numeric 0 te verzinnen. **Of deze camera daadwerkelijk zulke bruikbare teksten levert en de gekozen fysieke mapping klopt, moet nog met een nieuwe passage worden vastgesteld.**

## Werkelijk onderzochte bronnen

Alle databasequeries waren alleen-lezen. Er zijn geen bestaande passages/hits/camera-instellingen gewijzigd en geen gegevens hersteld of verwijderd.

- Huidige PostgreSQL-tabellen Passage, Hit, Camera, ItsapiRegistration, ItsapiInbox, DeviceConnection en migratie-/schemametadata.
- `data/current-camera-structure.log`: eerdere echte CGI-veldstructuur, inclusief geselecteerde waarden; de veldnamenlijst was begrensd tot 100 namen.
- `data/current-camera-final.log`: eerdere opgeslagen metadata met rawDirection 0 en CAMERA_CONFIGURATION als richtingbron.
- Backups `before-itsapi-20260912.dump` en `before-mobile-time-live-20260914.dump`, uitsluitend via pg_restore naar een intern gefilterde tekststroom; **geen restore** uitgevoerd. Eerste backup: 17 passages, 0 inboxrijen, 0 registraties. Tweede: 51 passages, 0 inboxrijen, 1 registratie; 26 passagerijen bevatten rawDirection. Beide bevatten geen DrivingDirection-waarden of TollgateInfo-rijen in de onderzochte tabellen.
- Code, Git-wijziging van 15 september, bestaande regressies en alle richtingweergaven.
- Een aanvullende CGI-streamprobe met bestaande credentials in geheugen: verbonden, maximaal 45 seconden, geen nieuw TrafficJunction-event waargenomen. Geen beelden/payloads bewaard, geen camera-instellingen aangepast.

De oude snapshots, dumpbestanden en de huidige JSON-metadata bevatten geen volledige ruwe payload voor de hieronder gevolgde passage. Dat ontbrekende bewijs wordt niet als een complete capture gepresenteerd.

## Historische aantallen

Momentopname uit de bestaande lokale database; tijden hieronder zijn UTC, niet opnieuw geïnterpreteerd als lokale kloktijd.

| Echte camerapassages | Aantal | Eerste createdAt | Laatste createdAt |
| --- | ---: | --- | --- |
| OUTGOING | 77 | 2026-09-12 06:48:47.800Z | 2026-09-15 05:00:01.075Z |
| UNKNOWN | 304 | 2026-09-15 06:04:58.424Z | 2026-10-19 18:27:59.763Z |
| INCOMING / BOTH / null | 0 | — | — |

Totaal **381 echte camerapassages**. Van OUTGOING hebben 68 provider DAHUA_CGI, rawDirection `"0"` en directionSource CAMERA_CONFIGURATION; 9 oudere records missen die metadata. Alle 304 UNKNOWN-records hebben provider DAHUA_CGI, rawDirection `"0"` en directionSource UNKNOWN. De 9 legacy-records kunnen zonder aanvullend bewijs niet als ITSAPI worden ingedeeld.

De 16 bestaande DEMO-passages zijn apart gehouden: 12 INCOMING, 2 OUTGOING, 2 BOTH. Ze zijn niet verwijderd. Er zijn 50 hits op echte camerapassages: 33 gekoppeld aan UNKNOWN en 17 aan OUTGOING. Hit heeft geen eigen direction-kolom; de API leest de gekoppelde Passage.direction.

Migraties `20260914000100_location_timezone_direction` en `20260915000100_camera_direction_mapping` zijn voltooid, niet teruggedraaid. CameraDirection bevat UNKNOWN/INCOMING/OUTGOING/BOTH. Passage.direction is niet nullable; nullaantal over alle passages is 0. De tweede migratie voegt alleen de mappingconfiguratie toe, geen historische herschrijving. De codewijziging verwijderde daarnaast expliciet `event.direction ?? camera.direction` als fallback.

## Echte velden en hun bewijs

| Veld | Lokaal bewijs | Betekenis/mapping |
| --- | --- | --- |
| `Events[0].TrafficCar.Direction` | Naam en waarde `"0"` vastgelegd; CGI-parser bewaart tekst | Numeric enumsemantiek niet bevestigd; blijft UNKNOWN |
| `Events[0].TrafficCar.DrivingDirection[0]` | Naam aanwezig in echte capture; waarde niet bewaard | Nu ondersteund indien expliciete traveltekst; lokale waarde nog meten |
| `Events[0].TrafficCar.DrivingDirection[1]` en `[2]` | Namen aanwezig, waarden niet bewaard | Geen travel-enums; worden nooit als richting gemapt of als vrije tekst gelogd |
| `Events[0].JunctionDirection` | Naam aanwezig; waarde niet bewaard | Rijstrookrelatief; geen automatische naar/van-camera-mapping |
| `Events[0].TrafficCar.CustomRoadwayDirection` | Naam aanwezig; waarde niet bewaard | Geen onbewezen mapping |
| CaptureDirection, SnapDirection, VehicleDirection, Approaching, Leaving, In, Out, 1, 2 | Geen concrete lokale waarden aangetoond | Niet als werkelijk ontvangen waarden gerapporteerd; ontbrekend bewijs is geen bewijs van afwezigheid |
| `Picture.SnapInfo.Direction` | Ondersteund ITSAPI-contract, geen lokale echte ITSAPI-payload | String of klein integer; ondersteunde tekst via fysieke camerarichtingmapping, cijfers blijven UNKNOWN |

De nummerwaarde uit CGI is tekst omdat het transport key/value is. Er is dus geen bewijs dat deze camera in ITSAPI een JSON-number of hetzelfde veld zou sturen. De begrensde historische veldnamenlijst bewijst ook niet dat andere velden buiten de eerste 100 namen ontbraken.

Als externe kruiscontrole publiceerde de [auteur van een echte TrafficJunction-capture](https://community.home-assistant.io/t/dahua-vto-custom-integration/293693/467) een event met zowel Direction 0 als DrivingDirection[0] Approach. Dit ondersteunt de veldkeuze maar is **geen capture van onze camera**. De [OEM-documentatie voor snapshot-events](https://suporte.intelbras.com.br/images/a/ab/Relatorio_7208_LPR_G2.pdf) maakt onderscheid tussen JunctionDirection ten opzichte van de rijstrook en head-orientatie. Daarom worden Obverse/Reverse/Head niet rechtstreeks naar INCOMING/OUTGOING vertaald. Dit document bewijst geen numerieke enum voor deze Dahua-firmware.

## Eén concreet spoor

Echte passage **0146699f-4ce1-4a35-adea-1d4cd021d9be**, bijbehorende hit **aff819a6-aa77-44c9-bf12-fce3bb8eb374**. Ontvangst/passagetijd `2026-10-19T17:09:38.836Z`, opslag `17:09:39.761Z` (19:09 lokale Nederlandse tijd).

| Stap | Exact vastgestelde richtingwaarde |
| --- | --- |
| Ruwe Dahua-eventinhoud van precies dit event | Volledige payload niet bewaard; geen reconstructie als echt voorgesteld |
| Bewaarde bronwaarde op deze passage | `rawEventMetadata.provider = DAHUA_CGI`, `rawDirection = "0"` (string), `directionSource = UNKNOWN` |
| Parserveld | De oude parser las suffix `.Direction`; de echte structuursnapshot van dezelfde camera noemt `Events[0].TrafficCar.Direction` |
| Bronrichting intern event volgens die parser | `sourceDirection = undefined`; string `"0"` is niet ondersteund |
| Mapping | `TOWARD_CAMERA_IS_INCOMING` met undefined bron → `UNKNOWN` |
| Databaseveld | `Passage.direction = UNKNOWN` |
| API-presentatie op dit echte record | `historicalCamera(record).direction = UNKNOWN`; `publicHit(...).passage.direction = UNKNOWN` |
| Frontend | Centrale formatter → `Onbekend`; hitdetail gebruikt dezelfde enumlabels |

Voor de API-stap zijn de echte presentatiefuncties op het geselecteerde echte DB-record uitgevoerd. Er is geen nieuwe gebruikerssessie aangemaakt om een HTTP-call naar privédata te doen. Route-responses en daadwerkelijke frontendcomponenten zijn daarnaast afzonderlijk getest. De ontbrekende raw-eventstap blijft expliciet een bewijsgrens.

## Gerichte wijzigingen

- Gedeelde `dahuaTravelDirection` en `resolveDahuaDirection` gebruiken de bestaande expliciete tekstbetekenissen en bestaande `mapCameraDirection`. Ze ondersteunen geen onbevestigde numerieke enum. Approaching/Leaving blijven UNKNOWN zolang die firmwarealiases niet bevestigd zijn.
- CGI leest nu ook TrafficCar.DrivingDirection[0]. Herkende fysieke richting krijgt de camera-configuratiemapping; twee botsende bekende richtingen geven UNKNOWN. Geen fallback op de vaste Camera.direction.
- Nieuwe metadata: `rawDirectionField`, `directionStatus` (MAPPED/UNMAPPED_VALUE/NOT_RECEIVED/CONFLICTING_VALUES) en bij CGI `directionEvidenceJson`, een begrensde richting-only JSON-string. Het bestaande scalar-metadata-contract blijft intact. Geen timestamp-, eventkey-, beeld-, groeps- of pushbeleid gewijzigd.
- ITSAPI blijft bij het bestaande Picture-profiel SnapInfo.Direction. Numerieke 0/1/2 worden nu wel met hun datatype in metadata behouden, maar niet gemapt. Andere firmwarevelden worden niet op basis van hun naam gegokt.
- Binnen de bestaande admin-debugperiode (15 minuten) logt de receiver alleen veilige richtingvelden, typen en toegestane tokens. Arbitrary strings en wegnamen worden weggelaten; gevoelige takken worden overgeslagen. Begrenzing: 20 velden, 6 niveaus, 512 bezoekstappen, maximaal 256 properties per object. De toestemmingstekst van de debugactie is hiervoor bijgewerkt. Standaard blijft dit log uit.
- `capture-dahua-direction.mts` is een los, begrensd alleen-lezen CGI-hulpmiddel. Het schrijft geen passages of cameraconfiguratie en selecteert geen kentekens voor zijn output. Het kan de normale workerpassage daarna aan de hand van eventidentiteit terugvinden en alleen ID/richting tonen.

## Bestanden en tests

- `packages/shared/src/dahua-direction.ts`, `dahua-direction.test.ts`, `index.ts`.
- `apps/anpr-worker/src/providers/dahua-parser.ts`, `dahua-parser.test.ts`, `fixtures/dahua-direction-observed.json` en `apps/anpr-worker/src/passage-service.test.ts`.
- `apps/api/src/lib/itsapi-parser.ts`, `itsapi-protocol.ts`, `itsapi-receiver.ts`, `routes/camera-onboarding.ts`.
- `apps/api/src/itsapi-processing.test.ts`, `passages.test.ts`.
- `apps/web/app/direction-consistency.test.tsx`.
- `scripts/capture-dahua-direction.mts`.
- `README.md`, `docs/camera-direction.md`, `docs/itsapi-receiver.md`, dit rapport.

De fixture bevat uitsluitend de werkelijk bewaarde richting `"0"` en de waargenomen aanvullende veldnamen. Hij bevat geen kenteken, camera-identiteit, beeld of complete payload. Tests voor Approach/Leave zijn expliciete parsercontracten, geen verzonnen lokale cameracaptures.

Tests dekken in-/uitgaand, omgekeerde camerarichtingmapping, numeric en tekst 0/1/2 zonder gokmapping, Approaching/Leaving als onbevestigde aliases, ontbrekende/nieuwe waarden, tegenstrijdige velden, late CGI-propertyposities, veilige logging/afgeschermde wegnamen, debugtimeout, passageopslag en hit/analysetaak. API-lijst en detail geven alle drie richtingen gelijk terug. De echte dashboard-/live-/passage-/hitcomponenten tonen dezelfde betekenis. Zoeken heeft een richtingfilter en de API levert direction, maar de huidige resultaattabel heeft **geen richtingkolom**; dit is niet als foutieve richtingweergave behandeld.

Uitgevoerd en geslaagd: **426 relevante tests**: shared 67, ANPR-worker 53 (inclusief 14 passage-service-tests), volledige API-suite 237, volledige frontendsuite 69. Workspace-typecheck en lint zijn geslaagd; het capturescript is ook afzonderlijk getypecheckt.

Shared-, API- en webproductiebuild slagen. De standaard root-build raakt de reeds bestaande EACCES op niet-beschrijfbare worker-distbestanden; beide workers compileren met hun normale build-tsconfig naar `data/direction-build`. Daarnaast zijn de echte API- en ANPR-worker-Dockerbuilds met target `build` geslaagd. De testimages zijn niet als lopende dienst uitgerold of getagd als release; bestaande containers zijn niet herstart of vervangen. De gewijzigde metadata gebruikt bestaande JSON-opslag: geen schemawijziging.

Een nieuwe fysieke passage met DrivingDirection[0] is nog niet vastgelegd; de 45-secondenprobe was stil. Er is daarom geen nieuwe hardwarebevestiging of databaseketentest met werkelijk nieuw ingestuurde richting. Het rapport en de veilige capture maken die resterende controle concreet.

## Historisch herstel

Met de beschikbare data is geen betrouwbare fysieke richting terug te halen voor de 304 UNKNOWN-events. RawDirection `"0"` plus een camerainstelling is daarvoor onvoldoende. Ook de oude 68 OUTGOING-events met CAMERA_CONFIGURATION bewijzen geen beweging. De dumps en inbox bevatten geen verloren DrivingDirection-waarden. Eventueel aanvullend bewaard camera-/SD-/extern eventsysteemmateriaal kan later apart worden onderzocht; er wordt nu geen backfill uitgevoerd.

## Lokale praktijktest

Pas de lokale containers pas aan wanneer je deze wijziging zelf wilt beoordelen. Bouw lokaal vanuit de projectmap:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build api anpr-worker web
```

Voor de momenteel aanwezige CGI-camera, start vóór één echte passage de alleen-lezen capture (maximaal 120 seconden). Het script wordt via stdin aangeboden; er hoeft niets in de container gekopieerd te worden:

```bash
docker compose exec -T -e DIRECTION_CAMERA_ID=d5f16975-1aba-4ce9-bc9e-3874d3c63cbf -e DIRECTION_CAPTURE_SECONDS=120 anpr-worker node --import tsx --input-type=module < scripts/capture-dahua-direction.mts
```

Laat één voertuig duidelijk naar de camera toe rijden. Noteer uitsluitend de direction-only uitvoer en het geretourneerde passage-ID. Controleer DrivingDirection[0], selectedField, status, mappedDirection en de door de normale worker opgeslagen direction. Bij Approach en de huidige mapping verwacht je INCOMING; bij Leave OUTGOING. Ontbrekende of onbekende waarden moeten UNKNOWN blijven. Herhaal met de tegenovergestelde rijbeweging en vergelijk dashboard, live passages, passage-detail en zo nodig hitdetail. De rijrichting moet overal dezelfde betekenis hebben. Een hit ontstaat alleen als de bestaande actieve groepsregels matchen; het script maakt geen testhit.

Controleer de camera-instelling alleen-lezen via ANPR/AI Setting/Snapshot → Capture Direction. De [Dahua-instructie voor ITC413-PW4D](https://dahuawiki.com/Traffic/ITC413-PW4D-Z_Initial_Setup) noemt Approaching, Departing en beide richtingen. Dit is een capturefilter, **geen bewijs welke ITSAPI-/CGI-velden de firmware daadwerkelijk uitstuurt**. De [Dahua-handleiding](https://material.dahuasecurity.com/uploads/cpq/DOR/PUM0007242/Smart-ANPR-Camera_Web-Operation-Manual_V1.0.0.pdf) beschrijft hetzelfde onderscheid. Er zijn geen camera-instellingen of firmware aangepast. Als het event geen bruikbare traveltekst bevat, bespreek model-/firmwareondersteuning met de leverancier in plaats van de richting te raden.

Voor een afzonderlijke echte ITSAPI-camera: schakel als admin via de bestaande cameradiagnose de tijdelijke debugperiode in (`POST /api/cameras/<camera-id>/itsapi/debug` via een geauthenticeerde same-origin sessie). De UI gebruikt dezelfde bestaande actie. Laat een TollgateInfo binnenkomen en filter de lokale API-log op het nieuwe richting-only event:

```bash
docker compose logs --since=2m --no-log-prefix api | rg 'itsapi_direction_diagnostic'
```

Daarna stopt de richtinglogging automatisch na het debugvenster. De huidige lokale CGI-camera heeft geen ITSAPI-registratie: schakel haar transport niet voor deze test om en voeg geen fictieve registratie toe. Een echte ITSAPI-fieldmapping kan pas op zo'n geverifieerde capture worden uitgebreid.

## Migratie en latere productie-uitrol

Geen database-migration nodig. Nog geen productie-push, containerrecreatie of historische reparatie uitgevoerd.

Na lokale acceptatie: bouw de shared-code plus API en ANPR-worker samen; deploy via de bestaande productieconfiguratie, behoud alle secrets, storage en cameramapping en voer dezelfde gecontroleerde passage in beide richtingen uit. Het web hoeft voor deze fix alleen mee wanneer de normale releaseprocedure dat vereist: frontendproductiecode is niet gewijzigd. Voor de bestaande externe HTTPS-testoverlay zijn de exacte releasecommando's, **uitsluitend op de juiste doelomgeving na akkoord**:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml build api anpr-worker
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --no-deps api anpr-worker
```

Deze commando's zijn in deze opdracht niet uitgevoerd. De overlay is de bestaande externe testomgeving, geen aangenomen universele productieconfiguratie. Verifieer bij een andere productiehost eerst diens bestaande releaseprocedure. Laat debugdiagnose verlopen en controleer behoud van beelden, hits en push. Zonder geslaagde fysieke test wordt geen opgelost hardwareprobleem geclaimd.
