# ANPR Platform

Een webbased ANPR-platform voor buurtpreventie. Fase 1 levert werkend gebruikers- en
camerabeheer, veilige authenticatie, een dashboard, echte RTSP/FFmpeg-verbindingstests
en een duidelijk gemarkeerde demo/simulator. Fase 2.1 voegt een zelfstandige
video-worker toe die actieve camera's bewaakt en begrensd echte testframes ophaalt.
Kentekenherkenning/OCR is nog niet geïmplementeerd.

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

Logs volgen, inclusief de video-worker:

```bash
docker compose logs -f web api video-worker postgres redis
```

Stop het volgen van logs met `Ctrl+C`; de containers blijven draaien.

## Camera toevoegen en RTSP testen

1. Log in als Administrator.
2. Kies **Camera’s** en **Camera toevoegen**.
3. Vul naam, locatie, omschrijving, richting en eventueel coördinaten in.
4. Kies een volledige RTSP-URL of losse host/poort/path/credentials.
5. Klik **Verbinding testen**. De API gebruikt echt `ffprobe` en probeert één snapshot
   met FFmpeg te maken.
6. Teken eventueel een rechthoek op de snapshot.
7. De ANPR-test is eerlijk gemarkeerd als TODO voor Fase 2.
8. Controleer het overzicht en sla de camera op.

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
3. Selecteer een Uddel-camera.
4. Gebruik `12-ABC-3` om een DEMO-hit te maken.
5. Klik **DEMO-passage genereren**.
6. Open/ververs Dashboard om de echte databasewijziging te zien.

De simulator analyseert geen beeld en doet geen claim van echte herkenning.

## Gebruikers, rollen en sessies

- Administrator beheert gebruikers, camera's en systeemstatus.
- Operator kan passages/hits zien, kentekens beheren (workflow volgt Fase 3) en de
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

De video-worker publiceert een echte heartbeat en staat als Online/Offline op de
beveiligde pagina **Systeemstatus**. De ANPR-worker blijft bewust `not_implemented`.

Interne liveness van de video-worker controleer je via Docker:

```bash
docker compose exec video-worker wget -qO- http://127.0.0.1:4100/health
```

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
docker compose run --rm web npm run build -w @anpr/web
docker compose run --rm api npm run typecheck -w @anpr/database
docker compose run --rm api npm run lint -w @anpr/api
docker compose run --rm video-worker npm run lint -w @anpr/video-worker
docker compose run --rm web npm run lint -w @anpr/web
docker compose run --rm api npm run lint -w @anpr/shared
docker compose run --rm api npm run test -w @anpr/api
docker compose run --rm video-worker npm run test -w @anpr/video-worker
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

## Volgende fase

Na handmatige goedkeuring van Fase 2.1 kan een afzonderlijke volgende stap tracking,
frame-selectie en de verwisselbare `ANPRProvider` ontwerpen. Deze onderdelen worden
niet automatisch gestart.
