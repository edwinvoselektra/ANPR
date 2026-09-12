# ANPR Platform

Een webbased ANPR-platform voor buurtpreventie. Fase 1 levert werkend gebruikers- en
camerabeheer, veilige authenticatie, een dashboard, echte RTSP/FFmpeg-verbindingstests
en een duidelijk gemarkeerde demo/simulator. Fase 2.1 voegt een zelfstandige
video-worker toe die actieve camera's bewaakt en begrensd echte testframes ophaalt.
Fase 2.2 voegt optionele Dahua-camera-ANPR-inname, echte passageopslag en het scherm
**Live passages** toe. Fase 2.3 levert kenteken- en groepenbeheer, automatische hits,
database-side zoeken en kentekendossiers. Fase 2.4 maakt de webapp installeerbaar als
PWA en voegt persoonlijke Web Push-hitmeldingen toe. Server-side OCR blijft een latere provider.

> **Belangrijk:** demo-passages zijn geen echte ANPR-detecties. De interface toont ze
> altijd met bron `DEMO`.

## Wat heb je nodig?

- Docker Desktop met werkende WSL-integratie;
- Docker Compose (`docker compose version`);
- een browser.

Node.js, PostgreSQL, Redis en FFmpeg hoeven niet apart op Windows/WSL geïnstalleerd te
worden; deze staan in de containers.

## Eerste installatie

Open de VS Code WSL-terminal in deze projectmap:

```bash
cd /home/edwin/projects/anpr-platform
```

### 1. Veilige lokale instellingen maken

Voer exact uit:

```bash
bash scripts/setup-env.sh
```

Dit maakt een Git-genegeerd `.env`-bestand met willekeurige database- en
camera-encryptiesleutels. Het script overschrijft nooit een bestaande `.env`.

### 2. Containers bouwen en starten

```bash
docker compose up -d --build
```

De eerste build kan enkele minuten duren. Bekijk de status met:

```bash
docker compose ps
```

### 3. Rollen en demo-data laden

```bash
docker compose --profile tools run --rm seed
```

Dit maakt rollen/permissions, Uddel Noord, Uddel Oost, Uddel West, groep `Aandacht`,
testkenteken `12-ABC-3` en enkele expliciete DEMO-passages. Er wordt geen
standaardgebruiker of standaardwachtwoord gemaakt.

### 4. Eerste administrator veilig aanmaken

```bash
docker compose run --rm api npm run admin:create
```

Vul e-mailadres, gebruikersnaam en weergavenaam in. Het wachtwoord wordt niet getoond.
Gebruik minimaal 12 tekens met hoofdletters, kleine letters en cijfers.

### 5. Open de applicatie

Open in je browser:

```text
http://localhost:3000
```

Log in met de administrator die je zojuist hebt aangemaakt.

## Dagelijks gebruik

Starten:

```bash
docker compose up -d
```

Stoppen zonder data te verwijderen:

```bash
docker compose down
```

Opnieuw starten:

```bash
docker compose restart
```

Logs volgen, inclusief beide workers:

```bash
docker compose logs -f web api video-worker anpr-worker postgres redis
```

Stop het volgen van logs met `Ctrl+C`; de containers blijven draaien.

## Camera toevoegen en RTSP testen

1. Log in als Administrator en kies **Camera’s → Camera toevoegen**.
2. **Camera:** naam, locatie, lokaal netwerk of bestaande VPN-locatie, host en camera-inlog.
3. **Beeld controleren:** test een nieuw gedecodeerd RTSP-frame en snapshot. Een open poort of streammetadata is onvoldoende. Verdergaan zonder beeld kan met een expliciete waarschuwing.
4. **Kentekengegevens koppelen:** stel voor de hervatbare conceptcamera de afzonderlijke ITSAPI-uploadinlog, bestaande Device ID en het bevestigde LAN-/VPN-serveradres in.
5. **Praktijktest en afronden:** controleer de afzonderlijke diagnose en sla desgewenst op met openstaande tests.

Afwijkende RTSP-gegevens en de bestaande transport-/zonewizard staan onder **Geavanceerd**. De bestaande CGI-eventstream blijft beschikbaar als alternatief; dit is geen ITSAPI. VPN is behouden.

**ITSAPI-status:** diagnostische receiver aanwezig; echte registratie, heartbeat, payloadmapping en ACK nog niet geverifieerd. Zie [ontvanger, camerakaart, ontbrekend protocolbewijs en testprocedure](docs/itsapi-receiver.md). De camera bevestigt V1.19, `/NotificationInfo/KeepAlive` en `/NotificationInfo/TollgateInfo`. Intern luistert de API op 7070; op deze Windows-pc bezet AnyDesk poort 7070 en publiceert Docker daarom **7071** (`ITSAPI_PUBLISHED_PORT=7071` in lokale `.env`). Voorgesteld adres: **`http://192.168.178.18:7071`**, nog door admin te bevestigen.

Camera-credentials worden met AES-256-GCM versleuteld opgeslagen. De browser krijgt
opgeslagen credentials en volledige credential-URL's nooit terug.

Veelvoorkomende RTSP-fouten:

- **Authenticatie mislukt:** controleer gebruikersnaam/wachtwoord.
- **Poort gesloten:** controleer RTSP-poort en camerafirewall.
- **Camera niet bereikbaar:** controleer IP-adres en netwerkroute vanuit Docker.
- **Stream/path fout:** controleer het merk/model-specifieke RTSP-pad.
- **Timeout:** de camera reageert niet binnen 12–15 seconden.

## Demo/simulator testen

1. Log in als Administrator of Operator.
2. Open **Demo / simulator**.
3. Selecteer een actieve echte of demo-camera uit de database.
4. Kies kenteken, voertuigkleur, voertuigtype, rijrichting en eventueel een tijdstip.
5. Gebruik `12-ABC-3` om met de standaard demo-data een DEMO-hit te maken.
6. Klik **DEMO-passage genereren**.
7. Controleer **Live passages**, **Hits**, **Dashboard**, **Zoeken** en het dossier.

De simulator analyseert geen beeld en doet geen claim van echte herkenning.

## Gebruikers, rollen en sessies

- Administrator beheert gebruikers, camera's en systeemstatus.
- Operator kan passages/hits zien, kentekens en groepen beheren en de
  simulator bedienen, maar geen kritieke instellingen wijzigen.
- Viewer heeft alleen leesrechten en wordt server-side geweigerd bij beheeracties.
- Na vijf foute wachtwoorden wordt een account 15 minuten geblokkeerd.
- **Uitloggen op alle apparaten** is via de API aanwezig; een profielpagina volgt later.

## Healthchecks

Publieke liveness:

```bash
curl http://localhost:4000/health
```

Readiness van PostgreSQL, Redis, storage en FFmpeg:

```bash
curl http://localhost:4000/health/ready
```

De video-worker en ANPR-worker publiceren ieder een eigen heartbeat en staan los van
elkaar op de beveiligde pagina **Systeemstatus**.

Interne liveness van de video-worker controleer je via Docker:

```bash
docker compose exec video-worker wget -qO- http://127.0.0.1:4100/health
```

Interne liveness van de ANPR-worker:

```bash
docker compose exec anpr-worker wget -qO- http://127.0.0.1:4200/health
```

## Fase 2.2 Dahua ANPR-events testen

De provider is ingericht voor Dahua's `TrafficJunction` multipart-snapshot-eventstream.
De officiële publiek toegankelijke productdocumentatie bevestigt de benodigde
interfaces, maar bevat niet de volledige event-wire-specificatie. Endpoint, velden en
afbeeldingsvolgorde moeten daarom één keer met de echte ITC413-firmware worden gecontroleerd.

1. Open **Camera’s**, kies de echte camera en klik **Bewerken**.
2. Kies bij **ANPR-provider**: **Dahua CGI TrafficJunction**.
3. Kies `HTTP` en poort `80`, tenzij de webinterface van jouw camera aantoonbaar via
   HTTPS of een andere poort draait. Laat **Dahua-kanaal** eerst op `1`.
4. Laat gebruikersnaam en wachtwoord leeg als de bestaande RTSP-inloggegevens ook voor
   de camerawebinterface gelden; de versleutelde waarden blijven dan behouden.
5. Sla op en open **Systeemstatus**. ANPR-events hoort `CONNECTED` te worden.
6. Open **Live passages** en laat veilig één voertuig passeren. Binnen enkele seconden
   hoort de passage bovenaan te staan.
7. Open de passage en controleer kenteken, camera, tijd en beschikbare foto’s.

Veilige workerlogs volgen:

```bash
docker compose logs -f anpr-worker
```

De logs tonen geen wachtwoord en redigeren kentekens. Stop volgen met `Ctrl+C`.

## Kentekens, groepen, hits en zoeken

1. Open **Groepen** en maak bijvoorbeeld `Aandacht` aan.
2. Zet **Hitdetectie actief** en **Reden verplicht** aan.
3. Open **Kentekens**, voeg `12-ABC-3` toe, kies de groep en vul een reden in.
4. Eén kenteken kan aan meerdere groepen worden gekoppeld. Spaties en streepjes worden
   voor vergelijking verwijderd; er worden geen gokcorrecties voor O/0 of I/1 gedaan.
5. Gebruik de simulator of laat een echte Dahua-passage binnenkomen. Een actieve,
   geldige match maakt automatisch precies één hit per opgeslagen passage.
6. Open **Hits** voor de nieuwste hits en klik door naar alle details en foto's.
7. Open **Zoeken** om kenteken, kleur, type, camera, locatie, datum, tijd, groep, hit en
   rijrichting te combineren. Resultaten worden in PostgreSQL gefilterd en gepagineerd.
8. Klik in de kentekenlijst of zoekresultaten op het kenteken voor het dossier met
   losse waarnemingen. Dit is nadrukkelijk geen gegarandeerde realtime locatie.

Administrator en Operator mogen kentekens en groepen wijzigen. Viewer kan deze
gegevens, hits en zoekresultaten alleen bekijken; de API blokkeert beheerrequests.
Pushnotificaties kunnen per gebruiker en apparaat onder **Instellingen** worden geactiveerd.

## PWA en Web Push instellen

De gewone webapp blijft zonder pushsleutels werken. Voer voor Web Push één keer exact uit:

```bash
cd /home/edwin/projects/anpr-platform
docker compose run --rm api npx web-push generate-vapid-keys
```

Dit toont een publieke en private sleutel. Open `.env` en vul uitsluitend lokaal in:

```dotenv
VAPID_PUBLIC_KEY=plak_hier_de_public_key
VAPID_PRIVATE_KEY=plak_hier_de_private_key
VAPID_SUBJECT=mailto:jouw-beheeradres@example.nl
```

De private sleutel mag nooit worden gedeeld of gecommit. Herbouw en start daarna:

```bash
docker compose up -d --build
```

Meldingen inschakelen:

1. Open `http://localhost:3000` en log in.
2. Open **Instellingen**.
3. Klik zelf op **Meldingen op dit apparaat inschakelen**.
4. Kies in de browser **Toestaan**.
5. Kies alle hits of specifieke actieve hitgroepen en klik **Voorkeuren opslaan**.
6. Gebruik **Testmelding** bij het gekoppelde apparaat.

De browser vraagt nooit automatisch om toestemming. Als toestemming is geweigerd,
open dan via het slotje in de adresbalk de site-instellingen, zet **Meldingen** op
**Toestaan** en laad de pagina opnieuw.

Installeren op desktop of Android kan via **App installeren** in het browsermenu. Op
iPhone/iPad (iOS/iPadOS 16.4 of nieuwer) open je de site in Safari, kies je **Deel** →
**Zet op beginscherm**, open je vervolgens die geïnstalleerde app en schakel je daar
meldingen in. Buiten `localhost` vereisen PWA en Web Push een geldige HTTPS-verbinding;
een onbeveiligd lokaal IP-adres is daarvoor niet voldoende.

Een simulatorhit gebruikt hetzelfde centrale pushpad als een Dahua-hit. Test dit door
een actief signaleringskenteken te simuleren en binnen enkele seconden de hitmelding
op ieder ingeschakeld apparaat te controleren. De melding bevat geen afbeelding of
credentials en opent de beveiligde hitdetailpagina. Meldingsinhoud kan zichtbaar zijn
op het vergrendelscherm; stel de privacy daarvan op het apparaat naar wens in.

## Fase 2.1 video-worker handmatig testen

1. Zorg dat een echte camera in **Camera’s** actief staat en eerder via de wizard is
   getest. De worker gebruikt de opgeslagen, versleutelde verbinding.
2. Start of herbouw de omgeving met `docker compose up -d --build`.
3. Volg veilige workerlogs met `docker compose logs -f video-worker`.
4. Open **Systeemstatus**. De video-worker moet Online worden en de camera hoort na
   een succesvol frame als Online te verschijnen.
5. Schakel de camera kort uit of blokkeer de RTSP-verbinding. Na de capture-timeout
   wordt de camera Offline; de worker blijft opnieuw proberen.
6. Herstel de camera. Zonder containerherstart moet de camera vanzelf weer Online
   worden.

De worker bewaart geen video en maakt geen passages. Per camera wordt alleen het
nieuwste testframe bewaard; een volgend frame overschrijft het vorige atomair.

Configuratie in `.env` is optioneel omdat Compose veilige developmentdefaults heeft:

```dotenv
VIDEO_SAMPLE_FPS=0.1
VIDEO_RETRY_SECONDS=10
VIDEO_CAMERA_REFRESH_SECONDS=10
VIDEO_CAPTURE_TIMEOUT_SECONDS=15
VIDEO_WORKER_PORT=4100
```

`VIDEO_SAMPLE_FPS` accepteert maximaal `1`. Verhoog dit niet zonder eerst CPU-, netwerk-
en camerabelasting te controleren.

## Fase 2.4.5 VPN-locaties

Administrators beheren onder **Locaties** een ER605/andere WireGuard-locatie,
adresplan, recorder en configuratiewizard. Operators kunnen de locatie- en
verbindingsstatus bekijken. Camera's blijven standalone mogelijk en kunnen optioneel
aan een locatie/recorder worden gekoppeld. De volledige handmatige routerhandleiding
staat in [docs/er605-wireguard-setup.md](docs/er605-wireguard-setup.md).

Voeg voor lokale ontwikkeling desgewenst aan `.env` toe:

```dotenv
VPN_TUNNEL_CIDR=10.100.0.0/24
VPN_SERVER_ADDRESS=10.100.0.1
VPN_SERVER_ENDPOINT=
VPN_LISTEN_PORT=51820
VPN_HEALTH_INTERVAL_SECONDS=30
VPN_HEALTH_TIMEOUT_MS=2000
VPN_STATUS_FILE=
```

Er wordt geen routerwachtwoord opgeslagen. Docker krijgt geen `NET_ADMIN` of
`privileged`; echte WireGuard-routing draait in de lokale opzet op de WSL/Windows-host.
Na deze fase start Fase 2.5 Live camera's nadrukkelijk nog niet.

## Database en migraties

Migraties worden bij `docker compose up` automatisch uitgevoerd door de eenmalige
`migrate`-service. Handmatig opnieuw uitvoeren:

```bash
docker compose run --rm migrate
```

Prisma-schema valideren:

```bash
docker compose run --rm api npm run db:validate
```

## Kwaliteitscontroles

Voer na wijzigingen exact uit:

```bash
docker compose run --rm api npm run build -w @anpr/api
docker compose run --rm video-worker npm run build -w @anpr/video-worker
docker compose run --rm anpr-worker npm run build -w @anpr/anpr-worker
docker compose run --rm web npm run build -w @anpr/web
docker compose run --rm api npm run typecheck -w @anpr/database
docker compose run --rm api npm run lint -w @anpr/api
docker compose run --rm video-worker npm run lint -w @anpr/video-worker
docker compose run --rm anpr-worker npm run lint -w @anpr/anpr-worker
docker compose run --rm web npm run lint -w @anpr/web
docker compose run --rm api npm run lint -w @anpr/shared
docker compose run --rm api npm run test -w @anpr/api
docker compose run --rm video-worker npm run test -w @anpr/video-worker
docker compose run --rm anpr-worker npm run test -w @anpr/anpr-worker
docker compose run --rm api npm run test -w @anpr/database
docker compose run --rm api npm run test -w @anpr/shared
docker compose run --rm web npm run test -w @anpr/web
docker compose run --rm api npm run test:runtime -w @anpr/api
docker compose run --rm api npm run db:validate
docker compose run --rm api npm audit --audit-level=high
docker compose config --quiet
docker compose build
```

## Back-up (voorlopig handmatig)

Automatische back-ups en de beheerinterface zijn TODO voor Fase 5. Een handmatige
PostgreSQL-back-up kan veilig naar de lokale projectmap worden geschreven met:

```bash
mkdir -p data/backups
docker compose exec -T postgres pg_dump -U anpr_app -d anpr > data/backups/anpr-$(date +%Y%m%d-%H%M%S).sql
```

`data/` staat in `.gitignore`. Snapshots staan in het Docker-volume `storage_data` en
vallen nog niet onder deze databaseback-up.

## Updates

Maak vóór een update een back-up en voer daarna uit:

```bash
docker compose down
docker compose up -d --build
docker compose run --rm migrate
```

Gebruik geen `docker compose down -v`: `-v` verwijdert database- en opslagvolumes.

## Problemen oplossen

Status bekijken:

```bash
docker compose ps
```

API-logs bekijken:

```bash
docker compose logs --tail=200 api migrate
```

Alles normaal opnieuw starten:

```bash
docker compose down
docker compose up -d
```

Als poort 3000 of 4000 al bezet is, stop dan eerst de andere applicatie die die poort
gebruikt. Verwijder geen volumes en pas Docker-socketrechten niet aan.

## Documentatie

- [Architectuur](docs/architecture.md)
- [Resultaat Fase 1](docs/PHASE1-RESULT.md)
- [Resultaat Fase 2.1](docs/PHASE2.1-RESULT.md)
- [Resultaat Fase 2.2](docs/PHASE2.2-RESULT.md)
- [Resultaat Fase 3](docs/PHASE3-RESULT.md)
- [Resultaat Fase 2.4.5](docs/PHASE2.4.5-RESULT.md)
- [ER605 WireGuard instellen](docs/er605-wireguard-setup.md)
- [Dahua TCP / SDK koppelen](docs/dahua-tcp-sdk.md)

## Stop na Fase 2.4.5

Fase 2.5 Live camera's, server-OCR en productiedeployment zijn niet gestart. Eerst
volgt de handmatige ER605- en recorder-test uit de handleiding.

### Dahua-camera’s: ITSAPI en CGI afzonderlijk

De vierstappenwizard en diagnose onderscheiden video, ontvanger, authenticatie, registratie, heartbeat en passage. De ITSAPI-hardwarekoppeling is nog niet voltooid. [Implementatie, instellingen en testmatrix](docs/itsapi-receiver.md) beschrijven het bewijs en de resterende stappen. Het bestaande [CGI-alternatief](docs/dahua-native-anpr.md) behoudt zijn eigen naam en werking.

Verwijderen vereist adminrechten, trekt camera- en uploadcredentials in en archiveert de referentie voor historische passages/hits. Schakel ITSAPI vervolgens zelf uit op de fysieke camera. Demo-push vereist nu een expliciete keuze.


### Groepshits, dashboard en gebeurtenisbeelden

Een actieve groep met **HIT aan** geeft bij een geldig actief lid één Hit per passage, met alle matchende groepen en redenen. Er bestaat geen aanvullend individueel HIT-vinkje. Het dashboard leest Hit-records rechtstreeks, gebruikt voor teller en de laatste vijf hits dezelfde dag in **Europe/Amsterdam**, en ververst iedere drie seconden. Demo blijft meetellen zoals voorheen, met expliciete demo-aantallen en labels.

De huidige echte testcamera gebruikt **DAHUA_CGI**. Laat deze werkende provider behouden. Drie samengevoegde JPEG-beelden zijn daadwerkelijk aangetroffen; de worker splitst overzicht, kenteken en voertuig volgens de ontvangen offsets en lengtes. Oude passages worden niet achteraf gewijzigd. ITSAPI V1.19 is nog een diagnostische ontvanger zonder bewezen heartbeat-/ANPR-parser of ACK.

Zie [bevindingen, regressietests en exacte praktijktest](docs/group-hit-dashboard.md).

### Publieke HTTPS-testomgeving

Voor `https://anpr.vanmilligentechniek.com` gebruikt de expliciete overlay `docker-compose.external.yml` een echte productiebuild, met behoud van de bestaande tunnel. De gewone Compose-configuratie blijft lokale ontwikkelmodus. Zie [oorzaak van de Next.js-403, startcommando’s en HTTPS-/sessietests](docs/external-https-test.md). Gebruik voor externe web/API-updates steeds beide Compose-bestanden.
