# Dashboard: teller en recente passages — 19 oktober 2026

## Bevindingen

1. **Teller:** `Passages vandaag` gebruikt `Passage.timestamp`, status ACTIVE en de UTC-grenzen van `applicationDay(now)`. Deze dag volgt `PLATFORM_TIMEZONE` (standaard Europe/Amsterdam), via Luxon/IANA inclusief zomer-/wintertijd. Demo telt mee en blijft apart herkenbaar.
2. **Recente lijst:** gebruikt eveneens `Passage.timestamp`, maar filterde alleen op ACTIVE. De lijst kon daardoor uit de volledige historie putten, inclusief toekomstige timestamps uit oudere cameratijdverwerking of simulaties.
3. **Sortering:** `timestamp DESC`, dan `id DESC` als vaste volgorde bij gelijke tijd. Geen sortering op `createdAt`, `updatedAt`, JSON-metadata, `AccurateTime` of `SnapTime`. Nieuwe echte camera-records slaan in timestamp de serverontvangsttijd (`receivedAt`) op. Die ingestverwerking is in deze opdracht niet gewijzigd.
4. **Gevolg:** een nieuw ontvangen passage voldeed al direct aan de oude lijstquery, maar kon buiten de hoogste acht vallen als oudere records een hogere, foutieve timestamp bevatten. Een stijgende dagteller bewees daardoor niet dat deze passage ook in de beperkte lijst terechtkwam. Dit is een aangetoonde foutmogelijkheid in de code, niet een op productie geverifieerde inventarisatie van foutieve records.
5. **Caching:** API `/dashboard` heeft `Cache-Control: private, no-store`; de client vraagt op met `cache: no-store` en ververst iedere drie seconden zonder overlappende requests. Teller en lijst worden samen in één response vervangen. De serviceworker heeft geen fetch-handler en cachet deze antwoorden niet. Next.js rewritet `/api/*` naar de API; de dashboarddata komt uit client-fetch, zonder server-side revalidate. Geen aparte lijstcache gevonden.
6. **Snapshot:** teller en lijst worden al in één PostgreSQL RepeatableRead-transactie gelezen. Dat blijft behouden. Een commit na aanvang van die snapshot wordt bij een volgende poll zichtbaar; een tijdelijke netwerkfout houdt het laatste overzicht met foutmelding zichtbaar.

## Gerichte wijziging

De passage-teller en recente passagequery delen nu exact hetzelfde `passageWhere`:

- status ACTIVE;
- timestamp vanaf het begin van de huidige platformdag, exclusief de volgende dag;
- timestamp niet later dan `now` van dit dashboardantwoord.

De laatste grens voorkomt ook dat oude cameraklokfouten binnen dezelfde dag een net ontvangen passage verdringen. De lijst blijft maximaal acht records tonen, gesorteerd op dezelfde primaire timestamp. Nieuwe serverontvangsten staan op volgorde van ontvangst, onafhankelijk van de diagnostische cameraklok of aanmaakvolgorde. Gelijktijdige passages met identieke timestamps houden de bestaande ID-volgorde. De gewone passagehistorie blijft via Live passages bereikbaar. Hits, ingest, authenticatie en de frontendlogica zijn niet gewijzigd.

De platformdag is voor teller en lijst dezelfde. De afzonderlijke passage blijft in de eigen cameralocatiezone getoond worden. Er is geen herinterpretatie van opgeslagen UTC-waarden.

Geen bestaande passages aangepast of verwijderd, geen demo-data verwijderd, geen migration/reset en geen deployment.

## Regressies en bestanden

`apps/api/src/dashboard.test.ts` slaat via de echte PassageService twee synthetische events met verschillende receivedAt en tegengestelde foutieve cameraklokken op in een in-memory Prisma-testdouble. De queryfilter en sortering worden op die opgeslagen testrecords toegepast. De tweede ontvangst moet bovenaan staan en de teller moet tegelijk met één oplopen. Extra records vóór de daggrens, op de volgende dag, in de nabije toekomst en met status DELETED mogen dit niet beïnvloeden; een demopassage blijft aanwezig en meegeteld. De test draait voor een Amsterdamse zomer- en winterdag en controleert identieke teller-/lijstselectie en behoud van de oorspronkelijke fixtures. Dit is een unit-/serviceketentest met testdouble, geen live PostgreSQL-bewijs.

`apps/web/app/page.test.tsx` controleert dat de volgende poll zowel teller als lijst bijwerkt, de nieuwste passage bovenaan rendert en `no-store` blijft gebruiken.

Gewijzigde bestanden:

- `apps/api/src/routes/dashboard.ts` — gedeelde passagefilter en toekomstgrens.
- `apps/api/src/dashboard.test.ts` — ontvangstvolgorde en consistente dagselectie.
- `apps/web/app/page.test.tsx` — gelijktijdige verversing van teller en lijst.
- `README.md` en dit document — werking en onderzoeksrapport.

Uitgevoerd en geslaagd:

- API-dashboard- en daggrenstests: 7 tests.
- Webdashboardtests: 3 tests, inclusief gezamenlijke teller-/lijstverversing.
- API- en webtypecheck en lint.
- API-productiebuild en `git diff --check`.

Exacte regressiecommando’s:

```bash
npm run test -w @anpr/api -- --configLoader runner src/dashboard.test.ts src/lib/application-time.test.ts
npm run test -w @anpr/web -- app/page.test.tsx
```

Geen productie-inspectie, live PostgreSQL-ketentest of deployment uitgevoerd. Geen nieuwe migratie of Dockerconfiguratie nodig. Na dit rapport stopt het werk.
