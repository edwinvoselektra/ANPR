# Mobiele weergave, lokale tijd en rijrichting

## 1. Oorzaak van de tijdafwijking

De bestaande Dahua CGI-parser koos `UTC` vóór `RealUTC`. Bij de eerder onderzochte echte cameragebeurtenissen verschilden deze velden met een uur (later twee uur). `RealUTC` kwam overeen met het ontvangsttijdstip en de beeldtijd; `UTC` bevatte bij deze firmware een als epoch gecodeerde lokale kloktijd. De eerdere presentatie gebruikte bovendien overal Amsterdam, zonder cameralocatie, en de zoekconversie gebruikte een eigen offsetberekening. Er wordt geen universele Dahua-correctie van -1/-2 uur toegepast.

Nieuwe CGI-gebeurtenissen gebruiken het eerste geldige veld in de volgorde `RealUTC`, `UTC`, `SnapTime`, `Time`; anders ontvangsttijd. De gekozen bron en tijdzone staan in metadata. Absolute epochs en tijden met offset blijven absolute tijdstippen. Zoneloze kloktijden worden uitsluitend in de cameralocatie geïnterpreteerd; ongeldige/ambigue kloktijden worden niet geraden. Historische timestamps blijven ongewijzigd. Oudere onjuiste events kunnen daardoor nog een afwijking tonen.

## 2. Tijdzone-oplossing

`VpnLocation.timezone` bevat een gevalideerde IANA-zone, standaard `Europe/Amsterdam`. Resolutie: gekoppelde cameralocatie → `PLATFORM_TIMEZONE` → `Europe/Amsterdam`. Een camera zonder gekoppelde locatie gebruikt de platformstandaard. Nieuwe passages bewaren een snapshot van de gekozen zone; oude passages vallen terug op de huidige cameralocatie. API-timestamps blijven UTC-ISO; API-responses leveren `timeZone` mee. UI en push gebruiken dezelfde formatter `dd-MM-yyyy HH:mm:ss`.

[Luxon](https://moment.github.io/luxon/api-docs/index.html) gebruikt IANA/Intl voor zomer- en wintertijd. Geen eigen DST-kalender. Bij zoeken kiest één geselecteerde camera haar locatiezone; een zoekopdracht over meerdere camera’s gebruikt één platformzone voor de zoekgrenzen. Resultaten tonen elk hun eigen zone. Een tijdvenster 22:00–03:00 eindigt de volgende dag. Bij de herhaalde herfsttijd omvat zoeken beide voorkomens; niet-bestaande lentetijden geven een validatiefout. De simulator kiest bij een herhaalde herfsttijd het eerste voorkomen.

## 3. Rijrichting

Centrale passagebetekenis: `INCOMING`, `OUTGOING`, `UNKNOWN`. Een daadwerkelijk herkende gebeurtenisrichting gaat voor; zonder richting mag uitsluitend een vaste cameraconfiguratie INCOMING/OUTGOING dienen als fallback. `BOTH` blijft bestaan voor bestaande camera’s/gegevens maar wordt voor passagepresentatie Onbekend. Numerieke Dahua-waarden worden zonder bevestigde betekenis niet geraden. Passage, hit, zoekresultaat en push delen de normalisatie. UI: ↓ Inkomend / ↑ Uitgaand / Onbekend. Push laat onbekende richting weg. De simulator ondersteunt alle drie.

## 4. Mobiele UI

Volle contentbreedte met sluitbare drawer, actieve navigatie, Escape/Tab-focusbeheer, bereikbare account/logout. Grotere aanraakvlakken, formuliertekst, veilige schermranden, gestapelde beheertabellen, flexibele detailbeelden en mobiele cards. Desktopsidebar blijft behouden. Dashboard, passages, hits, zoeken, kentekens, groepen, camera’s, instellingen en details delen deze responsieve basis.

## 5. Lijst en tegels

Live passages en Hits hebben een gedeelde kaart/lijstpresentatie met thumbnail, lokale tijd, richting en relevante voertuig-/hitgegevens. Voorkeuren staan per gebruikers-ID én pagina onder `anpr-view-v1` in localStorage; geen authenticatie- of cameragegevens. Bij geblokkeerde opslag blijft de bediening werken. Klik opent het bijbehorende detail. Polling behoudt de gekozen weergave.

## 6. Livecamera’s op pauze

Livebeelden zijn op verzoek teruggezet naar toekomstwerk. Er is in deze fase geen livecamera-menu, browservideospeler, HLS/WebRTC-route of extra restreamproces. De bestaande video-worker blijft de al werkende snapshots en cameragezondheid uitvoeren. Dit voorkomt dat een gedeeltelijk uitgerolde mediaservice als werkend product verschijnt. Een latere livefase kan bewust kiezen voor WebRTC/HLS, main-/substreamconfiguratie, capaciteitsgrenzen en volledige mobiele hardwaretests.

## 7. Database

Migratie `20260914000100_location_timezone_direction` voegt `VpnLocation.timezone` met Amsterdam-default, nullable `Passage.timezone` en enumwaarde `UNKNOWN` toe. Geen reset, verwijdering, terugdraaiing of historische tijdcorrectie. Bestaande locaties krijgen de default; historische passages blijven zonder zonesnapshot.

## 8. Validatie

TypeScript, lint, Prisma-validatie, migratiestatus en alle API/web/worker-builds zijn geslaagd. De 291 unit- en componenttests zijn geslaagd. De geïsoleerde PostgreSQL-ketentest bevestigde RealUTC-opslag, zonesnapshot, richting door passage/hit/API/push, camera-lokaal zoeken, simulatorrichtingen en deduplicatie. De bestaande native ANPR-, ITSAPI- en hitgroeptests bleven groen. Reproduceerbare ketentest: `scripts/mobile-time-direction-smoke.mts` (weigert andere databases dan `anpr_native_test`). Tests ruimen uitsluitend hun eigen fixtures op.

De publieke productiebuild is gecontroleerd op 390×844: passages en Hits hadden geen horizontale overflow, de drawer opende als dialoog en maakte de hoofdinhoud inert, de gebruikerstabel had mobiele veldlabels, de passagevoorkeur bleef na refresh behouden, API en alle 22 Next.js-assets antwoordden 200. `/api/live-cameras` antwoordde 404 zoals bedoeld voor de uitgestelde functie.

## 9. Grenzen

Livebeelden zijn nog niet geïmplementeerd. Echte iPhone/Android/PWA-ervaring vraagt de onderstaande handmatige test. Pushstatus SENT betekent aangeboden aan de pushdienst, geen bewezen ontvangst op een toestel. ITSAPI wordt door deze opdracht niet als hardware-getest verklaard.

## 10. Handmatige test A–D

Open https://anpr.vanmilligentechniek.com en log in.

**A. Mobiel:** open op telefoon; open/sluit het menu; bezoek Live passages, Hits en een detail. Controleer leesbaarheid, foto’s en knoppen. Bekijk ook Zoeken, Kentekens, Groepen, Camera’s en Instellingen; er mag geen horizontale pagina-overflow zijn.

**B. Weergave:** Live passages → Tegels → verversen → controleer behoud → Lijst → verversen. Herhaal bij Hits. Controleer dat beide pagina’s een eigen voorkeur onthouden.

**C. Richting:** zorg dat `V84KVJ` lid is van een actieve hitgroep met reden. Open Demo/simulator, kies de gewenste camera, `V84KVJ` en Inkomend. Voor een echte testpush: schakel de simulatoroptie voor push in, zet groepspush en eigen meldingsvoorkeuren aan en geef dit toestel notificatierechten. Genereer één DEMO-passage; controleer passage, hit en ontvangen push. Herhaal met Uitgaand. Alle testregistraties blijven duidelijk DEMO.

**D. Tijd:** laat het simulatietijdstip leeg (nu). Vergelijk passage- en hitdetail en push met de actuele tijd op de cameralocatie. Voor Nederland: Europe/Amsterdam. Controleer desgewenst in browsernetwerk dat de API een UTC-timestamp met `Z` én `timeZone` levert. Zoek met die camera en lokale datum/tijd; probeer ook een venster 22:00–03:00 met een passend testtijdstip.

Na deze opdracht stopt de ontwikkeling tot handmatig akkoord.
