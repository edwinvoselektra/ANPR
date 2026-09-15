# Camerarichting

De camera meldt een fysieke beweging ten opzichte van de lens: `TOWARD_CAMERA` of `AWAY_FROM_CAMERA`. Per camera bepaalt `directionMapping` hoe het platform die bronwaarde omzet:

- `TOWARD_CAMERA_IS_INCOMING`: naar de camera toe wordt **Inkomend**;
- `AWAY_FROM_CAMERA_IS_INCOMING`: van de camera af wordt **Inkomend**.

Een ontbrekende of niet-herkende bronrichting wordt **Onbekend**. Het platform gebruikt daarvoor geen oude algemene camerawaarde als gok. De simulator ontvangt al een genormaliseerde keuze (**Inkomend**, **Uitgaand** of **Onbekend**) en past de fysieke mapping niet toe.

De migratie voegt alleen de configuratiekolom toe. Bestaande passages en hits worden niet achteraf aangepast. Pushmeldingen gebruiken de genormaliseerde richting die bij de passage is opgeslagen.
