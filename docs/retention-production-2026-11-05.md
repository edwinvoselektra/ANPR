# FIFO-productie-uitrol — 5 november 2026

De FIFO-code van commit `52dd4872b72f6e95eeb70965afc867b088ddb2e2` is uitgerold
op `anpr-prod`, project `/opt/anpr`. Automatische passage-/fotoretentie blijft uit.
Een eenmalige proefrun heeft geen gegevens verwijderd.

## Beginsituatie en behoud

- Root: ext4 op `/dev/ubuntu-vg/ubuntu-lv`, 80 GiB LV, 0 bytes beschikbaar.
- Virtuele disk: 127 GiB; bestaande volumegroep had 43,95 GiB vrije extents.
- PostgreSQL en workers waren ongezond; API bleef herstarten.
- Drie ongecommitte wijzigingen voor expliciete ITSAPI-berichten zonder kenteken
  stonden in de API-bronbestanden. Inspectie van de oude API-image bevestigde dat
  deze functionaliteit al live was. Zij is behouden, niet gereset of overschreven.
- De bewaarde serverpatch heeft SHA-256
  `a15d94722d57372573aa8cea8eff2a142d3402f06f5c5a0569e9878b165ba64a`.

Oude, ongebruikte Docker-buildcache van minstens zeven dagen oud is gericht
opgeruimd. Er zijn geen bestaande images, volumes, passages of foto's verwijderd.
Hiermee kwam ongeveer 3,8 GB beschikbaar en herstelde PostgreSQL naar gezond.

## Onafhankelijke back-up en herstelproef

De ANPR-schrijvers `api`, `anpr-worker` en `video-worker` zijn tijdelijk gestopt.
PostgreSQL, Redis en web bleven draaien. Database, volledig mediavolume,
configuratie, oorspronkelijke serverpatch en rollbackmanifest zijn buiten de
server opgeslagen in de lokale, Git-genegeerde map:

`data/backups/anpr-prod-fifo-20261105T153508Z/`

De map heeft rechten 0700; database-, media- en configuratiebestanden hebben
rechten 0600. De configuratieback-up bevat secrets en mag niet gedeeld of gecommit
worden. Transport gebruikte TLS met wederzijdse certificaatcontrole. De tijdelijke
serverpoort was uitsluitend voor het clientadres toegestaan; server, firewallregel
en tijdelijke privésleutels zijn na de back-up opgeruimd.

| Controle | Resultaat |
| --- | --- |
| PostgreSQL custom-format dump | 30.298.881 bytes; server-/client-SHA-256 gelijk |
| Volledig media-archief | 33.939.732.480 bytes; server-/client-SHA-256 gelijk |
| Bestanden in media-archief | 131.953 |
| Afbeeldingsreferentiesteekproef | 100 van 100 aanwezig |
| Volledige database-restore | Geslaagd in lokale container zonder netwerk |
| Aantallen in bron en herstelkopie | 65.896 passages, 19 hits, 0 bewaarexcepties |
| FIFO-schemawijziging op herstelkopie | Geslaagd; aantallen behouden, journal leeg |

Op de herstelkopie is geen verwijderende retentierun uitgevoerd. De eerdere
verwijderende integratietests gebruikten uitsluitend synthetische gegevens.
De tijdelijke herstelcontainer is na verificatie opgeruimd; de back-up blijft bestaan.

## Capaciteit en uitrol

Na de bewezen back-up is het bestaande LV inclusief ext4-filesystem online van
80 naar **100 GiB** vergroot met:

```bash
sudo lvextend --resizefs --size 100G /dev/ubuntu-vg/ubuntu-lv
```

Er zijn geen partities geformatteerd, partities vergroot of disks vervangen.
De volumegroep hield circa 23,95 GiB vrije extents over. Na de builds en uitrol
rapporteerde `df` circa **15 GB beschikbare filesystemruimte**.

De FIFO-commit is naar GitHub gepusht en op de server fast-forward opgehaald.
De oorspronkelijke serverpatch en checksum van `docker-compose.prod.yml` zijn
voor en na de update gecontroleerd en gelijk gebleven. De combinatie van FIFO
met de behouden live patch is in een aparte lokale bronkopie gecontroleerd:
API-TypeScript en lint slagen; 335 API-tests slagen, vier bestaande opt-in tests
zijn in die aanvullende run overgeslagen.

De bestaande productie-overlay is behouden. Een aanvullende serverlokale override
borgt de veilige vlaggen en staat in:

`/opt/anpr/data/releases/fifo-52dd487/retention-safe.yml`

Alle diensten gebruiken de bestaande volumes en UID-instellingen. Zowel de combinatie
met deze override als alleen basis plus productie-overlay resolveert naar:

```dotenv
RETENTION_ENABLED=false
RETENTION_DRY_RUN=true
RETENTION_PRESSURE_ENABLED=false
RETENTION_DAYS=90
```

API, ANPR-worker, video-worker en migratiedienst zijn op de server opnieuw gebouwd.
De bestaande migratiedienst heeft `20261028000100_passage_retention` succesvol
toegepast. Vóór het starten van de nieuwe applicatiediensten zijn gecontroleerd:
één geslaagde migratieregistratie, vier beeldreferentie-triggers, dezelfde 65.896
passages en 19 hits, en een leeg verwijderjournal.

API en workers zijn vervolgens gericht gestart. PostgreSQL/Redis-volumes zijn niet
vervangen; de bestaande web-image is niet herbouwd.

## Proefrun en acceptatie

De proefrun riep alleen `RetentionService.run()` aan vanuit de nieuwe worker-image.
De bestaande worker bleef uitgeschakeld voor retentie. In de afzonderlijke aanroep
was proefmodus verplicht, drukretentie uit, de databasetransactie alleen-lezen en
bestandsverwijdering geblokkeerd. De kandidaatselectie is met onafhankelijke SQL
vergeleken.

| Controle | Resultaat |
| --- | --- |
| Voor verwijdering in aanmerking bij 90 dagen | **0** |
| Journal vóór / na | 0 / 0 |
| Aanroepen van bestandsverwijdering | 0 |
| API, ANPR-worker, video-worker | Gezond |
| PostgreSQL, Redis, web | Gezond |
| API readiness | HTTP 200; database, Redis, storage, FFmpeg en beide workers gezond |
| Historische JPEG's leesbaar als API-gebruiker | 71 |
| Loginpagina | HTTP 200 |
| Anonieme `/auth/me` | HTTP 401, zoals bedoeld |
| Echte camera-inname na herstart | Hervat; bij controle 65.962 passages en 19 hits |
| Verwijderjournal na hervatte inname | Nog steeds leeg |

De proefrun bewijst geen ruimtewinst: bij de huidige bewaartermijn zijn geen
passages geselecteerd. Drukretentie en daadwerkelijke verwijdering zijn niet
ingeschakeld. Bestaande 14-dagen-`expiresAt`-waarden zijn niet herschreven;
nieuw opgeslagen passages gebruiken de nieuwe standaard van 90 dagen.

## Beheer en resterende acceptatie

Gebruik voor beheer de bestaande productie-overlay en de veilige aanvullende override:

```bash
cd /opt/anpr
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  -f data/releases/fifo-52dd487/retention-safe.yml ps -a
```

Gebruik `sudo` wanneer de servergebruiker geen directe toegang tot Docker heeft.
De bestaande drie ITSAPI-bestanden blijven bewust als gewijzigd in de serverwerkboom
staan. Behoud deze patch ook bij toekomstige updates. De lokale ontwikkelwerkboom
bevat deze serverfix niet; de afzonderlijke verificatiekopie en back-up wel.

Rollbackimages zijn bewaard als `anpr-fifo-rollback-api:52dd487`,
`anpr-fifo-rollback-anpr-worker:52dd487`, `anpr-fifo-rollback-video-worker:52dd487`
en `anpr-fifo-rollback-migrate:52dd487`. Het oorspronkelijke image-/commitmanifest,
serverpatch en proefrunresultaat staan onder `/opt/anpr/data/releases/fifo-52dd487/`.
Bij rollback blijven de additieve migratie, triggers en tombstones behouden.

Nog open: echte gebruikerslogin via de browser en een structurele, gecontroleerde
database-/mediaback-upvoorziening. Deze release maakte een eenmalige onafhankelijke
back-up; er is geen terugkerende ANPR-back-uptaak geconfigureerd. Blijf vrije ruimte
controleren zolang automatische verwijdering uit staat.
