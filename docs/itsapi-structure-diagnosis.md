# Tijdelijke ITSAPI-structuurdiagnose en gecontroleerde uitrol

## Afbakening en onderzoeksresultaat

Deze wijziging maakt de bestaande ITSAPI-diagnose bruikbaar vanuit **Camera’s → Staverhul → Cameradiagnose**. De prioriteit is aantonen welk veld het actuele `UNSUPPORTED_TOLLGATE_PAYLOAD` veroorzaakt. Automatische camerabewaking, technische pushvoorkeuren en hun extra tabellen zitten niet in deze release. De eerdere voorbereiding is inclusief bronbestanden, patch en SHA-256-manifest lokaal bewaard in de Git-genegeerde map `data/deferred-camera-health-before-diagnostics` voor de vervolgfase.

De aangeleverde productieveldtypen komen overeen met het bestaande Picture-profiel. Een synthetisch bericht met deze veldnamen/typen en geldige inhoud wordt geaccepteerd. Dat bewijst niet dat de gedeeltelijke logstructuur de nieuwste afwijzing volledig beschrijft. De concrete Staverhul-oorzaak staat nog open; er is geen nieuw formaat automatisch geaccepteerd.

`UNSUPPORTED_TOLLGATE_PAYLOAD` betekent dat Zod de schemavalidatie afwijst. Bijvoorbeeld:

- Picture, Plate en SnapInfo moeten objecten zijn, geen null of arrays.
- PlateNumber is na trim 2–64 tekens; alleen het type string bewijst dat niet.
- IsExist mag ontbreken, maar moet indien aanwezig boolean zijn; null wordt afgewezen.
- DeviceID is 1–128 tekens zonder ASCII-controletekens. De inhoud wordt niet weergegeven.
- NormalPic, CutoutPic en VehiclePic mogen ontbreken of null zijn. Indien aanwezig als object moet Content een string zijn. Een niet-getoond optioneel beeldveld kan dus de afwijzing verklaren.
- Veel ongeldige optionele metadata wordt al via de bestaande `.catch(undefined)` genegeerd. Een ongeldige Confidence of Channel alleen verklaart deze schemafout niet.
- De JPEG-/base64-inhoud, bruikbaarheid van tijd en genormaliseerd kenteken worden daarna gecontroleerd en hebben eigen foutcodes. Ook die controles geven nu veilige veldpaden in plaats van alleen een algemene code.

Het gemelde bericht van circa 889 KB overschrijdt de bestaande 16 MB-bodylimiet niet. De oude vaste `missing`-lijst was een lijst met verwachtingen, geen bewezen lijst ontbrekende velden. Deze is vervangen door concrete schemafouten. Acceptatieregels, Device-ID-/bron-IP-controle, Digest, deduplicatie en ACK na verwerking blijven behouden.

## Bediening na installatie

1. Log in als administrator en open **Camera’s → Staverhul → Diagnose**. Bovenaan staat de kop **Cameradiagnose — Staverhul**, met daaronder direct **ITSAPI-structuurdiagnose — Staverhul**. De bestaande ITSAPI-configuratie blijft beschikbaar verderop op dezelfde pagina.
2. Klik **Start structuurdiagnose (15 minuten)**. De pagina toont actief tot welk tijdstip en een afteller. Dit wijzigt uitsluitend de tijdelijke diagnoseperiode; geen camera-instelling, uploadcredential of configuratieversie.
3. Wacht op het volgende afgewezen bericht of de bestaande cameraretry. Het platform verstuurt geen verzonnen test- of camera-opdracht. De pagina controleert elke tien seconden en heeft daarnaast **Diagnose verversen**.
4. Bij een afwijzing zie je HTTP-status, foutcode en een tabel met exact veldpad, verwacht type, ontvangen type, Nederlandse uitleg, vaste validatiecode en eventuele vaste schema-minimum-/maximumgrens. De tabel staat direct zichtbaar, buiten Technische details. Op mobiel is de tabel horizontaal verschuifbaar.
5. Open desgewenst **Veilige structuurdetails en volledig rapport** en klik **Veilig rapport kopiëren**. Alleen veldtypen en geprojecteerde schemafouten worden teruggestuurd. Deel dit rapport om een gerichte correctie te maken; deel geen ruwe berichten.
6. Klik **Diagnose stoppen** zodra een bruikbaar bericht is vastgelegd. Zonder handeling stopt de capture na vijftien minuten. Eerdere resultaten blijven maximaal 24 uur beschikbaar.

Een synthetisch testvoorbeeld `Picture.Plate.IsExist — verwacht boolean — ontvangen null — invalid_type` bewijst dat de diagnose werkt, maar is geen vastgestelde fout van de echte Staverhul-camera. Een eerdere afwijzing blijft als historie herkenbaar met eerste/laatste ontvangsttijd. Een succesvolle heartbeat wist geen eerdere passagefout.

## Privacy en begrenzing

- GET `/cameras/:id/itsapi/diagnostic` en POST `/cameras/:id/itsapi/debug` vereisen administratorrechten. Operators krijgen 403; de interface vraagt de structuur niet voor hen op. De overige bestaande cameradiagnose blijft beschikbaar volgens bestaande camerarechten.
- De debug-POST ondersteunt `{enabled:true}` en `{enabled:false}`; lege body behoudt de bestaande startactie. Mutaties hebben bestaande origin/CSRF-controle, een beperkte rate limit en auditlogging.
- Capture wordt server-side alleen uitgevoerd als `debugUntil > now`. De browser toont een afteller gebaseerd op servertijd. Een oude datum in de database betekent geen actieve capture.
- Maximaal 32 inboxregels per camera, vijf recente regels in het rapport en maximaal 24 veldfouten per bericht. Resultaten behoren tot de huidige configuratieversie. De bewaartermijn blijft 24 uur vanaf de eerste ontvangst van de betreffende aggregatieregel.
- Identieke methode/pad/volledige JSON verhoogt dezelfde attempts-teller en vernieuwt de veilige evidence. Een al vastgelegde structuur en capturetijd blijven na stoppen/afloop bewaard bij retries van hetzelfde bericht, zonder de bewaartermijn te verlengen. Daarom werkt inschakelen ook bij een bericht dat al 174.000 keer is herhaald. Expired technische aggregaten worden vóór een nieuwe capture opgeruimd, zodat oude expiry geen nieuwe capture verbergt. Dit raakt geen passages of afbeeldingen.
- De server projecteert ook bestaande inboxgegevens opnieuw met een allowlist. Geen ontvangen scalarwaarden, Device ID-waarden, kentekens, image Content, credentials, tokens of onbewerkte Zod-issues worden teruggestuurd. De vroegere permanente payloadstructuurregels zijn uit normale receiverlogs verwijderd. De reeds bestaande tijdelijke diagnose van toegestane richtingwoorden blijft afzonderlijk bestaan en bevat geen kentekens of identifiers.
- Geen nieuwe databasetabellen of migratie. Geen wijzigingen aan bestaande gebruiker-/camera-/passage-/image-retentie of pushvoorkeuren.

## Lokale verificatie

```bash
cd /home/edwin/projects/anpr-platform
npm run db:generate
npm run typecheck
npm run lint
npm test
bash scripts/test-itsapi-diagnostics.sh
```

Het integratiescript maakt uitsluitend zijn eigen tijdelijke PostgreSQL 16-container met synthetische gegevens op 127.0.0.1:55440, past de veertien bestaande migraties toe en ruimt de container op. De fixture weigert iedere andere database-URL en ieder ander opslagpad. Bewijs van behoud vergelijkt records en afbeeldingsbytes vóór/na start, afwijzing, stoppen en retentie. Een anonieme of verkeerde bron/Device ID wordt niet geaccepteerd. Er worden geen echte pushmeldingen verstuurd.

Browsercontrole gebruikt lokaal Playwright in de genegeerde map `data/diagnostics-browser` en een standalone productiebuild, echte login en werkelijke API/database/receiver. Deze controle is uitgevoerd met `bash scripts/test-itsapi-diagnostics.sh --browser`. Screenshots staan lokaal onder `data/itsapi-diagnostics-browser-evidence`; zij tonen uitsluitend een synthetische Staverhul-testcamera. De echte productiecamera is niet benaderd.

Afgeronde controles op 23 oktober 2026:

| Controle | Resultaat |
| --- | --- |
| TypeScript en lint, alle workspaces | Geslaagd |
| Gewone testsuite | 571 tests geslaagd; vier opt-in integratietests afzonderlijk uitgevoerd |
| Echte PostgreSQL-integratietests | Vier geslaagd, inclusief behoud van records en afbeeldingsbytes en capture na herhaalde afwijzingen |
| Browser → API → receiver → PostgreSQL | Geslaagd: adminlogin, navigatie, start, echte synthetische HTTP 422, veldtabel, veilig kopiëren, stoppen, automatische afloop, operatorweigering, mobiel 390 px; geen browserfouten |
| Docker-build API en web | Beide geslaagd |
| Prisma-validatie en vergelijking schema/migraties met HEAD | Geldig; geen schema- of migratieverschillen |
| Lokale Compose-configuratie met `.env.example` | Geslaagd voor de aanwezige basis-/external-bestanden; de serveroverlay is uitsluitend op de server beschikbaar en wordt daar vóór de uitrol gecontroleerd |

De gewone testsuite gebruikt voor bestaande Dahua-tests een lokale HTTP-testserver. In een omgeving die luisteren op 127.0.0.1 blokkeert, is daarvoor lokale netwerktoegang nodig. Er worden geen echte camera’s benaderd.

## GitHub — zelf uitvoeren in lokale VS Code

De ontwikkelmap is `/home/edwin/projects/anpr-platform`, branch `main`, remote `origin` is `https://github.com/edwinvoselektra/ANPR.git`. Er is geen automatische commit of push uitgevoerd. De serveroverlay `docker-compose.prod.yml` is expliciet uitgesloten van Git én Docker-buildcontext.

```bash
cd /home/edwin/projects/anpr-platform
git status --short
git diff --check
git add .dockerignore .gitignore README.md apps/api apps/web packages/shared/src docs/itsapi-receiver.md docs/itsapi-structure-diagnosis.md scripts/itsapi-diagnostics-fixture.mts scripts/itsapi-diagnostics-browser.mts scripts/test-itsapi-diagnostics.sh
git diff --cached --stat
git diff --cached --check
git commit -m "Maak tijdelijke ITSAPI-structuurdiagnose zichtbaar in cameradiagnose"
git push origin main
```

Controleer vóór commit de getoonde bestandslijst. De lokale archiefmap, screenshots, browserdependencies, testafbeeldingen, logs, `.env` en productieoverlay worden niet meegestaged. Gebruik geen force-push.

## Productie — zelf stap voor stap uitvoeren

De bevestigde productieomgeving is `anpradmin@anpr-prod`, projectmap `/opt/anpr`, Compose-bestanden `docker-compose.yml` en **het daar bestaande, serverspecifieke `docker-compose.prod.yml`**. Het lokale `docker-compose.external.yml` wordt hier niet gebruikt. De overlay wordt niet vervangen of vanuit Git gekopieerd.

Voer de volgende stappen in dezelfde SSH-sessie uit, zodat de backup-/rollbackvariabelen beschikbaar blijven. `set -e` stopt de SSH-shell bij een mislukte opdracht; beoordeel de fout voordat je opnieuw aanmeldt of verdergaat.

### 1. Aanmelden en bestaande installatie controleren

```bash
ssh anpradmin@anpr-prod
```

Controleer dat de prompt bij `anpradmin@anpr-prod` hoort. Voer daarna op die server uit:

```bash
set -e
cd /opt/anpr
git status --short
test -f docker-compose.prod.yml
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Als `git status` wijzigingen aan tracked bronbestanden meldt: eerst beoordelen en niet overschrijven met reset/restore. `.env`, het serverspecifieke overlaybestand en bestaande media blijven behouden.

### 2. Databaseback-up en huidige images bewaren

```bash
umask 077
release_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_backup="data/backups/itsapi-diagnose-$release_stamp"
mkdir -p "$release_backup"
git rev-parse HEAD > "$release_backup/git-revision.txt"
sha256sum docker-compose.prod.yml > "$release_backup/compose-prod.sha256"
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$release_backup/database.dump"
test -s "$release_backup/database.dump"
prod_api_image="$(docker inspect --format '{{.Config.Image}}' "$(docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -q api)")"
prod_web_image="$(docker inspect --format '{{.Config.Image}}' "$(docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -q web)")"
rollback_api_image="anpr-platform-api:voor-itsapi-diagnose-$release_stamp"
rollback_web_image="anpr-platform-web:voor-itsapi-diagnose-$release_stamp"
docker image tag "$(docker inspect --format '{{.Image}}' "$(docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -q api)")" "$rollback_api_image"
docker image tag "$(docker inspect --format '{{.Image}}' "$(docker compose -f docker-compose.yml -f docker-compose.prod.yml ps -q web)")" "$rollback_web_image"
declare -p prod_api_image prod_web_image rollback_api_image rollback_web_image > "$release_backup/rollback-images.env"
printf '%s\n' "$release_backup" > data/backups/itsapi-diagnose-last.txt
```

Dit gebruikt de databasegebruiker uit de bestaande containerconfiguratie zonder een wachtwoord te tonen. De media worden niet gekopieerd, verwijderd of verplaatst; bestaande mediaback-ups blijven afzonderlijk. Images en bestaande volumegegevens worden niet gepruned.

### 3. Broncode ophalen en alleen API/web bouwen

```bash
git pull --ff-only origin main
sha256sum -c "$release_backup/compose-prod.sha256"
git diff --exit-code "$(cat "$release_backup/git-revision.txt")" HEAD -- packages/database/prisma/schema.prisma packages/database/prisma/migrations
docker compose -f docker-compose.yml -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml build api web
```

De checksum moet `OK` tonen. De schema-/migratiecontrole moet zonder verschil eindigen. Als er toch andere schemawijzigingen worden opgehaald, stop dan: die horen niet bij deze afgebakende release. Voor deze wijziging is geen `migrate`, `seed`, database-reset of opslagmigratie nodig.

### 4. Alleen de gebouwde API en web activeren

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --wait --wait-timeout 180 api web
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T api wget -qO- http://127.0.0.1:4000/health
sha256sum -c "$release_backup/compose-prod.sha256"
```

Wacht op gezonde API-/webstatus en controleer de normale loginpagina. PostgreSQL, Redis, video-worker en ANPR-worker worden met deze opdracht niet opnieuw aangemaakt. Gebruik geen `down -v`, `volume rm`, `migrate reset`, `seed`, `image prune` of opslagopschoning.

### 5. Actuele Staverhul-afwijzing vastleggen

Open de bestaande site als administrator, vernieuw de pagina en voer de zes UI-stappen bovenaan dit document uit. Controleer eerst een bestaande passagefoto en de aanwezigheid van de bestaande camera’s en gebruikers. Start daarna de tijdelijke opname, wacht op een echte afwijzing en kopieer het veilige rapport. Pas op basis daarvan een gerichte correctie toe; een synthetisch voorbeeld is geen productieoorzaak.

### Rollback van alleen API/web, indien nodig

De oorspronkelijke imagenamen en rollbacktags zijn ook in de backupmap bewaard. Na een afgebroken SSH-sessie kun je opnieuw aanmelden met `ssh anpradmin@anpr-prod`. Voer vervolgens op de server uit:

```bash
set -e
cd /opt/anpr
release_backup="$(cat data/backups/itsapi-diagnose-last.txt)"
test -f "$release_backup/rollback-images.env"
source "$release_backup/rollback-images.env"
docker image tag "$rollback_api_image" "$prod_api_image"
docker image tag "$rollback_web_image" "$prod_web_image"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --no-deps --wait --wait-timeout 180 api web
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

Bouw niet opnieuw vóór deze rollback. De rollback herstelt de eerdere images en laat database, media, secrets en serveroverlay intact. De broncheckout blijft op de nieuw opgehaalde commit staan; een volgende build gebruikt dus weer die nieuwe code. De databaseback-up wordt niet automatisch teruggezet.
