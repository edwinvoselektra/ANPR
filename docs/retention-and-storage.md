# ANPR-retentie en opslagherstel

Onderzoek 28 oktober 2026 op basiscommit `b12e98c3c1ec39207d7d2118df6fb5bd260208ca`.
Scope: `edwinvoselektra/ANPR`, productie `anpr-prod`, `/opt/anpr`.
Productie is niet gewijzigd. De gebruiker voert serverstappen zelf uit; SSH vanaf deze onderzoeksmachine wordt geweigerd (publickey).

## Bevindingen

De gebruiker rapporteert een volle rootpartitie (60,7 GB) en PostgreSQL-herstel dat stopt op `No space left on device`.
De actuele disk-/partitie-/PV-/VG-indeling en hypervisor zijn nog niet vastgesteld.
De beschikbare lokale `sources/`-map is leeg; de repository documenteert de productiehost en serverspecifieke Compose-overlay, maar geen hypervisor.
Een `df`-grootte van 60,7 GB bewijst niet dat de virtuele disk zo klein is: er kan al vrije ruimte in de VG of achter de partitie bestaan.

De oude code gaf standaard **14 dagen** mee in `calculatePassageExpiry` en de seed-setting. Ingest las `retention.normalDays` niet. Er was geen passage-/beeldenretentietaak.
Deze wijziging geeft nieuwe passages standaard 90 dagen. Bestaande `expiresAt` en database-settings worden niet stilzwijgend herschreven.
De opruimtaak gebruikt de ontvangsttijd `Passage.timestamp` plus `RETENTION_DAYS`; oude 14-dagenwaarden veroorzaken dus geen voortijdige fysieke verwijdering.
Bestaande API-filters op `expiresAt` kunnen oudere gegevens nog verbergen; het herschrijven daarvan valt buiten deze verwijdertaak.

## Stap 1: alleen uitlezen op de ANPR-server

```bash
hostname
systemd-detect-virt
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
findmnt -no SOURCE,FSTYPE,TARGET /
df -hT /
sudo pvs
sudo vgs
sudo lvs -o lv_path,lv_size,devices
```

Stop als de host niet `anpr-prod` is. Lever de uitvoer aan voordat partities worden gewijzigd.
Controleer daarna uitsluitend ANPR:

```bash
cd /opt/anpr
git rev-parse HEAD
git status --short
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml logs --tail=80 --timestamps postgres
```

De bestaande productie-overlay blijft behouden; vervang hem niet door een ander Compose-bestand.
Print geen volledige Compose-configuratie met ingevulde geheimen.

## Stap 2: back-up en uitbreiding na toestemming

Leg eerst de concrete back-upbestemming, herstelprocedure en voorgestelde wijzigingen voor ter toestemming. Schrijf geen back-up naar de volle rootpartitie.
Als PostgreSQL niet kan herstellen: laat via de daadwerkelijke hypervisor een consistente offline kopie van de bestaande ANPR-VM-schijf op andere opslag maken.
Dit vereist een gecontroleerde uitschakeling na toestemming. Controleer vooraf of de VM uitsluitend ANPR draait; werkzaamheden aan andere diensten vallen buiten scope.
Controleer voltooiing, omvang, leesbaarheid en herstelmogelijkheid. Een snapshot op dezelfde volle opslag is geen onafhankelijke back-up.

Eerst moet capaciteit op VM-/hostniveau beschikbaar zijn, daarna kan Ubuntu die gebruiken.
Als `vgs` al voldoende vrije extents toont, hoeft de virtuele disk mogelijk niet groter.
Als de disk al groot genoeg is maar de PV-partitie niet, is alleen uitbreiding binnen Ubuntu nodig.

De exacte hostingstap vereist eerst identificatie van hypervisor, ANPR-VM en rootdisk:
controleer vrije hostopslag en onafhankelijke back-up; vergroot daarna dezelfde bestaande virtuele rootdisk van uitsluitend die VM.
Geen vervangende disk initialiseren of formatteren. Of vergroting online mag, hangt af van hypervisor, controller en schijfformaat; hiervoor is nog geen specifiek menu/commando vastgesteld.

Maak onderscheid tussen **80 GB virtuele disk** en **80 GiB root-LV**. Door bootpartities, metadata, filesystem-overhead en GB/GiB is dit niet hetzelfde.
Een virtuele disk van 80 GB biedt geen plaats voor een root-LV van 80 GiB. Spreek vóór uitvoering af welk totaal bedoeld wordt.

Onderstaand is uitsluitend een **voorwaardelijk voorbeeld**, geen vastgesteld uitvoerplan voor deze server.
Alleen bij bewezen PV `/dev/sda3`, aaneengesloten vrije ruimte daarachter en na vergroting van die disk op de host:

```bash
# Preview beoordelen voordat er iets wordt gewijzigd:
sudo growpart -N /dev/sda 3
# Alleen na beoordeling en toestemming:
sudo growpart /dev/sda 3
sudo pvresize /dev/sda3
sudo pvs
sudo vgs
```

Bij een PV op de hele disk vervalt `growpart`; gebruik de bewezen PV-naam. NVMe heeft andere namen. Bij encryptie/thin pools/afwijkende layout eerst een nieuw specifiek plan maken.
Als Ubuntu de grotere disk nog niet ziet, volg de hypervisorprocedure voor rescan/herstart voordat je doorgaat.

Pas daarna LV en filesystem vergroten. Ubuntu ondersteunt bijvoorbeeld `sudo lvextend --resizefs --size 80G /dev/ubuntu-vg/ubuntu-lv` voor een **absolute 80 GiB LV**, alleen bij bewezen LV-naam en voldoende vrije extents.
Voor een bruto disk van 80 GB moet een kleinere passende LV-doelmaat worden berekend. Gebruik niet blind `+20G` of `+100%FREE`.
Voor ext4 gebruikt men `resize2fs`; voor XFS `xfs_growfs /`. `--resizefs` automatiseert alleen ondersteunde combinaties.
Controleer na iedere stap `lsblk`, `pvs`, `vgs`, `lvs` en `df -hT /`.
Bronnen: [Ubuntu LVM](https://ubuntu.com/server/docs/how-to/storage/manage-logical-volumes/), [pvresize](https://manpages.ubuntu.com/manpages/noble/man8/pvresize.8.html), [lvextend](https://manpages.ubuntu.com/manpages/noble/man8/lvextend.8.html).

## Stap 3: herstel en back-up vóór retentie

Bij voldoende vrije ruimte eerst ANPR-PostgreSQL-log en healthstatus controleren en herstel laten afronden.
Als de container gestopt blijft, leg een gerichte start/herstart voor aan de gebruiker.
Controleer daarna API-health en echte login met de gebruiker.
Geen `docker compose down -v`, database-reset, handmatige verwijdering van PostgreSQL-/WAL-bestanden of willekeurige volumeverwijdering.
Retentie is geen reddingsmiddel bij nul vrije databaseopslag: DELETE en het verwijderjournal hebben zelf WAL-/schijfruimte nodig.

Vóór gegevensverwijdering: na toestemming ANPR-schrijvers in een onderhoudsvenster stoppen; PostgreSQL custom-format dump, bijbehorende ANPR-beelden, configuratie en bestaande images op andere opslag veiligstellen.
Bewaar `.env` uitsluitend versleuteld/toegangsbeperkt, nooit in Git/chat.
Controleer dump met `pg_restore --list`, back-upchecksums én een echte restore in een geïsoleerde database met beeldreferentiesteekproef.
Een losse kopie van draaiende PostgreSQL-bestanden is geen consistente databaseback-up.

## Retentieontwerp

De taak draait in `anpr-worker`, elke vijf minuten, zonder overlap binnen één worker. Maximaal 10 batches van 25 passages per run.
FIFO: oudste timestamp, dan id. Configuratie staat in `.env.example` en wordt gevalideerd.

- Standaard: `RETENTION_ENABLED=false`, `RETENTION_DRY_RUN=true`, 90 dagen.
- Leeftijd: `RETENTION_DAYS` (1–365); drukbeleid afzonderlijk opt-in met `RETENTION_PRESSURE_ENABLED=true`.
- Buffer: start onder `RETENTION_MIN_FREE_GIB=10`, doel `RETENTION_TARGET_FREE_GIB=15`. Drukmodus blijft binnen de worker actief tussen begrensde runs tot het doel gehaald is; na procesherstart geldt de startgrens opnieuw.
- `statfs.bavail` meet het filesystem van `STORAGE_PATH`. Controleer dat database en beelden dezelfde schijf delen; een aparte volle databasedisk valt buiten deze meting.
- Beschermd: `isHit`, echte Hit-referenties en iedere geregistreerde `RetentionException`, ook ogenschijnlijk verlopen uitzonderingen.
- Geen ongecontroleerde scan van verweesde bestanden of andere opslagmappen. Bij onvoldoende vrij te maken ruimte volgt een logmelding; beschermde gegevens worden behouden.

Een korte Read Committed-transactie vergrendelt Camera, Passage, Hit, PlateDetection, RetentionException en RetentionImageDeletion met `NOWAIT`.
De taak wijkt voor lopende schrijfacties. Selectie, unieke beeldsleutels in het journal en passageverwijdering (met cascades van afgeleide gegevens) worden samen gecommit.
Bij rollback blijven passage en bestanden behouden. Bestandverwijdering begint pas na commit.

De migratie plaatst triggers op alle huidige beeldreferenties van Passage, PlateDetection, Hit en Camera.
Nieuwe referenties naar een ingeplande sleutel worden geweigerd; ongewijzigde bestaande verwijzingen blijven toegestaan.
Dit voorkomt nieuwe verwijzingen tussen de referentiecontrole en bestandverwijdering.
Gedeelde beelden blijven in de wachtrij tot alle bestaande referenties weg zijn.
Afgeronde journalregels blijven als tombstone bestaan; verwijder die niet. Bij nieuwe referentiekolommen moeten triggers en controles samen worden bijgewerkt.

Alleen `passages/YYYY/MM/UUID.jpg` wordt verwijderd. Traversal, symlinks/junctions, afwijkende namen en niet-reguliere bestanden worden geweigerd.
Mappen moeten door OS-rechten tegen onbevoegde schrijvers beschermd zijn; padcontrole vervangt geen bescherming tegen kwaadwillende gelijktijdige bestandswissels.
Ontbrekende bestanden zijn idempotent succes. Fouten blijven in de wachtrij voor een volgende run.
Logs bevatten aantallen, vrije bytes en foutcategorieën; geen kentekens, beelden of credentials.

## Verificatie en uitrol

Uitgevoerd op 28 oktober 2026: 139 unit-tests geslaagd; afzonderlijke PostgreSQL 16.14-integratietest geslaagd op een nieuwe lokale database (alle 15 migraties succesvol).
De integratietest controleert echte hits, bewaarexcepties, gedeelde beelden, rollback, bestandsfout/herstart, verbod op nieuwe referenties en wijken voor een gelijktijdige schrijver.
Prisma-schema, worker-TypeScript, worker-lint, shared/worker-build, Compose-configuratie met voorbeeldwaarden en `git diff --check` slagen.
Docker-imagebuild en productie-overlay zijn niet getest: er draait hier geen Docker-daemon en de overlay staat uitsluitend op productie.
Er is geen productieback-up, restoreproef op productiegegevens, uitrol, capaciteitsuitbreiding of loginherstel uitgevoerd.

```bash
npm run db:generate
npm run build -w @anpr/shared
npm run typecheck -w @anpr/anpr-worker
npm run lint -w @anpr/anpr-worker
npx vitest run apps/anpr-worker/src/retention.test.ts packages/shared/src/index.test.ts
```

De integratietest vereist een nieuwe lokale database `anpr_retention_test_...`, alle migraties toegepast en `RETENTION_TEST_DATABASE_URL` ingesteld. Zij weigert andere hosts/databasenamen en gebruikt synthetische gegevens:

```bash
npx vitest run apps/anpr-worker/src/retention.integration.test.ts
```

Voor productie: review, bewezen back-up/restore, exact deploymentcommit en rollbackimages vastleggen, onderhoud bespreken en toestemming vragen.
Bouw API/worker-images met de nieuwe shared library. Controleer bestaande productie-overlay en volumemounts; vervang de overlay niet.
Voer de migratie uit met de bestaande ANPR-migratiedienst.
Rol code en migratie eerst uit met `RETENTION_ENABLED=false`, `RETENTION_DRY_RUN=true`
en `RETENTION_PRESSURE_ENABLED=false`. Controleer ingest, health en de toegepaste migratie.
Beoordeel daarna een afzonderlijke proefrun met `RETENTION_ENABLED=true`,
`RETENTION_DRY_RUN=true`; vergelijk met onafhankelijk getelde kandidaten.
Proefmodus toont een begrensde steekproef en verwijdert niets; zij schat geen totale terugwinbare bytes.
Vraag toestemming voor `RETENTION_DRY_RUN=false` na controle van beschermde/gedeelde beelden, filesystem en duur.
Vraag afzonderlijke instemming voor drukretentie: daarmee kunnen passages jonger dan 90 dagen verdwijnen.
Controleer daarna ingest, databasewachttijden, vrije ruimte en login.

Bij problemen eerst retentie uitschakelen en worker gericht herstarten; behoud migratie en tombstones.
Code-rollback herstelt geen verwijderde gegevens: daarvoor is een gecoördineerde database-/mediarestore nodig.
Gewone DELETE maakt PostgreSQL-ruimte vooral intern herbruikbaar, niet direct als vrije filesystemruimte. Geen `VACUUM FULL` op een bijna volle productieschijf.

## Lokale importcontrole — 5 november 2026

De bestaande patch `anpr-retention-20261028.patch` is geïmporteerd op branch `main`,
basiscommit `b12e98c`, met een vooraf schone werkboom. `git apply --check` slaagde;
na toepassing bevestigde `git apply --reverse --check` dat de volledige patch aanwezig
was, vóór toevoeging van deze verificatienotitie. Er is geen implementatie herschreven.

Opnieuw gecontroleerd in deze WSL-omgeving:

- Volledige `npm test`: **582 tests geslaagd, 5 integratietests overgeslagen**.
  De worker telt 64 geslaagde tests, inclusief 11 FIFO-unittests; de FIFO-integratietest
  is één van de overgeslagen tests. De overige vier horen bij ITSAPI-diagnostiek.
- TypeScript-controles voor alle workspaces en `npm run lint` geslaagd.
- Prisma Client gegenereerd en Prisma-schema gevalideerd, zonder databaseverbinding.
- Shared-build geslaagd. De gewone worker-build faalde met `EACCES` op de bestaande
  `apps/anpr-worker/dist`-bestanden. Dezelfde build slaagde met een aparte uitvoermap:
  `npm run build -w @anpr/anpr-worker -- --outDir /home/edwin/projects/anpr-platform/node_modules/.cache/retention-import/worker-dist`.
  Bestaande bestandsrechten zijn niet gewijzigd.
- Compose-YAML, gedeelde environment-anchor en veilige retentiedefaults zijn statisch
  gecontroleerd. `docker compose config` en een Docker-imagebuild zijn niet uitgevoerd
  met een werkende Docker-installatie: de beschikbare Docker-wrapper meldt dat
  Docker Desktop-WSL-integratie ontbreekt.
- `git diff --check` geslaagd.

De FIFO-database-integratietest en de nieuwe migratie zijn hier **nog niet uitgevoerd**:
PostgreSQL-servertools ontbreken en Docker is niet beschikbaar in deze WSL-distributie.
Herhaal die controle uitsluitend met een nieuw aangemaakte, aparte lokale database
`anpr_retention_test_...` en alle migraties toegepast. De uitslag van 28 oktober
hierboven is historische documentatie, geen nieuwe databaseverificatie.

`RETENTION_ENABLED=false`, `RETENTION_DRY_RUN=true` en
`RETENTION_PRESSURE_ENABLED=false` blijven de defaults in schema, `.env.example`
en Compose. In de lokale `.env` en shell zijn deze vlaggen niet ingesteld.
Geen worker gestart, geen bestaande applicatiedatabase gewijzigd, geen productieactie
of deployment uitgevoerd. De wijzigingen zijn lokaal en niet gecommit.

## Aanvullende FIFO-verificatie met Docker — 5 november 2026

Deze controle sluit de hierboven vermelde lokale verificatieblokkades af.
Docker-client en -server 29.9.2 zijn bereikbaar via de lokale Unix-socket;
de server identificeert zich als Docker Desktop. Er is geen productiecontext gebruikt.

### Database en bestanden

Een nieuwe `postgres:16-alpine`-container draaide PostgreSQL **16.15** met een unieke
database `anpr_retention_test_...`, uitsluitend bereikbaar op een willekeurige
`127.0.0.1`-poort. PostgreSQL-data stond op tmpfs, zonder bestaande volumes of
applicatiemappen te koppelen. De database bevatte uitsluitend synthetische fixtures.
Alle **15 migraties**, inclusief `20261028000100_passage_retention`, zijn succesvol
toegepast en als voltooid gecontroleerd in `_prisma_migrations`.

De volledige worker-testsuite slaagde: **66 tests**, inclusief **2 uitgevoerde
PostgreSQL-integratietests**, zonder overgeslagen worker-tests. De bestaande
integratietest is aangevuld met een afzonderlijke FIFO-/fototest. Bewezen gedrag:

- Uitgeschakelde retentie en proefmodus behouden passages, foto's en journalstatus.
- Bij één passage per batch verdwijnt eerst de oudste timestamp; gelijke timestamps
  worden op ID gesorteerd, onafhankelijk van de invoegvolgorde.
- Overzichtsfoto, kentekenfoto, tweede voertuigfoto en een afzonderlijk
  `PlateDetection.frameObjectId` worden samen ingepland. Detectierijen verdwijnen
  via de cascade; de begrensde bestandsbatches ronden alle fotoverwijderingen af.
  Foto's van de nog niet geselecteerde passages blijven bestaan.
- Jonge passages, `isHit`, werkelijke Hit-referenties en bewaarexcepties blijven
  behouden, inclusief hun beschermde foto's.
- Gedeelde foto's blijven bestaan zolang een overlevende passage ernaar verwijst.
- Een rollback behoudt passage en foto en commit geen verwijderjournalregel.
- Na een gesimuleerde bestandsfout blijft de journaltaak onafgerond; een andere
  service-instance hervat de taak en rondt de bestandsverwijdering af.
- Triggers weigeren nieuwe referenties naar ingeplande en afgeronde sleutels.
- Een onafhankelijke schrijver met een tabelvergrendeling laat retentie wijken.

Na afloop is uitsluitend de aangemaakte testcontainer gestopt en automatisch
verwijderd. De tmpfs-database en tijdelijke verbindingsgegevens zijn opgeruimd.
Geen bestaande applicatiedatabase of productiegegevens zijn gebruikt.

### Compose, images en buildrechten

Volledige Compose-validatie is geslaagd voor zowel de basisconfiguratie als de
combinatie met `docker-compose.external.yml`, met voorbeeldwaarden én de lokale
`.env`. Alleen `config` is uitgevoerd; geen Compose-diensten zijn gestart.
De servergebonden `docker-compose.prod.yml` is hier niet beschikbaar en is niet
gevalideerd. Opgeloste lokale worker-instellingen zijn expliciet gecontroleerd:
`RETENTION_ENABLED=false`, `RETENTION_DRY_RUN=true`,
`RETENTION_PRESSURE_ENABLED=false`.

De Dockerfiles zijn tot en met target `production` succesvol gebouwd onder
afzonderlijke lokale verificatietags:

- `anpr-retention-verification-api:local`
- `anpr-retention-verification-worker:local`
- `anpr-retention-verification-video-worker:local`

Aanvullende containercontroles zonder netwerk bevestigen dat de worker-retentiemodule
laadt, de veilige defaults gebruikt en uitgeschakeld geen database-/bestandswerk doet.
De API-image bevat de 90-dagendefault en het gegenereerde Prisma-model
`RetentionImageDeletion`. Beide gecontroleerde images draaien als UID 1000.
Deze importcontroles vervangen geen volledige ingest-/loginacceptatietest.

De normale lokale worker-build faalde doordat de gegenereerde map
`apps/anpr-worker/dist` en de bestaande bestanden eigenaar `root:root` hadden,
met respectievelijk rechten 0755 en 0644. De bronmap is van `edwin:edwin`.
Welke historische opdracht de root-bestanden heeft gemaakt, is niet vastgesteld.
Alleen het eigendom van deze buildmap is via een tijdelijke container met uitsluitend
die map gekoppeld hersteld naar UID/GID 1000:1000, zonder symlinks te volgen.
Geen brede `chmod` of eigendomswijziging van broncode, dependencies of opslag uitgevoerd.
Daarna slaagde **de normale** `npm run build -w @anpr/anpr-worker`, inclusief
`dist/retention.js`, zonder alternatieve uitvoermap. Voer lokale npm-builds als de
projectgebruiker uit; voorkom root-builds op een schrijfbare host-bindmount.

Worker-TypeScript, worker-lint en `git diff --check` slagen na de testuitbreiding.
Er zijn geen retentieproductie-instellingen veranderd, geen applicatieworkers gestart,
geen images gepusht en geen deployment uitgevoerd. Productie-overlay, back-up/restore
en ingest-/loginacceptatie blijven controles vóór een eventuele latere uitrol.

## Productievoorbereiding na lokale commit

Doelserver: `anpradmin@anpr-prod`, project `/opt/anpr`. Gebruik steeds het bestaande
`docker-compose.prod.yml` naast `docker-compose.yml`, nooit de lokale external-overlay.
Er is nog geen push of productieactie toegestaan. De eerste servercontrole bestaat
uitsluitend uit uitlezen. Voer geen `cat .env`, volledige `docker inspect`, volledige
Compose-configuratie of back-upscriptinhoud uit; die kunnen geheimen tonen.

Na aanmelden zijn dit de eerste commando's:

```bash
hostname
test "$(hostname -s)" = anpr-prod || exit 1
cd /opt/anpr || exit 1
git status --short --branch
git rev-parse HEAD
test -f docker-compose.prod.yml || exit 1
sha256sum docker-compose.prod.yml
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -a
docker compose -f docker-compose.yml -f docker-compose.prod.yml images
df -hT / /opt/anpr
df -i / /opt/anpr
findmnt -o TARGET,SOURCE,FSTYPE,AVAIL
systemctl list-timers --all --no-pager
systemctl list-unit-files --type=service --type=timer --no-legend |
  awk 'tolower($1) ~ /(anpr|backup|restic|borg)/ { print $1, $2 }'
sudo find /etc/cron.d /etc/cron.daily /etc/cron.weekly /etc/cron.monthly \
  -maxdepth 1 -type f -printf '%p\n'
sudo crontab -l 2>/dev/null |
  awk '!/^[[:space:]]*#/ && /anpr|pg_dump|pg_basebackup|restic|borg|backup/ { print "root-crontab: mogelijke back-uptaak (opdracht verborgen)" }'
if test -d /opt/anpr/data/backups; then
  sudo find /opt/anpr/data/backups -maxdepth 2 -type f \
    -printf '%TY-%Tm-%Td %TH:%TM %s bytes %p\n'
fi
```

Dit inventariseert alleen mogelijke back-upvoorzieningen; een timer of bestand bewijst
geen geslaagde, herstelbare back-up. Controleer vervolgens veilig de vastgestelde
ANPR-back-uptaak: laatste resultaat, externe bestemming, vrije ruimte daar, database
én media, configuratie en herstelbewijs. Concrete back-upcommando's volgen pas als de
werkelijke voorziening/bestemming bekend is. Gebruik niet de volle rootpartitie.
Stop vóór uitrol bij een vuile bronwerkboom, falende health/configuratie, onvoldoende
ruimte, onduidelijke volume-/imageconfiguratie of ontbrekend back-up-/rollbackbewijs.

Vervolg uitsluitend na beoordeling en afzonderlijke toestemming voor productie:

1. Publiceer de exacte lokale commit; haal op de server uitsluitend die commit op
   en update met `git merge --ff-only`, gevolgd door verificatie van de volledige hash.
   Geen reset, overschrijving van lokale wijzigingen of vervangen van de productie-overlay.
2. Leg de oude commit, overlay-checksum en image-ID's vast; bewaar rollbacktags en een
   bewezen back-up op geschikte andere opslag. Controleer alle diensten die de shared
   library gebruiken. Inspecteer de effectieve Compose-configuratie via een filter op
   servicenaam, buildtarget, command, mounts en uitsluitend de `RETENTION_*`-vlaggen.
   Deel geen andere environmentwaarden.
3. Borg voor de ANPR-worker expliciet `RETENTION_ENABLED=false`,
   `RETENTION_DRY_RUN=true`, `RETENTION_PRESSURE_ENABLED=false`, ook wanneer de
   serveroverlay een eigen environmentmapping heeft. Behoud alle bestaande secrets,
   UID's en mounts. Valideer daarna opnieuw met `config --quiet`.
4. Bouw API, ANPR-worker en video-worker volgens de beoordeelde productie-overlay;
   bouw de `migrate`-service ook expliciet zodat geen oude migratie-image wordt gebruikt.
   Bouw vóór het onderhoudsvenster, zonder een dienst te starten.
5. Gebruik een onderhoudsvenster: stop uitsluitend de bevestigde ANPR-schrijvers,
   laat PostgreSQL/Redis en hun volumes staan, maak de afgesproken consistente back-up
   en voer `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --no-deps migrate` uit.
   Bij een fout niet verder starten of migraties met `resolve` maskeren.
6. Controleer migratiestatus en nieuwe journal/triggers. Start de nieuwe API/worker-images
   met `up -d --no-deps --wait` voor uitsluitend de beoordeelde services; controleer
   health, normale ingest, login en bestaande foto's. De worker blijft uitgeschakeld
   voor retentie. De wijziging naar 90 dagen geldt wel voor nieuw aangemaakte passages.
7. Voer na acceptatie een eenmalige preview uit vanuit de nieuwe worker-image met
   expliciet `RETENTION_ENABLED=true`, `RETENTION_DRY_RUN=true` en
   `RETENTION_PRESSURE_ENABLED=false`, zonder de automatische workerinstellingen te
   veranderen. Roep alleen `RetentionService.run()` aan, niet de worker-entrypoint.
   Gebruik `node --input-type=module` met import uit
   `./apps/anpr-worker/dist/retention.js` en de Prisma-client; sluit de client in
   `finally` af. Dit vereist vooraf bevestigde production-buildtarget en opslagmount.
   Vergelijk het gemelde aantal met een onafhankelijk getelde, maximaal 25 oudste
   kandidaten zonder hit of bewaarexceptie. De preview is een steekproef, geen totaal.
8. Controleer dat het journal voor en na de preview identieke aantallen heeft en geen
   bestandsverwijdering is aangeroepen. Er komt in deze releasefase geen commando met
   `RETENTION_DRY_RUN=false`. Actieve verwijdering en drukretentie vereisen latere,
   afzonderlijke beoordeling en toestemming.

Bij rollback blijven de additieve migratie, triggers en eventuele tombstones bestaan.
Gebruik de vastgelegde oude images en de bevestigde oude commit; behoud de veilige
retentievlaggen. Een automatische code-rollback herstelt geen verwijderde data.
