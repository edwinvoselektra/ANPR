# ITSAPI-identificatie achter WireGuard/NAT

## Onderzoek en oorzaak

Bij de opgegeven route ziet de receiver TCP-bron `10.99.0.11` (ER605), terwijl `Camera.rtspHost` op `10.20.10.201` staat. De server `10.99.0.1:7070` is het doeladres, nooit het verwachte bronadres.

De concrete oude afwijzing staat in `apps/api/src/itsapi-receiver.ts`, hook `preValidation`, in de tak **zonder Authorization-header**: na de DeviceID-lookup vergelijkt `registration.camera.rtspHost !== sourceIp` beide adressen. Dit geeft `403 {"error":"SOURCE_IP_MISMATCH"}`. De parser en PassageService zijn dan nog niet aangeroepen. Dezelfde aanname stond in `identityFor` en in de transactionele `accept`-filter. Alleen de eerste controle wijzigen zou dus onvoldoende zijn.

Andere bestaande 403-paden zijn `DEVICE_ID_UNKNOWN` (geen unieke toegestane registratie), `DEVICE_ID_MISMATCH` (Digest-account en payload horen niet bij dezelfde camera) en `REGISTRATION_REVOKED` (ingetrokken of gewijzigde configuratie). De productie-responsebody is niet aangeleverd; de bron-IP-afwijzing is in deze checkout gereproduceerd, niet op productie uitgelezen.

KeepAlive en TollgateInfo delen dezelfde hooks. In de oude code controleert de Digest-tak de bron niet, terwijl de tak zonder Digest dat wel doet. Een KeepAlive mét geldige Digest kan daarom 200 krijgen waar een TollgateInfo zonder Digest op bron-IP 403 krijgt (wanneer de registratie voor die verzoeken zonder Digest staat ingesteld). Met onveranderde `authenticationEnabled=true` geeft een verzoek zonder Digest echter 401, geen bron-IP-403. Een wijziging in authenticatie/configuratie, verschillend bronadres of verschillende release/processen moet daarom mee worden onderzocht. De waarneming alleen bewijst geen specifieke verklaring. Een KeepAlive-200 bewijst ook geen succesvolle TollgateInfo-parser of passageopslag. Verlopen/inactieve registraties en conceptcamera's hebben daarnaast verschillende heartbeat-/passagevoorwaarden.

## Gekozen beleid en wijzigingen

- `ItsapiRegistration.expectedDeviceId` krijgt een PostgreSQL unique index, ook voor registraties van gearchiveerde camera's. Meerdere NULL-waarden blijven mogelijk voor nog niet ingestelde registraties. Een bestaande dubbele DeviceID laat de migratie stoppen; er wordt niets stilzwijgend ontkoppeld.
- Nieuwe optionele `ItsapiRegistration.expectedSourceIp`: exact IP-adres van een expliciet vertrouwde VPN-peer/gateway, per camera. Geen subnet, hostname, proxyheader of automatisch vertrouwen van een locatie.
- Zonder Digest: DeviceID uit het bevestigde pad (`DeviceID` voor KeepAlive, `Picture.SnapInfo.DeviceID` voor TollgateInfo) → unieke registratie met toegestane ITSAPI-camera → bron moet overeenkomen met `expectedSourceIp`, of bij NULL met het bestaande vaste `rtspHost`.
- Met Digest: uploadaccount en Digest/replaycontrole blijven bestaan; payload-DeviceID moet vervolgens bij diezelfde registratie horen. Een expliciet `expectedSourceIp` wordt ook hier afgedwongen. Zonder expliciete peer blijft bestaand Digest-beleid behouden; dat vertrouwde op Digest en DeviceID, zonder bron-IP-binding.
- `trustProxy:false` blijft ingesteld. `X-Forwarded-For` verleent geen toegang. IPv4-mapped socketadressen worden zoals voorheen naar IPv4 vertaald.
- Dezelfde bronpolicy geldt in de gedeelde hook, hercontrole en acceptatie binnen de opslagtransactie. Configuratiewijzigingen via de beheer-API verhogen `configVersion`, zodat reeds lopende uploads niet alsnog onder oude instellingen worden bevestigd.
- De bestaande admin-beveiligde `PUT /cameras/:id/itsapi` valideert het veld als exact IP. Een dubbele DeviceID geeft 409 zonder databasedetails. De Nederlandse ITSAPI-configuratiekaart toont het nieuwe veld.
- TollgateInfo blijft de bestaande parser en PassageService gebruiken. ACK 200 volgt pas na succesvolle verwerking/commit. Afbeeldingen blijven buiten PostgreSQL; watchlist-, hit- en achtergrondtaken blijven onderdeel van de bestaande passageketen.

Een peeradres bindt meerdere camera's achter dezelfde router niet cryptografisch aan hun DeviceID. Gebruik de bestaande Digest-optie waar de firmware dit ondersteunt; de verandering schakelt Digest nergens automatisch uit.

## Instellingen voor deze locatie (na een afzonderlijk goedgekeurde uitrol)

Open als admin de ITSAPI-configuratie van de bestaande camera:

| Veld | Waarde |
| --- | --- |
| Camera-IP / RTSP-host | `10.20.10.201` (behouden) |
| Device ID | Exact de bestaande Dahua DeviceID van deze camera |
| Verwacht bron-IP / vertrouwde VPN-peer | `10.99.0.11` |
| Ontvangstadres | `http://10.99.0.1:7070` |
| Protocol | `V1.19` |
| Digest | Overeenkomend met de fysieke camera, bestaande instelling behouden |

De server-IP is geen peer-IP. Er is geen productieconfiguratie gewijzigd en geen deployment uitgevoerd.

## Lokaal controleren

Alle opdrachten vanuit de projectroot. De runner-optie voorkomt de lokaal aangetroffen niet-schrijfbare Vite-configcache.

```bash
cd /home/edwin/projects/anpr-platform
npm run db:generate
DATABASE_URL=postgresql://validate:validate@127.0.0.1:5432/validate npm run db:validate
npm run typecheck
npm run lint
npm run test -w @anpr/api -- --configLoader runner
npm run build -w @anpr/api
npm run build -w @anpr/web
```

De tests bestrijken direct camera-IP, beide endpoints via VPN-peer, verkeerde/onbekende en ambigue DeviceID, onbekende bron ondanks vervalste proxyheader, expliciete peer met Digest, gewijzigde peer tijdens verwerking, unieke configuratie en ongeldige bronconfiguratie.

Voor echte PostgreSQL-constraints, migraties, opslag en passageketen: start Docker Desktop eerst. Gebruik `docker.exe` in deze WSL-installatie als `docker` ontbreekt. Deze tijdelijke container gebruikt uitsluitend synthetische data en een aparte database; geen productie-.env inladen.

```bash
cd /home/edwin/projects/anpr-platform
docker.exe run --rm --detach --name anpr-itsapi-vpn-test --publish 127.0.0.1:55439:5432 --env POSTGRES_DB=anpr_native_test --env POSTGRES_USER=itsapi_test --env POSTGRES_PASSWORD=synthetic_local_test postgres:16-alpine
docker.exe exec anpr-itsapi-vpn-test pg_isready -U itsapi_test -d anpr_native_test
```

Voer `pg_isready` opnieuw uit als PostgreSQL nog opstart. Pas bij status "accepting connections":

```bash
(
  export DATABASE_URL=postgresql://itsapi_test:synthetic_local_test@127.0.0.1:55439/anpr_native_test
  export CAMERA_CREDENTIALS_KEY=0000000000000000000000000000000000000000000000000000000000000000
  export REDIS_URL=redis://127.0.0.1:6379
  export WEB_ORIGIN=http://localhost:3000
  npm run db:migrate && npx tsx scripts/itsapi-processing-smoke.mts && npx tsx scripts/itsapi-smoke.mts
)
docker.exe stop anpr-itsapi-vpn-test
```

De uitgebreide processing-smoke test echte PostgreSQL-unique afwijzing/rollback, beide VPN-endpoints, verkeerde DeviceID, onbekende bron en een extra opgeslagen passage met beeldkoppelingen. De socketbron wordt synthetisch geïnjecteerd; dit bewijst niet de fysieke WireGuard-route.

## Productie: uitsluitend voorbereiding en later acceptatietesten

Stop vóór deployment. De eerder geblokkeerde lokale PostgreSQL-smokes, migraties, Docker-builds en Compose-controles zijn op 21 oktober 2026 alsnog geslaagd. Zie [actuele resultaten en isolatiebewijs](itsapi-source-ip-interface.md#uitgevoerde-controles-bij-deze-correctie). Een fysieke productiecontrole blijft na een afzonderlijke uitrol nodig.

Controleer vóór een latere migratie alleen-lezen of bestaande DeviceID's dubbel zijn, zonder de identifiers in terminaluitvoer te zetten:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c '\''SELECT count(*) AS duplicate_device_id_groups FROM (SELECT "expectedDeviceId" FROM "ItsapiRegistration" WHERE "expectedDeviceId" IS NOT NULL GROUP BY "expectedDeviceId" HAVING count(*) > 1) AS duplicates;'\'''
docker compose -f docker-compose.yml -f docker-compose.external.yml config --quiet
```

Bij een niet-nul telling eerst de echte camera-identiteiten via beheer controleren en corrigeren. Geen DeviceID's verzinnen of registraties automatisch verwijderen. Maak volgens bestaand beheerproces een databasebackup voor een later goedgekeurde migratie. Dit document autoriseert geen uitrol.

Na die afzonderlijke uitrol en expliciete instelling van `10.99.0.11`:

1. Laat de fysieke camera een nieuwe KeepAlive en vervolgens één echte passage versturen. Controleer 200 voor beide en actuele heartbeat-/passagediagnose voor dezelfde configuratieversie.
2. Controleer via de webinterface de nieuwe passage bij de juiste camera, ontvangsttijd, beelden en eventuele testhit. Een retry hoort geen extra passage/hit op te leveren.
3. Gebruik alleen op een aparte testregistratie synthetische uploads voor negatieve tests; geen verzonnen passages op de echte productiecamera plaatsen. Verkeerde DeviceID vanaf `10.99.0.11` moet 403 geven; juiste DeviceID vanaf een ander socketadres ook. Een proxyheader wisselen simuleert geen TCP-bronadres.
4. Controleer tevens een bestaande directe camera met leeg verwacht-bronveld: correct camera-IP blijft werken, ander bron-IP zonder Digest blijft 403.

Bekijk zonder payloadcapture de receiverresponsen:

```bash
docker compose -f docker-compose.yml -f docker-compose.external.yml logs --since 5m api
```

Leg bij resterende fouten pad, tijdstip, HTTP-status en de vaste errorcode uit de response vast. Log geen Authorization-header, payload, kentekenbeelden of camerawachtwoorden. Bij blijvend afwijkend KeepAlive/TollgateInfo-gedrag moet worden vastgesteld welke authenticatie-instelling en release/processen op die tijdstippen actief waren.

## Uitgevoerde verificatie in deze checkout

- Volledige API-testset: 277/277 geslaagd (met lokale testsockets toegestaan). Na de laatste compatibiliteitsaanpassing voor oudere beheerclients: 89/89 gerichte ITSAPI-tests geslaagd.
- Workspace-TypeScript en lint geslaagd; Prisma-client gegenereerd en schema gevalideerd.
- API-build en Next.js-productiebuild geslaagd; `git diff --check` zonder fouten.
- Aanvullend op 21 oktober 2026: alle 14 migraties, drie PostgreSQL-integratiescripts, beide Docker-productiebuilds en runtimecontroles, en beide Compose-configuraties geslaagd. Volledige workspace-suite: 537/537 tests geslaagd. Uitsluitend een nieuwe lokale testdatabase gebruikt; zie het [actuele verslag](itsapi-source-ip-interface.md#uitgevoerde-controles-bij-deze-correctie). Fysieke camera-/WireGuard-productiecontrole niet uitgevoerd.
