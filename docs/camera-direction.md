# Camerarichting

Het platform bewaart INCOMING, OUTGOING of UNKNOWN bij de passage. Hitweergave en push gebruiken dezelfde opgeslagen richting.

**Camera's → camera bewerken → Richting omkeren** wisselt inkomend en uitgaand om voor nieuwe passages van die camera. Ook beschikbaar bij toevoegen, standaard Uit. UNKNOWN blijft altijd UNKNOWN. Oude passages en hits worden niet herschreven.

De schakelaar hergebruikt het bestaande Camera.directionMapping:

- Uit: TOWARD_CAMERA_IS_INCOMING (bestaande veilige default);
- Aan: AWAY_FROM_CAMERA_IS_INCOMING.

Bij CGI meldt `TrafficCar.DrivingDirection[0]` een expliciete beweging, bijvoorbeeld Approach/Leave. De bestaande mapping bepaalt welke beweging als inkomend geldt. Bij ITSAPI zijn in productie `Picture.SnapInfo.Direction=Obverse/Reverse` waargenomen. Alleen dat profiel vertaalt deze tokens naar de bestaande mappingconventie: met Uit wordt Obverse Inkomend en Reverse Uitgaand. Dit is geen universele fysieke lensrichting; test de montage en zet zo nodig omkeren aan.

Niet-herkende waarden, numerieke enums zonder bevestigde betekenis en ontbrekende richting blijven UNKNOWN. De oude vaste Camera.direction is geen fallback. De simulator ontvangt rechtstreeks een genormaliseerde richting en bewijst geen Dahua-parsing.

De camera-PATCH behoudt rechten, audit en configVersion. De gebruikte mapping blijft bij nieuwe ITSAPI-passages in metadata beschikbaar. Geen nieuwe migration nodig. Zie [ITSAPI-productieonderzoek en testplan](itsapi-direction-fix.md) en het [eerdere CGI-historieonderzoek](dahua-direction-investigation.md).

De bestaande tijdelijke ITSAPI-debugperiode toont uitsluitend begrensde richtingvelden en toegestane tokens/typen; geen vrije tekst, kentekens, beelden of credentials. CGI bewaart begrensde directionEvidenceJson zonder wegnamen.
