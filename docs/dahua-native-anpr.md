# Dahua Native ANPR (ITSAPI): native camera-events

RTSP = videostream, live/video-preview en snapshots. Native ANPR = kentekenherkenning in de camera met events en metadata. Deze provider gebruikt geen server-OCR en is geen TCP-poorttest.

## Onderzochte interface

De [Dahua ITC413-PW4D datasheet](https://material.dahuasecurity.com/uploads/soft/20230424/ITC413-PW4D-Series_20230424.pdf) vermeldt CGI en ITSAPI. De [Dahua HTTP API for IPC v1.67, §8.2.3](https://gizmoware.net/easyptz/DAHUA_HTTP_API_FOR_IPC%20V1.67.pdf) documenteert `snapManager.cgi?action=attachFileProc`, multipart metadata en JPEGs, met `TrafficJunction` als voorbeeld.

Gekozen: langdurige HTTP(S) Digest-subscriptie op:

```text
/cgi-bin/snapManager.cgi?action=attachFileProc&channel=1&heartbeat=5&Flags[0]=Event&Events=[TrafficJunction]
```

Dit is de bestaande native CGI-methode, in de interface benoemd als **Dahua Native ANPR (ITSAPI)**. De interne provider-ID `DAHUA_CGI` blijft behouden voor compatibiliteit. Er wordt geen afzonderlijk, ongedocumenteerd `/itsapi`-endpoint verzonnen en geen camera-uploadconfiguratie gewijzigd.

Op 11 september 2026 is op de lokale DHI-ITC413-PW4D-IZ3 (`192.168.178.248`, HTTP 80, kanaal 1) met de opgeslagen versleutelde credentials daadwerkelijk HTTP 200 en `multipart/x-mixed-replace; boundary=myboundary` vastgesteld. Zonder authenticatie antwoordde de camera met 401. Dit bevestigt de native eventverbinding; het bevestigt nog geen fysieke kentekenpassage of de geleverde beeldsoorten.

## Configureren in de webinterface

De camera bestaat al in de lokale database: gebruik bij voorkeur **Camera’s → Bewerken** om een dubbele subscriptie te voorkomen.

Voor een nieuwe camera:

1. **Camera’s → Camera toevoegen**. Geef een unieke naam, locatie en rijrichting op.
2. Kies RTSP en invoer via losse velden. Host `192.168.178.248`, RTSP-poort `554`, pad `/cam/realmonitor?channel=1&subtype=0`. Vul de camera-inloggegevens in. Een volledige RTSP-URL blijft mogelijk.
3. Test RTSP en haal een snapshot op. Een host zoals `http://192.168.178.248/` wordt door de API genormaliseerd. Credentials, poorten en paden horen in de daarvoor bestemde velden of in de volledige RTSP-URL.
4. In de ANPR-stap: kies **Dahua Native ANPR (ITSAPI)**, protocol **HTTP**, HTTP-poort **80**, Dahua-kanaal **1**.
5. Klik **ITSAPI / ANPR testen**. De knop gebruikt dezelfde inloggegevens. Bij bewerken wordt een leeg wachtwoordveld aangevuld uit de versleutelde opslag. Verkeerde credentials of een anonieme HTTP 200 geven geen groene successtatus.
6. Rond de wizard af, schakel de camera in en sla op. De worker neemt de configuratie standaard binnen 10 seconden over. De wizard hoeft niet open te blijven.
7. Controleer **Systeemstatus → Cameraverbindingen**: RTSP, snapshot, native eventverbinding, laatste event en laatste fout.

HTTP/HTTPS-poort en RTSP-poort staan los van elkaar. TLS-validatie blijft ingeschakeld. Poort 37777 en de optionele NetSDK-transporttest zijn niet nodig voor deze HTTP-eventprovider. Native ANPR kan doorlopen wanneer RTSP-videotransport uitstaat; gedeelde host en credentials blijven daarvoor beschikbaar.

## Verwerking en opslag

De bestaande `AnprSupervisor` beheert één loop per ingeschakelde providerconfiguratie binnen de worker. Wijziging, uitschakelen of archiveren beëindigt de subscriptie; een vervanger start na beëindiging van de oude loop. Exponentiële reconnect met jitter voorkomt snelle herhaalverzoeken; pas na een stabiele verbinding wordt de teller gereset. Draai één anpr-worker instantie: een gedistribueerde lease voor meerdere replicas is nog niet geïmplementeerd.

`TrafficJunction`-metadata wordt tolerant vertaald naar een passage. Kentekens worden genormaliseerd met de gedeelde normalisator; oorspronkelijke tekst blijft behouden. Numerieke UTC-seconden/milliseconden en ISO-tijden worden ondersteund. Ontbrekende velden blokkeren de passage niet. Optionele snelheid/model blijven, indien geleverd onder ondersteunde keys, in de toegestane ruwe metadata. Alleen een expliciete allowlist wordt bewaard; geen willekeurige cameraresponse of credentials.

`PassageService` gebruikt dezelfde gedeelde `detectAndCreateHit` als de API. Deze maakt één hit met alle passende actieve groepen, rekening houdend met geldigheid. `PENDING` wordt door de bestaande notification dispatcher verwerkt volgens de bestaande pushinstellingen. Een werkende pushconfiguratie, toestemming en abonnement blijven vereist.

Event-ID heeft voorrang; GroupID wordt gecombineerd met eventpositie. Zonder bron-ID wordt een hash van camera, genormaliseerd kenteken, eventtijd en lane gebruikt, beschermd door de bestaande unieke database-index `(cameraId, source, sourceEventId)`. Daarnaast geldt het bestaande korte tijdvenster voor events zonder ID, nu met lane. Zonder betrouwbare eventtijd kan alleen een kort herhaalvenster worden gebruikt; herlevering veel later is dan niet bewijsbaar hetzelfde event.

Maximaal drie aangeleverde JPEGs: overzicht, expliciet herkenbare kentekencrop en extra voertuigbeeld. Geen tweede foto willekeurig als kentekencrop labelen. Identieke bytes binnen een event delen hetzelfde bestand. De opslagprovider bewaart bestanden buiten PostgreSQL. Bij ontbrekende/ongeldige beelden of opslagfouten blijft kentekendata behouden en volgt een waarschuwing. De passage-detailpagina toont beschikbare beelden; hits verwijzen naar dezelfde passage. Niet iedere firmware levert drie beelden of een herkenbare crop-header.

## Camera verwijderen

De bevestiging vermeldt dat historie behouden blijft. De API archiveert de camerareferentie transactioneel, ook als nog geen historie bestaat. De actieve configuratie, credentials, zones en device-connections verdwijnen; de camera verdwijnt uit beheer. De unieke naam wordt vrijgegeven en de oorspronkelijke naam wordt apart bewaard voor passage-, hit-, zoek- en dashboardweergave. Historische foreign keys blijven intact. Een gearchiveerde camera kan via de normale bewerkroute niet worden heringeschakeld. ADMIN en de bestaande Administrator-rol mogen dit; overige rollen hebben `cameras.manage` nodig.

De workers stoppen bij de volgende configuratiepoll (standaard maximaal 10 seconden). Reeds bewaarde passagefoto’s blijven bestaan. Tijdelijke snapshotbestanden vallen onder het bestaande opslagbeheer; verwijderen wist de snapshotverwijzing, maar is geen opslagschoonmaak van historische media.

## Fysieke acceptatietest

1. Controleer camera-klok, belichting, scherpte en herkenningsgebied in de camera zonder kritieke instellingen blind te wijzigen.
2. Controleer in het platform de succesvolle interfacetest en de verbonden worker.
3. Voeg desgewenst jouw testkenteken toe aan een actieve signaleringsgroep met hitdetectie. Voor push: zet ook groepsmeldingen en persoonlijke notificatie-instellingen aan.
4. Rijd één voertuig duidelijk door het ingestelde cameragebied.
5. Controleer **Live/recente passages**, open de passage en controleer kenteken, tijd, camera en beschikbare beelden. Zoek hetzelfde kenteken via **Zoeken**.
6. Bij watchlistmatch: controleer één hit en, wanneer geconfigureerd, de pushmelding. Meerdere groepsmatches horen bij dezelfde hit.
7. Herhaal na uitschakelen/inschakelen van de platformcamera. Controleer herstel van de worker zonder extra passages van hetzelfde event.

Geen event ondanks verbonden stream: controleer eerst of de camera zelf de passage registreert. Een geaccepteerde subscriptie bewijst niet dat de herkenning goed is afgesteld. Zonder fysieke passage kan de beeldmapping voor deze firmware niet definitief worden gevalideerd. TODO: leg een geschoonde echte eventfixture vast na de eerste succesvolle fysieke test; breid firmware-specifieke metadata/beeldmapping daarmee uit.

## Lokaal bouwen en testen

```bash
docker compose build
docker compose run --rm migrate
docker compose up -d
```

De nieuwe additieve migratie is `20260911000100_camera_archive` (archiefdatum, historische naam, aparte RTSP-inschakeling). Bestaande provider-ID’s en historische relaties blijven behouden.

Automatische unit/integratie-fixtures: hostnormalisatie, geen groen bij fout wachtwoord/anonieme 200/HTML, bestaande parser/multipart/Digest, reconnect, normalisatie, passage/hit en camera-archivering. `scripts/native-anpr-smoke.mts` weigert uitvoering buiten de afzonderlijke database `anpr_native_test` en test de echte PostgreSQL-constraints en ADMIN-route. Geen fixture-hits naar de live notification dispatcher.
