# Dahua TCP / SDK koppelen

## Wat deze fase werkelijk ondersteunt

Dahua documenteert TCP-poort `37777` als standaard protocol communication port. Het is
een private protocolpoort. Daarom probeert het ANPR-platform geen ongedocumenteerde
loginpayloads of protocollen na te bouwen.

De ingebouwde test controleert veilig:

1. of de hostnaam kan worden gevonden;
2. of het doeladres niet tot geblokkeerde SSRF-doelen behoort;
3. of de gekozen TCP-poort binnen de timeout opent.

Zonder officiële Dahua NetSDK-adapter toont de app daarna:

- netwerk/TCP-poort: bereikbaar of niet bereikbaar;
- authenticatie: niet getest;
- Dahua-apparaat/API: niet bevestigd;
- model, firmware en kanalen: niet tonen;
- capabilities: `UNKNOWN`.

De API retourneert in dit geval bewust geen algemene successtatus, maar
`SDK_NOT_CONFIGURED` met de tekst: “TCP-poort bereikbaar; gebruikersnaam/wachtwoord nog
niet gevalideerd.” Ook bewust foutieve credentials kunnen zonder adapter niet worden
beoordeeld. Dit is geen geslaagde login: alleen netwerkbereikbaarheid is vastgesteld.
Een latere native Linux/Windows-adapter kan `DahuaSdkAdapter.inspect`
implementeren met een officieel verkregen en gelicentieerde NetSDK. Die adapter valt
niet binnen deze repositoryfase.

Officiële bronnen:

- [Dahua NVR netwerkinstellingen en standaardpoorten](https://www.dahuasecurity.com/about-dahua/news-events/notice/nvr-interface-setting-network)
- [Dahua Download Center — SDK-categorie](https://www.dahuasecurity.com/download-center/softwares)

## Handmatige test

1. Open **Camera's**.
2. Klik **Camera toevoegen**. Voor een recorder kan dit ook via **Locaties → Locatie toevoegen**.
3. Kies **Dahua TCP / SDK**.
4. Vul het interne IP-adres of de hostnaam in.
5. Laat de TCP-poort op `37777`, tenzij de recorder anders is ingesteld.
6. Vul gebruikersnaam en wachtwoord in. Deze worden alleen server-side versleuteld opgeslagen.
7. Klik **Dahua TCP/API controleren**.
8. Controleer het resultaat. Zonder NetSDK-adapter hoort alleen **Netwerk/TCP-poort: Bereikbaar** bevestigd te zijn. Apparaat/API is **Niet bevestigd**, authenticatie is **Niet getest** en metadata wordt niet getoond.
9. Is met een officiële adapter een NVR-kanaallijst opgehaald, controleer dan kanaal 1. Zonder adapter vult u het bekende aantal kanalen handmatig bij de recorder in.
10. Open na opslaan de locatie en klik **Kanaal 1** om dat kanaal als afzonderlijke camera toe te voegen.
11. Schakel in de camerawizard desgewenst **Ook RTSP configureren voor videobeeld** in. Het standaard Dahua-pad is alleen een invulvoorbeeld en moet bij het apparaat worden gecontroleerd.
12. Herhaal vanaf de locatiepagina voor kanaal 2.

Open TCP 37777 nooit automatisch naar internet. Gebruik het bestaande VPN-adresplan en
configureer geen UPnP of automatische port forwarding.
