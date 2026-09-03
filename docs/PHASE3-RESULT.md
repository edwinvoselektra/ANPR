# Resultaat Fase 3 — kentekens, groepen, hits en analyse

Datum controle: 3 september 2026

## Wat daadwerkelijk werkt

- Nederlandse beheerpagina's voor kentekens en groepen.
- Kentekens worden centraal genormaliseerd en kunnen in meerdere groepen staan.
- Activeren, deactiveren, bewerken en daadwerkelijk uit actieve lijsten verwijderen.
- Geldig-vanaf/geldig-tot en verplichte reden voor signaleringsgroepen.
- Automatische hitdetectie voor simulatorpassages en Dahua-passages.
- Maximaal één Hit per opgeslagen passage, met alle gematchte groepen en redenen.
- Gepagineerde Hits-lijst en hitdetail met camera, bron, voertuigdata en foto's.
- Database-side, gepagineerd zoeken met combineerbare filters.
- Kentekendossier met samenvatting en gepagineerde waarnemingshistorie.
- Simulator met dynamische camerakeuze, kleur, type, richting en tijdstip.
- Dashboardcijfers, recente passages, recente hits en camerastoringen uit PostgreSQL.
- ADMIN/OPERATOR-beheer en server-side Viewer-blokkade via bestaande permissions.
- Auditregels voor kenteken- en groepsmutaties.

DEMO-passages en DEMO-hits blijven zichtbaar als demo gemarkeerd. Er wordt geen
gesimuleerde herkenning als echte camera-ANPR gepresenteerd.

## Architectuur en hit-detectieflow

```text
Dahua provider of simulator
  -> Passage-aanmaak na bestaande deduplicatie
  -> centraal genormaliseerd kenteken
  -> actieve en op dat tijdstip geldige groepslidmaatschappen
  -> alleen actieve groepen met hitEnabled=true
  -> maximaal één Hit + alle HitGroup-koppelingen
  -> Hits, Dashboard, Zoeken en Kentekendossier
```

De notificatiestatus wordt voorbereid als `SKIPPED`; deze fase verzendt geen push.
Afbeeldingen blijven via object-ID's in de bestaande storageprovider lopen en worden
niet als blobs in PostgreSQL opgeslagen.

## Databasewijzigingen

Normale, additieve migratie:

```text
20260903000100_plate_management_hits_search
20260903000200_fix_empty_plate_validity
```

Toegevoegd:

- `PlateGroup.hitEnabled`;
- `HitGroup` voor meerdere groepen per hit en historische reden;
- unieke index op `Hit.passageId`;
- functionele hoofdletterongevoelige unieke groepsnaamindex;
- indexes voor locatie/tijd, richting/tijd en actieve groepsleden.

De tweede migratie zet uitsluitend geldigheidsvelden die door de lege-datumvalidatiefout
exact als `1970-01-01 00:00:00` waren opgeslagen terug naar `NULL`. Eén registratie,
`V84KVJ`, was geraakt; kenteken, reden, status en groepskoppeling zijn behouden.

De bestaande primaire groep van bestaande hits is naar `HitGroup` gekopieerd. Vooraf
waren er geen dubbele Hit-records per passage. Er is geen reset, `db push`, volume-
verwijdering of andere destructieve databaseactie uitgevoerd.

## Nieuwe API-routes

- `GET/POST /plate-groups`
- `PATCH/DELETE /plate-groups/:id`
- `GET/POST /plates`
- `GET/PATCH/DELETE /plates/:normalized`
- `GET /hits`
- `GET /hits/:id`
- `GET /search/passages`

De bestaande `POST /simulator/passages` en `GET /dashboard` zijn uitgebreid. Mutaties
vereisen `plates.manage`; hits vereisen `hits.view`; lezen en zoeken vereisen de
bestaande leespermissions. Alle routes blijven achter veilige sessie-authenticatie.

## Nieuwe en gewijzigde pagina's

- `/groups` — groepen bekijken en bevoegd beheren;
- `/plates` — kentekens bekijken en bevoegd beheren;
- `/plates/:normalized` — dossier en historie;
- `/hits` en `/hits/:id` — lijst en detail;
- `/search` — combineerbare zoekfilters en paginering;
- `/simulator` — uitgebreide invoer;
- `/` — echt dashboard uit databasegegevens.

Het linkermenu activeert Hits, Zoeken, Kentekens en Groepen. Dashboard, Live passages,
Camera's, Gebruikers, Demo/simulator en Systeemstatus zijn behouden.

## Permissions en audit

- Administrator: kentekens/groepen beheren, hits bekijken en zoeken.
- Operator: dezelfde analyse- en watchlisttaken via `plates.manage`, zonder kritieke
  systeem- of gebruikersrechten.
- Viewer: bekijken en zoeken; directe POST/PATCH/DELETE-requests worden met 403 geblokkeerd.

De bestaande auditlaag registreert aanmaken, wijzigen en verwijderen van kentekens en
groepen plus het toevoegen/verwijderen van groepslidmaatschappen. Er worden geen secrets
of cameracredentials gelogd of via deze API's teruggestuurd.

## Uitgevoerde controles

- API: 71 tests geslaagd.
- Web: 24 tests geslaagd.
- ANPR-worker: 20 tests geslaagd.
- Video-worker: 9 regressietests geslaagd.
- Database-schema: 23 tests geslaagd.
- Shared normalisatie/validiteit: 8 tests geslaagd.
- TypeScript en lint: API, web en ANPR-worker geslaagd; volledige eindcontrole uitgevoerd.
- Prisma-schema geldig; 4 migraties aanwezig en geen pending migraties.
- API-productiebuild en Next.js-productiebuild geslaagd.
- Docker Compose-configuratie geldig.
- Uitgebreide runtime-smoketest tegen PostgreSQL geslaagd voor login, dashboard, camera
  CRUD, groepen, kentekens, simulator-hit, hitdetail, gecombineerd zoeken, dossier en
  Viewer-RBAC en databaseregels voor inactieve/verlopen kentekens en inactieve groepen.
  Alleen door de test gemaakte tijdelijke data is daarna opgeruimd.

## Poorten en starten

- Webinterface: `http://localhost:3000`
- API/liveness: `http://localhost:4000/health`
- PostgreSQL en Redis: alleen intern in Docker Compose
- video-worker: intern 4100
- ANPR-worker: intern 4200

Start of herbouw zonder data te verwijderen:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build
docker compose ps
```

Stop zonder volumes te verwijderen:

```bash
docker compose down
```

## Exacte handmatige test

1. Open `http://localhost:3000` en log in als Administrator of Operator.
2. Open **Groepen** en maak `Aandacht` aan. Als die al bestaat, open **Bewerken**.
3. Zet **Groep actief**, **Hitdetectie actief** en **Reden verplicht** aan en sla op.
4. Open **Kentekens**, voeg `12-ABC-3` toe, kies `Aandacht`, vul een duidelijke reden
   in en klik **Opslaan**.
5. Open **Demo / simulator** en kies je echte of een demo-camera uit de keuzelijst.
6. Vul `12-ABC-3` in, kies kleur/type/richting en genereer de DEMO-passage.
7. Open **Live passages** en controleer het DEMO-label, kenteken en de gekozen camera.
8. Open **Hits** en controleer kenteken, groep en reden; klik door naar het hitdetail.
9. Open **Dashboard** en controleer passages vandaag, hits vandaag en de laatste hit.
10. Open **Zoeken**, zoek volledig en gedeeltelijk op het kenteken en combineer daarna
    bijvoorbeeld kleur, type, camera, periode en **Alleen hits**.
11. Klik op `12-ABC-3` en controleer het dossier en de waarschuwing over losse waarnemingen.
12. Log in met een Viewer-account. Controleer dat groepen en kentekens leesbaar zijn,
    beheerknoppen ontbreken en hits/zoeken werken. Een Viewer mag niets wijzigen.

## Bekende beperkingen

- Echte Web Push/PWA-meldingen zijn niet geïmplementeerd; status blijft `SKIPPED`.
- De Dahua-eventverbinding wacht nog op volledige handmatige validatie met een echt
  camera-event en de aanwezige firmware. De bestaande RTSP-test staat daar los van.
- Groepen met bestaande hithistorie worden veilig gedeactiveerd, niet fysiek verwijderd,
  zodat historische hits begrijpelijk blijven.
- Een tijdfilter zoekt maximaal 92 dagen tegelijk en gebruikt tijdzone Europe/Amsterdam.
- Live passages gebruikt nog korte polling; live browservideo/transcoding valt buiten
  deze fase.
- Retentiescheduler, server-OCR en productie-uitrol zijn nog TODO voor afzonderlijke fases.

## Bewust niet gestart

Web Push, PWA-meldingen, live browservideo, eigen server-OCR, retentiescheduler en
productiedeployment zijn niet uitgevoerd. Na de bovenstaande handmatige controle wordt
gewacht op akkoord.
