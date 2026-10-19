# Productie-interface zonder simulator — 19 oktober 2026

## Verwijderde UI

- De volledige oranje dashboardmelding over gemengde tellingen, demo-aantallen en daggrens is verwijderd. De API-respons, passage-/hitberekeningen, selectie, sortering, tijdzones en polling zijn niet aangepast.
- Het navigatie-item Demo / simulator is verwijderd, ook voor gebruikers met simulatorrechten.
- De publieke simulatorpagina is volledig verwijderd; rechtstreeks openen van `/simulator` geeft 404. Er is geen nieuwe verborgen menulink of alternatieve simulatorroute.
- De logintekst over Fase 1/demosimulator en het label lokale ontwikkelomgeving zijn vervangen door gewone producttekst.
- De lege passageweergave verwijst alleen nog naar nieuwe cameraregistraties. Het bronlabel op passagedetail heet voor bestaande demo-records alleen DEMO.

De frontend is doorzocht op DEMO, Demo, simulator, demopassages en demo-hits. De resterende zichtbare verwijzingen verschijnen uitsluitend bij werkelijk opgeslagen records met bron DEMO: bronlabels/badges en de waarschuwing op passage-/hitdetail. Deze blijven nodig om historische testdata niet als echte cameradetectie te presenteren. Er zijn geen records verwijderd of uitgefilterd. Interne datavelden, een ongebruikt icoon, fixtures en tests blijven staan; ze leveren geen algemeen zichtbaar menu of testpaneel op.

## Routes en ontwikkelhulpmiddelen

De frontendroute `/simulator` bestaat niet meer. Een gecontroleerde `notFound()`-pagina gaf door Next.js-streaming nog HTTP 200; daarom is de route volledig verwijderd. De oude interactieve component is verplaatst naar `apps/web/components/development/Simulator.tsx`; de bijbehorende vier componenttests zijn meeverplaatst. Geen publieke pagina importeert deze component; zij wordt daardoor niet als simulator-UI in de productiepagina geladen.

De API registreert `GET /simulator` en `POST /simulator/passages` **niet** bij `NODE_ENV=production`, ook niet als `DEMO_MODE=true`. Verzoeken naar `/api/simulator` en `/api/simulator/passages` komen via de bestaande frontendrewrite bij diezelfde ontbrekende routes uit. Buiten productie blijven de bestaande development-endpoints, rechtencontroles en DEMO_MODE-schakelaar beschikbaar voor tests. Er zijn geen wijzigingen aan normale passage-/hit-/camera-endpoints.

Geen databasewijzigingen, migration, reset, opschoonquery of productie-deploy.

## Bestanden

- `apps/web/app/page.tsx` en `page.test.tsx`: banner verwijderd, tellingen en verversing behouden.
- `apps/web/components/app-shell.tsx` en `app-shell.test.tsx`: menu opgeschoond, overige navigatie gecontroleerd.
- `apps/web/app/simulator/page.tsx` verwijderd; de oorspronkelijke `page.test.tsx` is naar de interne componenttests verplaatst. De ontbrekende publieke route wordt na de build via HTTP gecontroleerd.
- `apps/web/components/development/Simulator.tsx` en `Simulator.test.tsx`: bestaande simulator en tests intern bewaard.
- `apps/web/app/login/page.tsx` en `page.test.tsx`: test-/ontwikkeltekst verwijderd.
- `apps/web/app/passages/page.tsx`: lege staat zonder demo-uitleg.
- `apps/web/app/passages/[id]/page.tsx`: kort historisch DEMO-bronlabel.
- `apps/api/src/routes/simulator.ts` en `apps/api/src/simulator.test.ts`: simulator-API uitgesloten van productie, developmenttests behouden.
- `README.md` en dit rapport: werking, routes en lokaal testpad.

## Controles

- Alle 66 frontendtests geslaagd, inclusief de vier behouden interne simulatortests, de schone navigatie met volledige rechten, bannerverwijdering en ongewijzigde tellers/polling.
- 11 gerichte API-tests geslaagd: simulator in development behouden, beide productieroutes afwezig met DEMO_MODE=true en dashboardregressies behouden.
- Workspace-typecheck en lint geslaagd; API- en webproductiebuild geslaagd.
- De gebouwde webapp is tijdelijk uitsluitend op 127.0.0.1 gestart: GET `/simulator` antwoordt daadwerkelijk HTTP 404, zonder simulatorformulier. De lokale controle-server is daarna gestopt. Geen productieomgeving gebruikt.
- De interne simulator ontbreekt in de publieke route-imports; de simulatorroute ontbreekt uit de gebouwde routekaart.
- `git diff --check` geslaagd. Geen live database- of cameratest uitgevoerd voor deze UI-wijziging.


## Lokaal controleren

Bouw en start je bestaande lokale omgeving:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build
```

1. Open `http://localhost:3000`. De loginpagina noemt geen demosimulator of ontwikkelomgeving.
2. Log in. Op het Dashboard staat geen oranje demo-/daggrensbanner. De passage-/hittellers en de lijsten blijven zichtbaar en verversen zoals voorheen.
3. Controleer desktopnavigatie en mobiel menu: geen Demo / simulator. Camera’s, passages, hits, zoeken, kentekens, groepen, locaties, gebruikers, systeemstatus en instellingen blijven zichtbaar volgens de bestaande rechten.
4. Open `http://localhost:3000/simulator` rechtstreeks: verwacht een 404, ook als lokaal DEMO_MODE=true is ingesteld.
5. Open een bestaande echte passage/hit en controleer details, tijd en afbeeldingen. Als er historische demo-records zijn, moeten die herkenbaar DEMO blijven.
6. De API-productieblokkade is met tests afgedekt voor zowel GET als POST, terwijl DEMO_MODE=true staat. De standaard lokale Compose-omgeving draait development; daar blijft de interne test-API bewust beschikbaar voor bevoegde ontwikkeltests.

Er is niets naar productie gepusht. Na dit rapport stopt het werk voor lokale acceptatie.
