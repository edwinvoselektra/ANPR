# Dahua ITSAPI V1.19: ontvanger en cameradiagnose

## Status en afbakening

De standaardroute is **Camera’s → Camera toevoegen → Dahua ANPR-camera** met vier stappen: Camera, Beeld controleren, Kentekengegevens koppelen, Praktijktest en afronden. De oude transport-/zonewizard blijft onder **Geavanceerd** beschikbaar. VPN-locaties, ER605/WireGuard, bestaande credentials en RTSP-instellingen blijven behouden.

**CGI is geen ITSAPI.** De eerder werkende `DAHUA_CGI`-eventstream is een aanvullend alternatief. Een HTTP 200 op die stream bewijst geen ITSAPI-upload. De oudere naam “Dahua Native ANPR (ITSAPI)” was onjuist en is gecorrigeerd.

De ITSAPI-ontvanger werkt als begrensde **diagnostische ontvanger**, onafhankelijk van de browser. Er is nog geen geverifieerde registratie-, heartbeat- of passageparser voor deze firmware. Hij geeft onbekende berichten HTTP 501 `PROTOCOL_NOT_VERIFIED`, ook wanneer Digest klopt. Hij geeft geen verzonnen succes-ACK. Ontvangen structuren zijn geen duurzame passage-inbox: scalars en beelden worden niet bewaard en kunnen niet later tot passages worden gereconstrueerd.

Dit volgt de opdracht om bij ontbrekend protocolbewijs bruikbare infrastructuur af te maken zonder de hardwarekoppeling als voltooid te markeren.

## Bevestigd op de fysieke camera

Gebruiker heeft de instellingen van DHI-ITC413-PW4D-IZ3 gecontroleerd en een screenshot geleverd:

| Onderdeel | Waarde |
| --- | --- |
| Protocol Version | V1.19 |
| Heartbeat Interface | `/NotificationInfo/KeepAlive` |
| ANPR Info Interface | `/NotificationInfo/TollgateInfo` |
| Heartbeat Interval | 300 seconden |
| Registration / Heartbeat | Aan |
| Reupload Times | 2 |
| Type of Upload Content | All |
| Max Keep-alive Request | 0 |
| ANPR Info | Aan |
| Authentication op screenshot | Uit; voor onze ontvanger inschakelen |
| Bestaande Platform Server | `http://192.168.0.1:7070`; dit is niet ons platform |
| Device ID | Bestaande ID behouden; volledige waarde nog niet aangeleverd |

De tekstuele controle meldde Enable uit; het latere screenshot toont Enable aan. Niet vastgesteld of de screenshotinstellingen opgeslagen zijn. Er zijn door de ontwikkelaar geen camera-instellingen gewijzigd.

Primaire bronnen: [Dahua Web 5.0-handleiding, §9.4.9.3](https://material.dahuasecurity.com/uploads/cpq/DOR/PUM0004975/Smart_ANPR_Camera_Web_5.0_Operation_Manual_V1.0.0.pdf) bevestigt HTTP, JSON en Digest, maar bevat geen volledige wire-specificatie. [Productinformatie ITC413-PW4D](https://www.dahuasecurity.com/nl/products/Traffic/Smart-Parking-Products/Access-ANPR-Cameras/ITC413-PW4D-Series). De op de echte camera getoonde paden zijn leidend; andere fabrikanten of synthetische fixtures gelden niet als bewijs voor deze firmware.

## Werkelijk netwerk en poorten op deze installatie

- De gedeelde ontvanger draait in het bestaande API-proces, op `0.0.0.0:7070` binnen de API-container.
- Docker kan Windows-poort 7070 niet publiceren: `Get-NetTCPConnection` wees PID 8908 aan; `Get-Process` identificeerde **AnyDesk**. Dit programma is niet gestopt.
- Daarom bevat de lokale, genegeerde `.env` **`ITSAPI_PUBLISHED_PORT=7071`**. Docker publiceert `0.0.0.0:7071 → api:7070`.
- Windows Ethernet 3 heeft bij uitlezen `192.168.178.18`; de tweede adapter had een APIPA-adres en is geen kandidaat. Er is geen gebruikersbestand `.wslconfig` aangetroffen; de effectieve netwerkmodus wordt daarmee niet als bewezen aangemerkt.
- Windows heeft de health-response ontvangen via **`http://192.168.178.18:7071/health`**: `listening:true`, `protocolVerified:false`, `cameraConnectionProven:false`.
- **Voorgesteld Platform Server: `http://192.168.178.18:7071`. De admin moet bevestigen dat dit de bedoelde ANPR-pc is.** Het adres wordt niet automatisch op camera’s ingevuld.
- Dit bewijst interne werking en bereikbaarheid vanaf Windows. Bereikbaarheid vanuit de fysieke camera en een geldige cameraregistratie zijn nog niet bewezen.

De repository-default blijft 7070; de configuratiekaart toont de ingestelde gepubliceerde poort. Voor toekomstige VPN-camera’s gebruikt de admin het door die camera bereikbare LAN-/VPN-serveradres en dezelfde gedeelde ontvanger. RTSP gaat platform → camera; ITSAPI gaat camera → platform. Een van beide bewijst de andere niet. Controleer overlappende subnetten bij bestaande VPN-locaties; er worden geen routes of subnetten gewijzigd.

Lees zo nodig [Microsoft WSL-netwerkdocumentatie](https://learn.microsoft.com/en-us/windows/wsl/networking) en [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/). Er is geen router-portforwarding nodig als standaardoplossing. Database en Redis blijven intern.

## Instellingen overnemen en eerste hardwaretest

1. Laat **ITSAPI Enable uit** zolang adres en uploadinlog niet compleet zijn. Als Enable van de screenshot is opgeslagen, zet het voorlopig handmatig uit.
2. **Laat de werkende camera op DAHUA_CGI staan.** Voor protocolonderzoek gebruik je een apart, inactief ITSAPI-concept in de wizard met de bestaande Device ID. Conceptuploads maken geen passages of hits. Schakel de werkende camera pas om nadat registratie, heartbeat, payloadmapping en ACK bewezen zijn; de huidige ontvanger is daar nog niet klaar voor.
3. Open voor dat ITSAPI-concept **Diagnose → ITSAPI-uploadinstellingen** als admin. Vul het bevestigde serveradres, V1.19 en de volledige bestaande Device ID in. Kopieer de volledige ID in het cameraveld met Ctrl+A/Ctrl+C; wijzig hem niet. Vul geen afgekapt ID-fragment in.
4. Sla de uploadinstellingen op. Klik **Uploadwachtwoord tonen**. Neem de afzonderlijk gegenereerde upload-gebruikersnaam en het uploadwachtwoord over. Dit is niet de bestaande camera-admininlog. Secrets worden alleen via deze geautoriseerde no-store-actie getoond; raadpleeg ze niet via logs of Git.
5. Zet **Authentication aan** in de camera en neem die uploadinlog over. Houd Registration en Heartbeat aan, interval 300, en beide bevestigde paden ongewijzigd. De exacte registratie-URL is nog onbekend; verzin daarvoor geen pad.
6. Data: ANPR Info aan; behoud Plate No., Vehicle Color, Logo, Vehicle Type, Driving Direction, Time, Location. Zet Accuracy aan als je die informatie wilt ontvangen; confidence-schaal is nog niet geverifieerd. Vehicle in Blocklist mag mee als metadata, maar onze eigen watchlist bepaalt hits. Geen synchronisatie naar de camera.
7. Picture: vink **Original Image**, **Plate Cutout** en **Vehicle Body Cutout** aan. Laat **Unlicensed Vehicle** voor de eerste test uit. Behoud Encoding Format **UTF8**. Deze instelling is geen bewijs dat alle drie beeldtypen worden geleverd; ze worden pas na een echt verzoek bevestigd. Parking Info en Barrier Opening zijn niet nodig. Device Basic Info kan later bij de protocoltest worden ingeschakeld, zonder een zelfverzonnen endpoint.
8. Schakel in het platform **Structuurdiagnose 15 minuten** in. Als adres en authenticatie compleet zijn en de ontvanger draait, mag Enable **tijdelijk voor protocolonderzoek** aan. Dit is nog geen productiekoppeling: de ontvanger zal onbekende berichten met 501 afwijzen en de camera kan herhalen. Zet Enable na de korte capture weer uit. Laat de camera-instellingen niet urenlang onbevestigd proberen.
9. Observeer eerst een request op `/NotificationInfo/KeepAlive`; wacht ten minste één ingesteld interval. De eerste 401 is de normale Digest-challenge. Een daaropvolgende geverifieerde handtekening bewijst alleen de uploadinlog. Registratie, Device ID en geldige heartbeat blijven onbevestigd zolang de parser ontbreekt. Geen ontvangst bewijst geen firewallfout.
10. Lever de begrensde structuurdiagnose en de officiële **ITSAPI V1.19 integratiespecificatie** of een verantwoord geschoond echt request/responsevoorbeeld aan. Nodig: methode, registratiepad, Device-ID-veld, heartbeat-/ANPR-schema, tijdzone, confidence-schaal, beeldcodering/relatie en exacte ACK. Authorization en wachtwoorden niet meesturen. Een schema zonder waarden is op zichzelf niet altijd voldoende om betekenis te verifiëren.
11. Pas na implementatie en tests van die gegevens: echte geldige heartbeat aantonen, daarna één voertuig door de camera laten herkennen. Controleer eerst in de camera dat de passage daar bestaat; controleer vervolgens `/NotificationInfo/TollgateInfo`, opgeslagen velden en werkelijk ontvangen beelden, Live passages en Zoeken.
12. Maak daarna uitsluitend met een expliciete test-watchlistmatch een hit. Test optioneel push en controleer het bedoelde toestel zelf. Een pushdienst die een melding accepteert bewijst geen zichtbare telefoonmelding. Test vervolgens uitschakelen/inschakelen en herstel na korte onderbreking. Deze hardwarestappen zijn nog niet uitgevoerd.

Als er geen verzoek binnenkomt: controleer Platform Server, Enable, Authentication, de gekopieerde uploadinlog, adres/poort, routering en pas daarna een gerichte firewallregel. Voor deze lokale camera kan de admin indien nodig in verhoogde **Windows PowerShell** uitvoeren (alleen op een passend Private-netwerk):

```powershell
New-NetFirewallRule -DisplayName "ANPR ITSAPI camera 192.168.178.248" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 7071 -RemoteAddress 192.168.178.248 -Profile Private
```

Dit is slechts een voorstel; deze regel is niet automatisch uitgevoerd en er is geen firewallfout vastgesteld. Voor VPN-bronnen moet de werkelijk gebruikte bronroute/source-IP eerst worden vastgesteld; maak geen onbeperkte Internet-regel.

## Implementatie en beveiliging

- Per camera een versleuteld uploadwachtwoord; Digest realm `ANPR-ITSAPI`, MD5 met `qop=auth`, HMAC-getekende nonce van 5 minuten. Geen anonieme inname. Nonce-count wordt atomair in PostgreSQL bewaakt, ook over gelijktijdige requests. Firmware-compatibiliteit van deze Digest-variant moet nog met de camera worden bewezen.
- Maximaal 16 MB per request, 15 seconden requesttime-out, 4 gelijktijdige uploads, 60 requests/minuut per bron-IP. Camera’s achter hetzelfde VPN/NAT-adres delen deze rate limit. Grote JSON wordt binnen deze grens in het API-proces verwerkt; toekomstige beeldverwerking/normalisatie hoort in een worker, niet in de HTTP-handler.
- Alleen geauthenticeerde onbekende berichten krijgen een begrensde structuurregistratie. Maximaal 32 inboxregels per camera, 24 uur bewaring; extra structuurcapturing maximaal 15 minuten, alleen admin. Alleen veldnamen/typen, geen scalars, kentekens, Authorization, tokens, afbeeldingsdata of opgehaalde URL’s. Geen externe afbeeldingsfetches.
- Onbekende heartbeat en ANPR-paden krijgen verschillende `kind`-labels met `_UNVERIFIED`. Registratie is apart zichtbaar als niet getest. Geen succesvolle ACK totdat het daadwerkelijke protocol en duurzame verwerking zijn geïmplementeerd.
- Een concept is zeven dagen hervatbaar via draft-ID/UUID; alleen deze niet-geheime identifiers staan in sessionStorage. Workers en simulator sluiten concepten uit. PATCH kan een concept niet activeren. Afronden is een afzonderlijke adminactie. Cleanup verwijdert verlopen conceptcredentials en records zonder historie.
- Diagnose heeft configuratieversie, testtijd, laatste succes, waarneming, foutcode, mogelijke oorzaken en herstelactie. Wijzigingen laten oud bewijs vervallen. Beeldtest gebruikt een nieuwe FFmpeg/RTSP-over-TCP-sessie en vereist werkelijk gedecodeerd JPEG-uitvoer; alleen streammetadata geeft geen succes. Snapshotopslagfout blijft apart van videodecodering.
- Verwijderen vereist server-side adminrechten. De camera wordt gearchiveerd vanwege bestaande historische FK-relaties; actieve configuratie, camera-/uploadcredentials, zones, deviceverbindingen en diagnose-inbox worden verwijderd. Runtimeworkers stoppen na de configuratierefresh; late opslag kan de camera niet reactiveren. Schakel ITSAPI op de fysieke camera daarna zelf uit.
- Simulator blijft duidelijk DEMO. Hits worden wel door de eigen watchlist bepaald; push staat standaard op SKIPPED en vereist een expliciete keuze.
- CGI fallback-deduplicatie gebruikt exacte gebeurtenisidentiteit in plaats van een kort kenteken/tijdvenster; de bestaande PostgreSQL-unique constraint en cameravergrendeling beschermen gelijktijdige verwerking.

De feitelijk werkende keten en de drie ontvangen CGI-beelden staan beschreven in [groepshits en dashboard](group-hit-dashboard.md). Die waarneming bewijst geen ITSAPI-payloadmapping.

## Expliciete TODO’s vóór productie-ITSAPI

1. Officieel V1.19-profiel met gevalideerde Device ID, registratie en heartbeat; alleen de juiste camera mag groen worden.
2. Volledige/partiële ANPR-mapping, nullable ontbrekende metadata, oorspronkelijke en ontvangen tijd, zichtbare onbekende tijdzone en bevestigde confidence-schaal. CGI-normalisatie is geen bewijs voor ITSAPI.
3. Duurzame verwerkingsinbox met bewezen ACK en worker-retries/herstel. De huidige structuurdiagnose is geen opnieuw verwerkbare eventopslag.
4. Beeldextractie met bewezen codering, herkomst/tijdstip en aanvullen van laat ontvangen beelden aan dezelfde passage.
5. Protocolspecifieke eventidentiteit die hergebruik na reboot onderscheidt. De huidige CGI-EventID-route moet ook bij firmware die IDs hergebruikt verder worden onderbouwd.
6. End-to-end ITSAPI → passage → eigen watchlist → hit → push; optionele vastlegging van door de gebruiker bevestigde toestelontvangst. Er is nog geen gebruikersbevestigingsfunctie voor toestelontvangst.
7. Echte camera-, VPN- en hersteltests. Synthetische testresultaten vullen deze hardwarestatussen niet in.

## Starten en testen

Werk vanuit `/home/edwin/projects/anpr-platform`. Bestaande `.env` en `CAMERA_CREDENTIALS_KEY` behouden. Voor deze Windows-installatie staat `ITSAPI_PUBLISHED_PORT=7071`; geen geheim. Een nieuwe installatie gebruikt `.env.example` en controleert eerst poortbeschikbaarheid.

```bash
cd /home/edwin/projects/anpr-platform
docker compose config --quiet
docker compose build api web video-worker anpr-worker
docker compose run --rm --no-deps api npm run db:migrate
docker compose up -d --no-deps api web video-worker anpr-worker
```

De laatste twee commando’s veronderstellen de reeds draaiende PostgreSQL/Redis uit dit project. Voor een nieuwe installatie: `docker compose up -d` volgens de README.

```powershell
Invoke-RestMethod -Uri "http://192.168.178.18:7071/health" -TimeoutSec 5
```

Checks met de Node-omgeving uit Docker, zonder Windows-npm te gebruiken:

```bash
docker run --rm -v /home/edwin/projects/anpr-platform:/app -w /app anpr-platform-api sh -c 'npm run db:generate && npm run typecheck && npm run lint && npm test && npm run build'
```

Integratie uitsluitend in de aparte database, zonder productiedispatcher. De scripts weigeren andere databasenamen en ruimen hun eigen fixtures op:

```bash
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" anpr_native_test'
docker compose run --rm --no-deps -v /home/edwin/projects/anpr-platform:/app api sh -c 'export DATABASE_URL="${DATABASE_URL%/*}/anpr_native_test"; npm run db:migrate && npx tsx scripts/native-anpr-smoke.mts && npx tsx scripts/itsapi-smoke.mts && npx tsx scripts/group-hit-smoke.mts'
```

Als de testdatabase al bestaat, sla het `createdb`-commando over. Geen reset of volumeverwijdering uitvoeren.

## Migratie en herstel

Nieuwe aanvullende migratie: `20260911000200_itsapi_receiver_drafts`. Bestaande camera’s krijgen `isDraft=false`, `configVersion=1`; bestaande providerinstellingen blijven behouden. Nieuwe tabellen: `ItsapiRegistration`, `ItsapiDigestReplay`, `ItsapiInbox`.

Herstelpunt vóór deze opdracht: **`c3c2fc7`**. Voor de lokale migratie is een private dump gemaakt in `data/before-itsapi-20260912.dump` (genegeerd door Git); bewaar die vertrouwelijk. Deze dump en de bestaande encryptiesleutel horen bij elkaar. Geen automatische terugzetactie uitgevoerd.

Voor codeherstel zonder werk kwijt te raken: maak een aparte branch/worktree op het herstelpunt of gebruik na beoordeling `git revert` van de oplevercommit; gebruik geen `reset --hard`. De aanvullende databasekolommen mogen bij terugkeer naar oude code blijven staan. Stop eerst nieuwe ITSAPI-inname en behoud de huidige database/historie. Databaseherstel alleen in een afzonderlijke herstelopstelling of na expliciete toestemming; overschrijf de actuele database niet stilzwijgend.
