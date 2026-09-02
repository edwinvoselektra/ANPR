# Resultaat Fase 2.2 — Dahua ANPR-eventinname

Datum controle: 2 september 2026

## Wat daadwerkelijk werkt

- Een afzonderlijke `anpr-worker` start en publiceert een Redis-heartbeat.
- Camera's worden dynamisch uit PostgreSQL gelezen; alleen actieve camera's met
  `anprProvider=DAHUA_CGI` worden beheerd.
- De provider gebruikt de bestaande AES-256-GCM-versleutelde camera-inloggegevens.
- HTTP Digest ondersteunt MD5/MD5-sess en SHA-256/SHA-256-sess met `qop=auth`.
- De Dahua multipart-stream wordt incrementeel en met harde onderdeellimieten gelezen.
- `TrafficJunction` key/value-events worden naar `NormalizedAnprEvent` vertaald.
- Geldige events maken automatisch een `DAHUA_CAMERA`-passage, een plate detection en
  optioneel voertuigmetadata aan.
- Kentekens worden centraal genormaliseerd zonder O/0- of I/1-gokcorrecties.
- Deduplicatie gebruikt eerst camera + bron + `sourceEventId`, met een kort
  configureerbaar camera/kenteken/tijdvenster als fallback.
- Overzichts- en kenteken-JPEG worden waar geleverd begrensd en via de lokale
  storageprovider opgeslagen. PostgreSQL bevat alleen object-ID's.
- De beveiligde passage-API levert nieuwste passages, details en geauthenticeerde foto's.
- **Live passages** ververst iedere drie seconden en markeert `DEMO` en echte
  camera-ANPR duidelijk verschillend.
- De systeemstatus toont RTSP en ANPR-eventstatus afzonderlijk, inclusief laatste event.
- Iedere camera heeft een geïsoleerde loop met begrensde exponential backoff en jitter.
- De bestaande RTSP/video-worker en simulator blijven actief en getest.

## Architectuur

```text
Dahua CGI multipart stream (TrafficJunction + JPEG)
  -> DahuaAnprProvider
  -> Dahua key/value parser
  -> NormalizedAnprEvent
  -> PassageService
       -> deduplicatie
       -> StorageProvider
       -> Prisma/PostgreSQL
  -> beveiligde passage-API
  -> Live passages (polling)
```

`AnprEventProvider` is de leveranciersgrens. Een toekomstige `ServerOcrProvider` of
provider voor een ander cameramerk hoeft de PassageService, API en webinterface niet te
wijzigen.

## Gekozen Dahua-interface

De officiële [ITC413-PW4D-productpagina](https://www.dahuasecurity.com/products/Traffic/Smart-Parking-Products/Access-ANPR-Cameras/ITC413-PW4D-Series)
en [Dahua-datasheet](https://materialfile.dahuasecurity.com/uploads/soft/20241018/DHI-ITC413-PW4D-IZ1-1-2.pdf)
bevestigen CGI, ITSAPI, HTTP/HTTPS, JPEG en camera-ANPR met voertuigmetadata. De publiek
toegankelijke productdocumentatie bevat niet de volledige event-wire-specificatie.

Een beschikbare kopie van Dahua's HTTP API-specificatie beschrijft `TrafficJunction`
als ANPR-event en `snapManager.cgi?action=attachFileProc` als multipart-abonnement op
events met snapshots. Daarom bouwt de provider uitsluitend deze vaste read-only query:

```text
/cgi-bin/snapManager.cgi?action=attachFileProc&channel=<kanaal>&heartbeat=5&Flags[0]=Event&Events=[TrafficJunction]
```

Er kan geen willekeurig endpoint vanuit de browser worden ingevuld. Dahua biedt API-
documentatie via zijn [officiële API-portal](https://www.dahuasecurity.com/api/), maar de
volledige actuele handleiding is daar niet publiek zonder leverancierstoegang. Daarom
blijft compatibiliteit van de exacte query, Digest-variant, eventveldnamen en
afbeeldingsvolgorde een expliciete echte-firmwarecontrole; dit wordt niet als reeds
bewezen gepresenteerd.

## Databasewijzigingen

Normale migratie:

```text
20260902000100_phase_2_2_dahua_anpr_ingest
```

Toegevoegd aan `Camera`:

- provider, HTTP(S)-protocol/poort en Dahua-kanaal;
- onafhankelijke ANPR-connectiestatus, laatste verbinding/event en veilige foutvelden;
- gestructureerde capabilities-JSON.

Toegevoegd aan `Passage`:

- `vehicleBrand`, `plateCountry`, `lane`, `sourceEventId` en beperkte raw metadata;
- bronnen `DAHUA_CAMERA` en `SERVER_OCR`;
- unieke index op camera + bron + source event-ID.

De migratie voegt alleen typen, kolommen en een index toe. Na toepassing waren alle
4 bestaande camera's en alle 8 bestaande DEMO-passages nog aanwezig. Beide migraties
staan als succesvol toegepast; er is geen reset, db push of volumeverwijdering gebruikt.

## Environmentvariabelen

```dotenv
ANPR_WORKER_PORT=4200
ANPR_CAMERA_REFRESH_SECONDS=10
ANPR_RECONNECT_MIN_SECONDS=2
ANPR_RECONNECT_MAX_SECONDS=60
ANPR_CONNECT_TIMEOUT_SECONDS=10
ANPR_DEDUPE_WINDOW_SECONDS=3
ANPR_MAX_IMAGE_BYTES=8000000
```

Compose heeft begrensde developmentdefaults. Zet geen cameragegevens of secrets in deze
variabelen.

## Beveiligingsmaatregelen

- camera-aanvragen gebeuren alleen server-side;
- host komt uit het bestaande camera-object; de eventpath is vast in de provider;
- credentials worden alleen vlak vóór verbinden in workergeheugen ontsleuteld;
- authorization, cookies, wachtwoorden en credential-URL's worden niet gelogd;
- normale passage-logregels redigeren het kenteken;
- alleen verwachte Dahua key/value-velden worden geparseerd; raw metadata is allowlisted;
- multipartmetadata en JPEG-grootte zijn begrensd;
- JPEG-signature en contenttype worden gecontroleerd;
- objectnamen zijn UUID's zonder kenteken of camera-secret;
- storagepaden en afbeeldingsroutes blokkeren path traversal;
- passage-, detail- en afbeeldingsroutes vereisen `passages.view`;
- frontend communiceert nooit rechtstreeks met de camera.

## Uitgevoerde controles

- ANPR-worker: 19 tests geslaagd (parser, ontbrekende metadata, ongeldige events,
  camera mapping, Digest/redactie, multipartlimieten, afbeeldingen, deduplicatie,
  passage-aanmaak, reconnect en multi-camera-isolatie).
- API: 48 tests geslaagd, inclusief passage-API en routebeveiliging.
- Web: 18 tests geslaagd, inclusief echte/DEMO-weergave en polling.
- Database: 21 tests geslaagd.
- Shared: 7 normalisatie-/retentietests geslaagd.
- Bestaande video-worker: 9 tests geslaagd.
- TypeScript: API, web, database, shared, video-worker en ANPR-worker geslaagd.
- ESLint: API, web, shared, video-worker en ANPR-worker geslaagd.
- Prisma-schema geldig; twee migraties toegepast en geen bekende dataverliesactie.
- Docker Compose-configuratie geldig.
- Productiebuilds geslaagd voor API, Next.js-web, video-worker en ANPR-worker.
- Runtime-smoketest geslaagd voor login, sessies, dashboard, camera CRUD,
  RTSP-foutafhandeling, simulator, passage-API en Viewer-RBAC.
- Runtimehealth: PostgreSQL, Redis, storage, FFmpeg, API, web, video-worker en
  ANPR-worker gezond.
- Productie-afhankelijkheden: `npm audit --omit=dev` meldt 0 kwetsbaarheden.

## Handmatige test met de echte ITC413-PW4D-IZ1

1. Controleer in de VS Code WSL-terminal dat alles draait:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build
docker compose ps
```

2. Open `http://localhost:3000`, log in en kies **Camera's**.
3. Klik bij de echte Dahua-camera op **Bewerken**.
4. Kies **Dahua CGI TrafficJunction** als ANPR-provider.
5. Kies `HTTP` en poort `80`, tenzij je de camerawebinterface aantoonbaar via HTTPS of
   een andere poort gebruikt. Laat het Dahua-kanaal eerst op `1`.
6. Laat de gebruikersnaam en het wachtwoord leeg als de reeds opgeslagen RTSP-
   inloggegevens ook voor HTTP gelden. Klik **Wijzigingen opslaan**.
7. Open **Systeemstatus**. Binnen ongeveer 10–20 seconden hoort bij de camera onder
   ANPR-events `CONNECTED` te staan. RTSP heeft een eigen status.
8. Als de status niet verbonden wordt, bekijk alleen de veilige logs:

```bash
docker compose logs --tail=100 anpr-worker
```

9. Open **Live passages** en laat veilig één auto door het herkenningsgebied rijden.
10. Wacht enkele seconden. Controleer dat het kenteken bovenaan verschijnt met bron
    **Camera-ANPR**, juiste camera en tijd.
11. Klik op de passage en controleer overzichtsfoto, kentekenfoto en beschikbare kleur,
    type, merk, confidence, richting en lane.
12. Laat dezelfde fysieke passage niet opnieuw plaatsvinden en controleer dat een
    opnieuw verzonden event niet dubbel wordt opgeslagen.
13. Onderbreek, als dit veilig kan, kort het cameranetwerk. Controleer dat alleen de
    ANPR-eventstatus uitvalt en de worker automatisch opnieuw verbindt na herstel.

Volg tijdens één passage desgewenst live de veilige logs:

```bash
docker compose logs -f anpr-worker
```

Stop het volgen met `Ctrl+C`; de containers blijven draaien.

## Bekende beperkingen en nog te valideren

- De exacte CGI-query moet nog op de daadwerkelijke ITC413-firmware worden bevestigd.
- Er moet worden bevestigd of die firmware HTTP Digest met een ondersteunde variant
  gebruikt en of dezelfde account als RTSP voldoende CGI-rechten heeft.
- De werkelijke namen voor kenteken, event-ID, tijd, confidence, voertuigmetadata en
  land/regio zijn firmware-afhankelijk; onbekende velden worden veilig genegeerd.
- De `Content-Disposition`/volgorde waarmee overview en plate crop worden geleverd moet
  met een echt event worden gecontroleerd. Bij ontbrekende duidelijke naam gebruikt de
  adapter voorzichtig eerste JPEG als overview en tweede als plate crop.
- HTTPS met een zelfondertekend cameracertificaat wordt bewust niet onveilig vertrouwd.
- Fallback-deduplicatie gebruikt standaard drie seconden en exact hetzelfde kenteken;
  twee werkelijke passages blijven leidend wanneer de camera unieke event-ID's levert.
- Polling iedere drie seconden past bij 5–10 gebruikers; SSE kan later zonder wijziging
  van de camera-integratie worden toegevoegd.
- De worker is in Fase 2.2 bedoeld als één instantie. Voor horizontale schaalverdeling
  is eerst een gedistribueerde camera-lease nodig, zodat twee workers niet dezelfde
  camera-eventstream openen.
- Pushnotificaties, volledige watchlists, server-OCR, HLS/WebRTC en een retentiejobscheduler
  vallen bewust buiten Fase 2.2.

Fase 2.3 is niet gestart. Eerst volgt de handmatige firmware- en passagevalidatie.
