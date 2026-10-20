# Camera bewerken: richtingsmapping opslaan

Onderzocht en hersteld op 20 oktober 2026. Bestaande lokale cameravelden zijn alleen-lezen bekeken; er is geen echte camera bijgewerkt en geen productie-deploy uitgevoerd.

## Exacte oorzaak

De actieve lokale camera heeft `description=null`, `latitude=null`, `longitude=null`, `direction=OUTGOING` en een geldige `directionMapping=TOWARD_CAMERA_IS_INCOMING`. De frontend nam de volledige API-camera over in het formulier en stuurde bij iedere wijziging alle instellingen terug.

De concrete blokkerende validatieregel was:

```ts
description: z.string().trim().max(1000).optional()
```

`optional()` staat weglaten toe, maar geen JSON-null. PostgreSQL en de GET-response staan die null wel toe. De oude API gaf bij de reproductie exact terug:

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Controleer de ingevulde gegevens.",
  "fields": { "description": ["Expected string, received null"] }
}
```

Er was geen frontend-validatie die deze specifieke melding veroorzaakte: de melding kwam van de API. De frontend behield wel `ApiError.fields`, maar toonde alleen de algemene melding (uitgezonderd dubbele cameranaam).

Een tweede fout zat in `Number(form.latitude)` en `Number(form.longitude)`: `Number(null)` wordt 0. Daardoor werden ongewijzigde lege coördinaten als echte nulcoördinaten verstuurd. Dit was niet de blokkerende regel, maar kon na het oplossen van de eerste fout onbedoeld configuratie veranderen.

## Requestbody vóór en na de fix

De vóór-fix-regressietest registreerde onderstaande volledige frontendbody. De identificerende waarden zijn synthetisch; de null-velden komen overeen met de alleen-lezen aangetroffen bestaande camera. De testcamera gebruikt ITSAPI zonder RTSP, terwijl de actieve lokale camera CGI gebruikt. Er is geen productie-browserrequest of volledige echte configuratie gelogd.

```json
{
  "name": "Fixture",
  "location": "Fixture",
  "locationId": null,
  "recorderId": null,
  "description": null,
  "direction": "BOTH",
  "directionMapping": "AWAY_FROM_CAMERA_IS_INCOMING",
  "active": true,
  "latitude": 0,
  "longitude": 0,
  "offlineTimeoutSeconds": 120,
  "rtspEnabled": false,
  "connectionMode": "FIELDS",
  "rtspPort": 554,
  "dahuaTcp": null,
  "anprProvider": "DAHUA_ITSAPI",
  "anprHttpProtocol": "http",
  "anprHttpPort": 80,
  "anprChannel": 1
}
```

Lege credentials kregen undefined en werden door JSON.stringify weggelaten. Dat was al correct, maar de transportconfiguratie werd alsnog onnodig opnieuw verwerkt. Bij camera's met oudere enumwaarden of lege niet-nullable strings kon het opnieuw meesturen ook andere veldfouten opleveren.

Na de fix is bij uitsluitend omkeren inschakelen de gehele requestbody:

```json
{"directionMapping":"AWAY_FROM_CAMERA_IS_INCOMING"}
```

Uitschakelen verstuurt uitsluitend TOWARD_CAMERA_IS_INCOMING. Expliciet leegmaken van latitude/longitude verstuurt null; ongewijzigde coördinaten worden weggelaten. Numerieke 0 blijft een geldige echte coördinaat. Onbruikbare of buiten-bereik API-coördinaten blijven een validatiefout geven.

## Verplichte velden, enums en behoud van configuratie

De update gebruikt PATCH, geen PUT. Alle velden van het bestaande update-schema waren al optioneel. De API eist geen nieuwe naam, locatie, host of credentials wanneer alleen directionMapping wijzigt. Aanmaken heeft zijn eigen strengere schema en blijft ongewijzigd.

De HTML-invoervelden voor naam, locatietekst en ingeschakelde Dahua-host hadden required, en numerieke velden hadden bereikgrenzen. De editform gebruikt nu noValidate en laat het API-schema uitsluitend de gewijzigde velden controleren. Zo blokkeert een ongewijzigde legacywaarde geen afzonderlijke wijziging. Een gewijzigde lege naam of locatie blijft via de API ongeldig; validatie is niet uitgeschakeld op de backend.

Frontendtype en backend-PATCH gebruiken de bestaande gedeelde CameraDirectionMapping / CAMERA_DIRECTION_MAPPINGS:

- TOWARD_CAMERA_IS_INCOMING: Richting omkeren Uit;
- AWAY_FROM_CAMERA_IS_INCOMING: Richting omkeren Aan.

De opties waren vóór deze fix al onderling gelijk. De huidige UI noemt het veld **Richting omkeren**; de eerdere UI noemde het **Fysieke richtingsmapping**. De API-key blijft directionMapping. Ongeldige waarden geven nu een specifieke Nederlandse fout voor dat veld. Het formulier toont ook andere API-veldfouten met herkenbare veldnamen bovenaan.

De PATCH-helper stuurt alleen bewust gewijzigde waarden. Ook bij locatiekeuze worden de afhankelijke locatie/recorder/locatietekst meegenomen. Dahua TCP wordt alleen verstuurd wanneer een bijbehorend veld verandert; mapping wijzigen verwijdert of herschrijft de TCP-configuratie niet. Lege RTSP- en TCP-secretvelden worden weggelaten. De bestaande servercode behoudt bestaande encrypted credentials, rechten, audit en configVersion. Geen schemawijziging of migration nodig.

## Bestanden in deze correctie

- `apps/web/app/cameras/[id]/page.tsx`: gewijzigde velden bijhouden, gedeeltelijke PATCH en specifieke foutweergave; bereikbare labels voor coördinaten.
- `apps/web/lib/camera-edit.ts`: PATCH-opbouw en Nederlandse veldnamen.
- `apps/web/app/cameras/direction-setting.test.tsx`: exacte minimale body voor beide mappingopties, null-velden, expliciet lege coördinaten, oude waarden en veldfouten.
- `apps/api/src/routes/cameras.ts`: nullable omschrijving in PATCH, lege coördinaten als null, gedeelde mapping-enum en gerichte foutmelding.
- `apps/api/src/cameras.test.ts`: regressies voor nullable velden, mapping, behoud van credentials/configuratie, onbekende legacyrichting en ongeldige invoer.
- `README.md` en dit rapport.

De eerdere ITSAPI-richtingswijzigingen in de werkboom zijn behouden.

## Verificatie

De vóór-fix-tests faalden aantoonbaar op de null-omschrijving en de te brede frontendbody. Na de fix slagen **262 API-tests** (waarvan 21 cameraregressies) en **73 frontendtests**. Workspace-typecheck, lint en de productiebuilds van shared, API en web slagen. De databaselezing was echt en read-only; updateverzoeken zijn gereproduceerd met de echte route/schema/presentatie en een gemockte database. Er is geen configuratiemutatie op een werkende camera gebruikt om de test te laten slagen.

## Lokaal testen

Bouw de lokale API en webinterface opnieuw zodat de browser en het API-schema dezelfde versie gebruiken:

```bash
cd /home/edwin/projects/anpr-platform
docker compose up -d --build api web
```

1. Open Camera's → bestaande camera bewerken. Laat alle overige velden en alle credentials ongemoeid.
2. Wijzig alleen Richting omkeren en klik Opslaan. Verwacht de groene bevestiging. In browser Network bevat PATCH /api/cameras/<id> uitsluitend directionMapping.
3. Herlaad het scherm: de gekozen waarde moet bewaard zijn. Controleer dat lege coördinaten leeg zijn gebleven en bestaande verbindingen blijven werken.
4. Sla de andere optie op en herlaad opnieuw.
5. Maak desgewenst latitude/longitude bewust leeg: die twee waarden moeten null worden en geen 0. Vul voor een fouttest latitude 91 in: verwacht een melding met het veld Latitude en geen opgeslagen wijziging. Herstel de invoer vóór verder opslaan.
6. Een ongeldige mappingwaarde wordt automatisch in de API-test gecontroleerd; daarvoor hoef je geen productie-instellingen of handmatig HTTP-verzoek te wijzigen.

Geen productie-push of deployment uitgevoerd. Eerst lokaal beoordelen.
