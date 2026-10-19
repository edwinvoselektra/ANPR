# Passage-eventtijd en groepen — 19 oktober 2026

## Tijd: oorzaak en keuze

De gedeelde PassageService overschreef de reeds geparste Dahua-eventtijd met serverontvangsttijd. Dit was een expliciete eerdere policy, geen ontbrekende vaste uurcorrectie. Nieuwe ITSAPI-passages gebruiken nu de geldige `Picture.SnapInfo.AccurateTime`, anders geldige `SnapTime`. `AccurateTime` behoudt milliseconden en blijft de voorkeursbron uit het bestaande Picture-profiel. De [oorspronkelijke ITC413-implementatie](https://gist.github.com/paindefender/cf74164ade12f8a2954f271f3d5972e7) leest hetzelfde veld als gebeurtenistijd. De gebruiker bevestigt echte ITSAPI-inname; deze wijziging heeft geen nieuwe ruwe productiepayload of hardwaremeting gecontroleerd. Controleer lokaal de cameraklok aan de hand van een nieuwe fysieke passage.

De bestaande IANA-/Luxon-verwerking blijft leidend: cameralocatie → PLATFORM_TIMEZONE → Europe/Amsterdam. De locatie is bewerkbaar onder Locaties. Offsetloze eventtijden worden één keer vanuit die zone naar UTC vertaald; Z en expliciete offsets blijven absolute tijdstippen. Geen handmatige zomer-/wintertijdcorrecties. Tijdzonesnapshot op Passage en API-veld `timeZone` blijven behouden. Amsterdam 07:30 is 06:30Z in januari en 05:30Z in juli. Als beide tijdvelden ongeldig zijn (ook ambigue herfsttijd of overgeslagen lentetijd zonder offset), blijft de receiver weigeren in plaats van een tijdstip te verzinnen.

Dezelfde eventtijd gaat naar passage, hit en de geldigheidscontrole van groepslidmaatschappen. `receivedAt` blijft apart in metadata; opslagpad, bewaartermijn en cameraverbindingsstatus blijven ontvangsttijd gebruiken. CGI-verwerking is ongemoeid gelaten. Er is geen historische correctie: bestaande UTC-timestamps en eerder opgeslagen retries veranderen niet.

Dashboard/Recente passages, Live passages, Hits, Zoeken en passage-detail gebruiken al de centrale formatter met de door de API geleverde passagezone. Het kentekendossier miste voor eerste/laatste waarneming de bijbehorende camera-/zonesnapshot; deze twee API-velden en de weergave zijn aangevuld. Het hitdetail toont eventtijd en ontvangst/opslag in de passagezone. De huidige auditinterface toont mutatietijd, geen afzonderlijke passagetimestamp; die auditregistraties zijn niet herschreven.

## Groepskoppeling

Passage- en kentekendetail delen een compacte sectie Groepen met `Aan groep toevoegen`, gekoppelde groepen, reden, actiefstatus en eventuele geldigheid. Eén kenteken kan aan meerdere groepen worden toegevoegd. Actieve nog niet gekoppelde groepen zijn selecteerbaar. Een ontbrekend beheerd kenteken ontstaat als `PlateGroupMember`; er bestaat geen afzonderlijke verplichte Plate-entiteit. Bestaande lidmaatschappen, notities, geldigheidsperioden en passages worden niet overschreven. Ook de laatste koppeling kan worden verwijderd. Een bestaande inactieve of verlopen koppeling wordt zichtbaar getoond en niet stilzwijgend gereactiveerd; beheer deze via Kentekens of verwijder haar expliciet en voeg opnieuw toe.

Nieuwe routes: GET `/plates/:normalized/groups`, PUT en DELETE `/plates/:normalized/groups/:groupId`. Normalisatie volgt de gedeelde kentekenfunctie. GET vereist passages.view; mutaties plates.manage, met bestaande ADMIN-bypass. Er bestaat geen toegangsfilter per afzonderlijke groep in dit datamodel. De database-unique key plus `skipDuplicates` voorkomt dubbele koppelingen bij gelijktijdig toevoegen. Toevoegen/verwijderen en auditregel staan in dezelfde transactie. De reden blijft verplicht voor een hitgroep of een groep met redenplicht. De bestaande hitdetectie leest deze lidmaatschappen bij iedere nieuwe passage zonder cache; historische passages/hits blijven intact.

## Database en controles

Geen schemawijziging of migration nodig. Geen database-reset, historische gegevenswijziging of productie-deploy uitgevoerd.

Regressies dekken winter/zomer 07:30, offsets/Z en milliseconden zonder dubbele conversie, SnapTime-terugval, hit/eventtijd en groepsgeldigheid, retries, normalisatie, meerdere koppelingen, dubbele aanvragen, redenplicht, inactieve groepen, rechten, audit en UI toevoegen/verwijderen/fouten. `scripts/passage-time-groups-smoke.mts` voegt een geïsoleerde PostgreSQL-ketentest toe; die weigert iedere database behalve `anpr_native_test` en ruimt uitsluitend eigen fixtures op. `scripts/itsapi-processing-smoke.mts` controleert nu eventtijd én afzonderlijke ontvangsttijd.

Uitgevoerd: workspace-typecheck en lint geslaagd; alle afzonderlijke testsuites geslaagd (411 tests totaal: API 216, web 63, ANPR-worker 46, video-worker 9, database 31, shared 46). De API-suite is met `npm run test -w @anpr/api -- --configLoader runner` uitgevoerd: de standaard Vite-cachemap was niet beschrijfbaar; vier bestaande lokale HTTP-tests vereisten uitvoering buiten de sandbox. Alle vier slagen daar eveneens. Prisma-schema geldig en beide integratiescripts afzonderlijk getypecheckt.

Shared-, API- en Next.js-productiebuild geslaagd. De standaard root-build strandt op bestaande niet-beschrijfbare worker-`dist`-bestanden van een andere eigenaar. Beide workers compileren succesvol met hun normale build-tsconfig en een alternatieve outputmap:

```bash
npx tsc -p apps/video-worker/tsconfig.build.json --outDir data/build-check/video-worker
npx tsc -p apps/anpr-worker/tsconfig.build.json --outDir data/build-check/anpr-worker
```

De oude niet-beschrijfbare Next.js-cache is bewaard onder het genegeerde `data/time-groups-build-backup/web-next`; daarna slaagt de reguliere webbuild. Docker is in deze WSL-omgeving niet beschikbaar. De geconfigureerde PostgreSQL-server is niet bereikbaar. Dockerbuilds, Compose-validatie en de echte PostgreSQL-ketentests zijn daarom niet uitgevoerd; deze zijn nog geen geslaagde acceptatiechecks.

## Gewijzigde bestanden

- `packages/shared/src/passage-service.ts`: ITSAPI-eventtijd voor passage/hit/geldigheid.
- `apps/api/src/lib/itsapi-parser.ts`: geldige AccurateTime/SnapTime-selectie, milliseconden en ISO-varianten.
- `apps/api/src/routes/plates.ts`: afzonderlijke groepsroutes met transactionele audit; tijdzones eerste/laatste waarneming.
- `apps/web/components/PlateGroups.tsx`: gedeelde groepssectie en acties.
- `apps/web/app/passages/[id]/page.tsx` en `apps/web/app/plates/[normalized]/page.tsx`: groepssectie; dossier toont de juiste eerste/laatste tijdzone.
- `apps/api/src/itsapi-processing.test.ts`, `apps/api/src/plate-management.test.ts`, `apps/web/components/PlateGroups.test.tsx`: regressies.
- `scripts/itsapi-processing-smoke.mts`, `scripts/passage-time-groups-smoke.mts`: geïsoleerde databaseketentests.
- `README.md`, `docs/itsapi-receiver.md`, `docs/passage-time-groups.md`: actuele werking, beperkingen en testplan.

## Zelf lokaal testen

Voer in de projectmap uit (pas nadat Docker Desktop met WSL-integratie draait):

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build
```

Dit bouwt en start uitsluitend de lokale Compose-omgeving. Gebruik je bestaande lokale `.env`; wijs deze niet naar productie. Er is geen nieuwe migratie nodig; de bestaande migratieservice blijft zoals hij was.

1. Open `http://localhost:3000`, log in als ADMIN of OPERATOR met kentekenbeheerrechten. Controleer bij Locaties dat de camera van Vos Elektra aan de locatie met `Europe/Amsterdam` gekoppeld is. Een camera zonder locatie valt op de platformzone terug.
2. Laat een nieuwe echte passage binnenkomen via de lokaal ingestelde ITSAPI-ontvanger. Vergelijk het fysieke moment en de beeldtijd met Dashboard, Live passages en passage-detail. De API levert UTC met Z en `timeZone: Europe/Amsterdam`. Oude foutieve tijden worden niet achteraf gerepareerd. Verander hiervoor geen productiecamera-instellingen.
3. Maak via Groepen een actieve signaleringsgroep met hitdetectie aan of kies een bestaande. Open de passage → Aan groep toevoegen → kies die groep → vul de reden in → Toevoegen. Voeg desgewenst een tweede groep toe. Controleer de sectie Groepen en het kentekendossier.
4. Laat hetzelfde kenteken opnieuw passeren met een nieuw eventtijdstip. Verwacht één nieuwe passage en één hit met alle toepasselijke actieve hitgroepen. Controleer de tijd ook onder Hits en zoek met camera + lokale datum/tijd. Een herupload van hetzelfde event is een retry en wordt terecht geen nieuwe passage/hit.
5. Verwijder één koppeling. Een volgende passage mag alleen de resterende hitgroepen raken. Verwijder de laatste: een nieuwe passage levert geen groepshit op. De oorspronkelijke passages en hithistorie blijven bestaan. Een actieve groep zonder hitdetectie veroorzaakt geen hit.
6. Controleer met een Viewer dat de groepen zichtbaar zijn maar toevoegen/verwijderen niet beschikbaar is.

Zonder echte camera kun je stappen 3–6 met de bestaande expliciet gemarkeerde Demo/simulator doen wanneer `DEMO_MODE=true`. Dit test groepsmatching en UI; het bewijst geen ITSAPI-camera-inname. De automatische regressietests dekken afzonderlijk de ITSAPI-tijdconversie in zomer en winter.

Voor de afzonderlijke databaseketentest moet je zelf een reeds gemigreerde, geïsoleerde PostgreSQL-database `anpr_native_test` beschikbaar hebben. Maak in de projectmap een genegeerd `.env.integration` met `DATABASE_URL` voor die testdatabase, `REDIS_URL`, `WEB_ORIGIN=http://localhost:3000` en een eigen 64-hex `CAMERA_CREDENTIALS_KEY`. Kopieer dan:

```bash
npm run build -w @anpr/shared
node --env-file=.env.integration --import tsx scripts/passage-time-groups-smoke.mts
node --env-file=.env.integration --import tsx scripts/itsapi-processing-smoke.mts
```

Na deze wijzigingen stopt het werk voor lokale acceptatie; productie-uitrol valt buiten deze opdracht.
