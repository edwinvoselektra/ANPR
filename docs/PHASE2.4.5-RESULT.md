# Resultaat Fase 2.4.5 — VPN-locaties / TP-Link Omada ER605 wizard

Status: geïmplementeerd en lokaal uitgerold op 7 september 2026. Fase 2.5 Live
camera's is niet gestart.

## 1. Nieuwe databasevelden en modellen

- `VpnLocation`: naam, omschrijving, generiek router-/VPN-type, Mode A/B,
  tunneladres, remote LAN, gateway, endpointoverride, poort, MTU, actiefstatus,
  encrypted key, public key en healthstatus/tijden.
- `Recorder`: locatie, naam, IP, RTSP-poort en optioneel aantal kanalen.
- `Camera.locationId` en `Camera.recorderId` zijn nullable. Bestaande standalone
  camera's blijven ongewijzigd.
- Enums: `LocationRouterType`, `VpnType`, `VpnMode` en
  `LocationConnectionStatus` (`UNKNOWN`, `CONNECTING`, `ONLINE`, `DEGRADED`,
  `OFFLINE`).
- Migratie `20260903000400_vpn_locations` is additief toegepast. Foreign keys zijn
  `Restrict`; een locatie met gekoppelde camera's kan niet worden verwijderd.

## 2. Nieuwe Locaties-UI

Het menu **Locaties** bevat overzichtskaarten met router, totaalstatus, tunnel,
recorder, tunnel-IP, remote LAN, camera-aantal en laatste controle. Er zijn pagina's
voor toevoegen, details/configuratie/test en bewerken. Administrator ziet beheeracties;
Operator kan status bekijken via `locations.view`.

## 3. Wizardflow

De Nederlandstalige wizard doorloopt Naam, Router, Netwerk en Controleren. Hij
valideert server-side naam, IPv4, CIDR, poorten, recorder binnen subnet, tunnel-IP en
overlap. Een lokaal/ontbrekend centraal endpoint toont expliciet dat publiek endpoint,
NAT en firewall handmatig geregeld moeten worden. Er is geen routerlogin of fictieve
ER605-API.

## 4. WireGuard-architectuur

De VPN-range en het serveradres komen uit configuratie. De allocator reserveert het
serveradres en alle bestaande locatieadressen. Keypairs zijn X25519/WireGuard raw
base64. De centrale private key en iedere locatie-private key worden met de bestaande
AES-256-GCM-secretlaag encrypted-at-rest opgeslagen.

De centrale private key wordt nooit uitgeleverd. Een nieuwe locatie-private key wordt
technisch noodzakelijk één keer in de directe generatierespons getoond om hem handmatig
in de ER605-interface te plaatsen. Daarna geeft dezelfde endpoint alleen public keys en
configuratiewaarden; gewone locatie-API's geven uitsluitend `hasPrivateKey` terug.

## 5. Gekozen development VPN-opzet

Mode B is standaard: ER605 initieert uitgaand naar de centrale WireGuard-server. Dit is
geschikt voor een locatie achter NAT. Mode A is als configuratiekeuze voorbereid.
WireGuard zelf draait bij lokale Windows → WSL2 → Docker-ontwikkeling op de host, niet
in een geprivilegieerde appcontainer. Docker Compose bevat geen `privileged` en geen
`NET_ADMIN`.

Handshake-status kan via een optionele alleen-lezen `VPN_STATUS_FILE`-adapter komen.
Zonder adapter toont de app eerlijk `Onbekend`; zij verzint geen handshake. Het globale
`VPN_SERVER_ENDPOINT` heeft voorrang op een locatieoverride, zodat verplaatsing naar een
cloudendpoint alle locaties centraal kan omschakelen.

## 6. Securitymaatregelen

- API-beheer vereist `locations.manage`; lezen vereist `locations.view`.
- Administrator krijgt beheer/lezen, Operator alleen lezen, Viewer geen locatierecht.
- Geen routerusername/-password in schema of API.
- Private keys zijn encrypted-at-rest en worden uit auditobjecten/GET-responses
  gefilterd; loggerredactie omvat `privateKey`.
- Geen shell op gebruikersinput, subnet/ping-scan, UPnP of automatische port forwarding.
- Alleen opgeslagen gateway/recorder en specifieke poort worden met korte TCP-timeout
  getest.
- Locatiechecks zijn geïsoleerd met `Promise.allSettled`.

## 7. Tests en resultaten

- API: 16 bestanden, 97/97 tests geslaagd.
- Web: 9 bestanden, 28/28 tests geslaagd.
- Database: 28/28 tests geslaagd.
- Shared: 8/8 tests geslaagd.
- Video-worker: 9/9 tests geslaagd.
- ANPR-worker: 20/20 tests geslaagd.
- API/web/database/workers: TypeScript en lint geslaagd.
- Prisma Validate: geslaagd; migratiestatus: 6 migraties, database up-to-date.
- API-build en Next.js-productiebuild: geslaagd.
- `docker compose config --quiet` en volledige `docker compose build`: geslaagd.
- Runtime: alle zes Compose-services healthy; `/health/ready` is `ready`.
- Visuele browsertest kon niet worden geautomatiseerd omdat `agent-browser` niet op de
  host is geïnstalleerd. Server-rendered login-HTML is wel vanuit de webcontainer
  gecontroleerd; de handmatige UI-test staat hieronder.

## 8. Environment variables

```dotenv
VPN_TUNNEL_CIDR=10.100.0.0/24
VPN_SERVER_ADDRESS=10.100.0.1
VPN_SERVER_ENDPOINT=
VPN_LISTEN_PORT=51820
VPN_HEALTH_INTERVAL_SECONDS=30
VPN_HEALTH_TIMEOUT_MS=2000
VPN_STATUS_FILE=
```

## 9. Bekende beperkingen

- De app installeert/configureert de WireGuard-interface en hostroutes niet.
- Zonder optionele statusfile-adapter is echte handshake-status `Onbekend`.
- `Remote LAN` is afgeleid van de routefout bij de vastgelegde gateway/recorder; er is
  bewust geen subnetbrede scan.
- De ER605/firmware kan navigatie onder standalone of Omada Controller anders tonen.
- Een verloren eerste generatierespons geeft de private key niet opnieuw prijs. Maak in
  dat uitzonderlijke geval bewust een nieuwe locatie/configuratie in plaats van een
  geheim uit de database te exporteren.
- Live browsercamera's/OCR zijn geen onderdeel van deze fase.

## 10. Exacte handmatige ER605-configuratie

Open de locatie in ANPR en klik **WireGuard-configuratie genereren**. Neem de dynamisch
getoonde waarden letterlijk over:

1. ER605: **VPN → WireGuard → WireGuard → Add**.
2. `Name`: `ANPR-<locatienaam>`.
3. `MTU`: `1420`.
4. `Listen Port`: de getoonde poort, standaard `51820`.
5. `Private Key`: de eenmalig getoonde locatie-private key.
6. `Local IP Address`: het toegewezen locatieadres, bijvoorbeeld `10.100.0.2/24`.
7. `Status`: `Enable`; sla op.
8. ER605: **VPN → WireGuard → Peers → Add**.
9. `Interface`: `ANPR-<locatienaam>`.
10. `Public Key`: de getoonde centrale server public key.
11. `Allowed Address`: het getoonde centrale adres, standaard `10.100.0.1/32`.
12. `Endpoint`: het publieke IP/de hostnaam van de centrale server.
13. `Endpoint Port`: standaard `51820`.
14. `Persistent Keepalive`: `25` seconden voor Mode B/ER605 achter NAT.
15. `Status`: `Enable`; sla op.

De complete toelichting staat in [er605-wireguard-setup.md](er605-wireguard-setup.md).

## 11. Zeer eenvoudige handmatige test

1. Sluit de ER605 aan op internet en sluit recorder/camera's aan op het ER605-LAN.
2. Open de ER605-webinterface en log zelf in.
3. Open `http://localhost:3000`, log in als Administrator en kies **Locaties**.
4. Klik **VPN-locatie toevoegen**.
5. Vul als naam `Testlocatie` in.
6. Kies **TP-Link Omada ER605** en laat Mode B geselecteerd.
7. Vul het echte remote LAN in, bijvoorbeeld `192.168.178.0/24`.
8. Vul router-IP, recorder-IP, RTSP-poort `554` en twee kanalen in.
9. Vul het publiek bereikbare centrale endpoint in of laat het leeg en regel eerst
   bewust router/firewall/NAT voor de lokale laptop.
10. Sla op en klik **WireGuard-configuratie genereren**.
11. Kopieer de getoonde eenmalige locatie-private key en publieke/configuratiewaarden
   naar de exact overeenkomstige ER605-velden uit hoofdstuk 10.
12. Sla de ER605-interface en peer op.
13. Klik in ANPR **VPN-verbinding testen**.
14. Controleer Tunnel Online (met statusadapter) en Recorder/RTSP Open.
15. Klik onder Recorder op **Kanaal 1**; de camera opent met locatie, recorder, host,
   poort, kanaal en generiek Dahua-pad vooraf ingevuld.
16. Vul camera-inloggegevens in, test RTSP en sla de camera op.
17. Ga terug naar de locatie, klik **Kanaal 2**, test RTSP en sla ook die camera op.
18. Stop hier en meld de waargenomen tunnel-/recorder-/camerastatus. Start Fase 2.5
   niet.
