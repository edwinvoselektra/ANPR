# Camerarichting

De camera meldt een fysieke beweging ten opzichte van de lens: `TOWARD_CAMERA` of `AWAY_FROM_CAMERA`. Per camera bepaalt `directionMapping` hoe het platform die bronwaarde omzet:

- `TOWARD_CAMERA_IS_INCOMING`: naar de camera toe wordt **Inkomend**;
- `AWAY_FROM_CAMERA_IS_INCOMING`: van de camera af wordt **Inkomend**.

Een ontbrekende of niet-herkende bronrichting wordt **Onbekend**. Het platform gebruikt daarvoor geen oude algemene camerawaarde als gok. De simulator ontvangt al een genormaliseerde keuze (**Inkomend**, **Uitgaand** of **Onbekend**) en past de fysieke mapping niet toe.

De migratie voegt alleen de configuratiekolom toe. Bestaande passages en hits worden niet achteraf aangepast. Pushmeldingen gebruiken de genormaliseerde richting die bij de passage is opgeslagen.


## Veldselectie en veilige diagnose

CGI probeert `TrafficCar.DrivingDirection[0]` en de bestaande `Direction`-velden. Alleen expliciete ondersteunde tekst (`Approach`, `Leave` en de bestaande tekstaliassen) levert een fysieke richting op. `DrivingDirection[1]`/`[2]` zijn geen travel-enums en worden niet als richting gelezen. Botsende bekende richtingen geven UNKNOWN. ITSAPI blijft op het Picture-profiel `SnapInfo.Direction`; andere veldlayouts worden eerst veilig onderzocht.

De lokale camera leverde in bewaarde metadata steeds string `"0"`. Oudere OUTGOING-records kwamen uit de inmiddels verwijderde camerafallback. Nieuwe code maakt van `0`, `1`, `2`, `Obverse`, `Reverse`, `Head`, `Approaching` of `Leaving` geen onbewezen fysieke richting. De huidige mapping van deze camera moet nog met een passage in beide fysieke richtingen worden geverifieerd. Zie [volledig onderzoeksrapport](dahua-direction-investigation.md).

Nieuwe CGI-metadata bevat `rawDirectionField`, `directionStatus` en een begrensde `directionEvidenceJson` zonder vrije tekst of wegnamen. De bestaande tijdelijke ITSAPI-debugperiode logt alleen toegestane richtingwaarden en typen; onbekende waarden worden weggelaten. Zonder ingeschakelde debugperiode worden die waarden niet naar het receiverlog geschreven.
