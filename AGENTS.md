# Projectregels voor het ANPR-platform

## Algemene werkwijze

- Werk uitsluitend binnen `/home/edwin/projects/anpr-platform`.
- Verwijder geen bestaande werkende functionaliteit zonder goede reden.
- Werk gefaseerd en in kleine, controleerbare stappen.
- Presenteer nooit nepfunctionaliteit alsof deze daadwerkelijk werkt.
- Gebruik duidelijke TODO's voor onderdelen die nog niet geïmplementeerd zijn.
- Leg belangrijke technische keuzes vast in `/docs`.
- Houd de README actueel.
- Als ik zelf een commando moet uitvoeren, geef exact aan welk commando ik moet kopiëren.

## Technische uitgangspunten

- Frontend: Next.js / React / TypeScript.
- Backend API: Node.js / TypeScript.
- Database: PostgreSQL.
- ORM: Prisma.
- Redis voor queues/background processing waar nodig.
- Docker en Docker Compose als basis voor development en deployment.
- FFmpeg voor RTSP/videoverwerking.
- ANPR-functionaliteit moet modulair worden opgebouwd.
- Videoverwerking mag de webinterface/API niet blokkeren.
- Opslagprovider moet modulair zijn voor lokale disk, NAS en later S3-compatible storage.
- Gebruik PostgreSQL niet voor het opslaan van grote afbeeldingsbestanden.

## Security

- Security moet vanaf het begin onderdeel van het ontwerp zijn.
- Nooit echte secrets, wachtwoorden of API-keys in Git opslaan.
- Maak een `.env.example`, maar zet nooit echte secrets daarin.
- Zorg dat `.env` via `.gitignore` wordt uitgesloten.
- Wachtwoorden moeten veilig worden gehasht.
- Camera/RTSP-wachtwoorden moeten encrypted-at-rest worden opgeslagen.
- RTSP-wachtwoorden en volledige RTSP-URL's met credentials mogen nooit worden teruggestuurd naar de frontend.
- Log nooit plaintext wachtwoorden, tokens of camera-credentials.
- Gebruik inputvalidatie, RBAC, rate limiting en veilige authenticatie.
- Houd rekening met CSRF, XSS en brute-force-aanvallen.
- Gebruik least privilege waar praktisch mogelijk.

## Kwaliteitscontrole

Controleer na belangrijke wijzigingen waar van toepassing:

- TypeScript
- linting
- unit tests
- integration tests
- database migrations
- Docker build
- Docker Compose configuratie

Los fouten op voordat een fase als voltooid wordt gemarkeerd.

## Git

- Commit geen `.env`, databasebestanden, snapshots, kentekenfoto's, logs met gevoelige gegevens of secrets.
- Zorg voor een goede `.gitignore`.
- Houd wijzigingen overzichtelijk.
- Maak geen destructieve Git-acties zonder expliciete noodzaak.

## ANPR-architectuur

Houd deze onderdelen duidelijk van elkaar gescheiden:

```text
RTSP-camera
↓
Video ingest
↓
Voertuigdetectie/tracking
↓
ANPR / voertuigclassificatie
↓
Passage service
↓
PostgreSQL + afbeeldingopslag
↓
Hit detection
↓
Notification service
↓
Webinterface/PWA
```

Een ANPR-engine moet later vervangen kunnen worden zonder de rest van de applicatie opnieuw te bouwen.

## Development

De applicatie moet volledig getest kunnen worden zonder echte camera's.

Gebruik daarvoor later een development/demo mode met:

- Uddel Noord
- Uddel Oost
- Uddel West
- gesimuleerde passages
- testkentekens
- testhits

Demo/simulatorfunctionaliteit moet duidelijk als demo worden gemarkeerd en mag niet worden voorgesteld als echte ANPR-detectie.

## Taal

- De standaardtaal van de gebruikersinterface is Nederlands.
- Bereid de frontend voor op toekomstige internationalisatie/i18n.
- Code, technische identifiers en databasenamen mogen Engels zijn.
