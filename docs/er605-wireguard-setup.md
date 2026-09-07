# TP-Link Omada ER605 WireGuard instellen

Deze handleiding hoort bij Fase 2.4.5. De wizard configureert de ER605 **niet**
automatisch en bewaart geen routergebruikersnaam of routerwachtwoord.

## Benodigd

- TP-Link ER605 V2 of nieuwer
- recente firmware met WireGuard-ondersteuning
- toegang tot ER605 beheer
- internetverbinding
- recorder/camera's op LAN
- centrale ANPR endpoint

Controleer bij TP-Link altijd of de firmware bij uw exacte hardwareversie hoort. De
veldnamen hieronder volgen de officiële ER605-handleiding: `Name`, `MTU`, `Listen
Port`, `Private Key`, `Public Key`, `Local IP Address`, `Interface`, `Endpoint`,
`Endpoint Port`, `Allowed Address`, `Persistent Keepalive` en `Status`.

## Vooraf: gekozen verbindingsrichting

De wizard gebruikt standaard **Mode B**: de ER605 op de externe locatie initieert de
verbinding naar de centrale WireGuard-server. Dit past bij een locatie achter NAT en
vereist geen inkomende WireGuard-poort op de locatie. De centrale server moet wel een
publiek bereikbaar endpoint en UDP-poort (standaard 51820) hebben.

**Mode A** is voorbereid voor situaties waarin de centrale server de ER605 bereikt.
Gebruik die alleen wanneer de ER605 een bewust geconfigureerd bereikbaar endpoint
heeft. De app maakt nooit automatisch port forwarding of UPnP-regels.

## ER605 stap voor stap

1. Sluit de ER605 volgens de TP-Link-installatiehandleiding aan tussen internet en het
   netwerk op de locatie. Laat recorder en camera's op het LAN aangesloten.
2. Open de lokale ER605-webinterface of de Omada Controller en log zelf in. Vul deze
   inloggegevens nergens in het ANPR-platform in.
3. Controleer onder LAN dat router-IP, subnet en DHCP-plan overeenkomen met het in de
   ANPR-wizard ingevulde `Remote LAN subnet`. Geef de recorder bij voorkeur een vast
   IP of DHCP-reservering.
4. Open in standalone beheer **VPN → WireGuard → WireGuard**. In een recente Omada
   Controller staat dit doorgaans onder **Settings → VPN → WireGuard**.
5. Klik **Add** en neem uit ANPR → Locaties → de gekozen locatie →
   **WireGuard-configuratie genereren** exact over:
   - `Name`: `ANPR-<locatienaam>`
   - `MTU`: `1420`
   - `Listen Port`: `51820` (of de door de wizard getoonde poort)
   - `Private Key`: de eenmalig getoonde locatie-private key
   - `Local IP Address`: het toegewezen tunneladres met prefix
   - `Status`: `Enable`
6. Controleer de gegenereerde `Public Key` op de ER605. Die moet gelijk zijn aan
   `Public Key locatie` in de wizard. Deel nooit de private key.
7. Open **VPN → WireGuard → Peers** en klik **Add**.
8. Vul in:
   - `Interface`: de zojuist gemaakte `ANPR-<locatienaam>`-interface
   - `Public Key`: de getoonde publieke sleutel van de centrale ANPR-server
   - `Allowed Address`: het getoonde centrale tunneladres, normaal
     `10.100.0.1/32`
   - `Endpoint`: publieke hostnaam of publiek IP van de centrale server
   - `Endpoint Port`: `51820`
9. Zet `Persistent Keepalive` op `25` seconden wanneer de ER605 de verbinding naar de
   centrale server initieert/achter NAT staat. Bij Mode A toont de wizard `0`.
10. Zet `Status` op `Enable` en sla de interface en peer op. Vul geen fictieve
    preshared key in; deze fase gebruikt de gewone WireGuard-keypairs.
11. Open opnieuw ANPR → **Locaties** → de locatie.
12. Klik **VPN-verbinding testen**. Zonder host-statusadapter kan Tunnel nog
    `Onbekend` tonen; recorder-TCP wordt wel afzonderlijk getest.
13. Controleer of Recorder `Bereikbaar` en RTSP-poort `Open` worden. De test gebruikt
    korte timeouts en scant geen andere adressen of poorten.
14. Klik bij Recorder en kanalen op **Kanaal 1** om de eerste camera vooraf ingevuld
    te openen. Test de RTSP-verbinding in de bestaande camerawizard voordat u opslaat.

## Centrale server op Windows, WSL2 en Docker Desktop

Docker krijgt in deze fase geen `privileged`-modus en geen `NET_ADMIN`. Dat voorkomt
onnodige toegang tot hostnetwerkbeheer. Voor een echte lokale tunnel draait WireGuard
bij voorkeur op de WSL2/Linux-host (of bewust op Windows), buiten de applicatiecontainer.
De centrale host moet forwarding/routes naar de locatie-LANs beheren.

Een laptop achter NAT is niet vanzelf een publiek WireGuard-endpoint. Configureer een
eventuele router/firewall/NAT-regel handmatig en alleen na een bewuste securitykeuze.
De app probeert dit niet met UPnP of automatische port forwarding op te lossen. Voor
productie kan `VPN_SERVER_ENDPOINT` later naar een cloud/Linux-host wijzigen zonder
de locatie-, recorder- of camerakoppelingen opnieuw aan te maken.

## Veilige handshake-statusadapter

De API voert geen willekeurige shellcommando's uit. Optioneel kan een kleine
hosttaak een alleen-leesbaar JSON-bestand schrijven en kan `VPN_STATUS_FILE` daarnaar
wijzen. Formaat:

```json
{
  "10.100.0.2": "2026-09-07T12:34:56.000Z",
  "10.100.0.3": null
}
```

De sleutels zijn tunnel-IP's en de waarden zijn de laatste handshake-tijden. Mount het
bestand read-only in de API-container wanneer Docker het moet lezen. Het bestand bevat
geen private keys, endpoints met credentials of routerwachtwoorden. De concrete
hosttaak is bewust niet automatisch geïnstalleerd, omdat Windows-, WSL- en native
Linux-routing per installatie verschilt.

## Problemen

- `Tunnel: Onbekend`: geen `VPN_STATUS_FILE` ingesteld of geen actuele adapterdata.
- `Tunnel: Online`, recorder niet bereikbaar: controleer centrale route, ER605
  firewall/ACL, recorder-IP en of het recorder-IP binnen `Remote LAN subnet` valt.
- Geen handshake: controleer public keys, endpoint, UDP-poort, `Allowed Address`, tijd
  op beide apparaten en NAT/firewall.
- Twee locaties met hetzelfde LAN-subnet: wijzig één LAN-plan. Overlappende remote
  subnets kunnen niet betrouwbaar via dezelfde centrale routering worden gekozen.

Bronnen: de officiële TP-Link ER605 User Guide, hoofdstuk *WireGuard VPN
Configuration*, en TP-Link FAQ 3933 over site-to-site WireGuard. Firmware kan de plek
in de navigatie wijzigen; de officiële veldnamen blijven leidend.
