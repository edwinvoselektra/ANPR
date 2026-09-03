# Fase 2.4-resultaat — PWA en Web Push

## Wat daadwerkelijk werkt

- De webapp heeft een Nederlands PWA-manifest, standalone-weergave, thema en icoon.
- Een veilige service worker toont pushmeldingen en opent `/hits/<id>` bij aanklikken.
- Iedere ingelogde rol kan eigen apparaten en hitvoorkeuren beheren onder Instellingen.
- Web Push-toestemming wordt alleen na een expliciete klik gevraagd.
- Alle hits of dynamisch gekozen actieve hitgroepen kunnen worden geselecteerd.
- Meerdere apparaten per gebruiker worden ondersteund en afzonderlijk beheerd/getest.
- Simulator- en Dahua-hits krijgen hetzelfde bron-onafhankelijke `PENDING` outboxpad.
- Afleverhistorie bewaart `PENDING/PROCESSING/SENT/FAILED/SKIPPED`, pogingen en een
  veilige foutcategorie; een testmelding maakt geen Hit.
- Verlopen 404/410-abonnementen worden uitgeschakeld; tijdelijke fouten hebben maximaal
  drie pogingen. Pushfouten kunnen passage- of hitopslag niet terugdraaien.
- Systeemstatus toont Web Push als online of niet ingesteld.

## Databasewijzigingen

De normale migratie `20260903000300_pwa_web_push` is toegepast zonder reset of
dataverwijdering. Toegevoegd zijn `NotificationPreference` en
`NotificationPreferenceGroup`. `PushSubscription` heeft apparaatnaam, user-agent,
laatste succes, foutteller en `enabled`. `Notification` ondersteunt testmeldingen,
apparaatkoppeling, deduplicatie, pogingen en foutcategorie.

## API-routes

- `GET /notifications/config`
- `GET /notifications/preferences`
- `PUT /notifications/preferences`
- `POST /notifications/subscriptions`
- `DELETE /notifications/subscriptions/:id`
- `POST /notifications/subscriptions/:id/test`

Alle routes vereisen een geldige sessie. Apparaten worden altijd op `userId` gefilterd.
Endpoint en cryptografische abonnementssleutels worden nooit teruggestuurd.

## VAPID eenmalig instellen

Voer exact uit:

```bash
cd /home/edwin/projects/anpr-platform
docker compose run --rm api npx web-push generate-vapid-keys
```

Kopieer de getoonde waarden naar de bestaande `.env`:

```dotenv
VAPID_PUBLIC_KEY=plak_hier_de_public_key
VAPID_PRIVATE_KEY=plak_hier_de_private_key
VAPID_SUBJECT=mailto:jouw-beheeradres@example.nl
```

Start de vernieuwde containers:

```bash
docker compose up -d --build
```

De private key blijft uitsluitend in `.env`; `.env` wordt door Git genegeerd.

## Eenvoudige handmatige test

1. Open `http://localhost:3000` en log in.
2. Open **Instellingen**.
3. Klik **Meldingen op dit apparaat inschakelen** en daarna browserknop **Toestaan**.
4. Kies **Alle hits** en klik **Voorkeuren opslaan**.
5. Klik bij je apparaat op **Testmelding**.
6. Open **Groepen** en controleer dat `Aandacht` actief is en hitdetectie aan staat.
7. Open **Kentekens** en controleer dat `V84KVJ` (of een ander testkenteken) actief in die groep staat.
8. Open **Demo / simulator**, kies een echte of democamera en simuleer `V84KVJ`.
9. Controleer **Hits** en de pushmelding. Klik de melding; de hitdetailpagina moet openen.
10. Log met een tweede account in op een andere browser/apparaat en herhaal stap 2–4.
11. Simuleer opnieuw: ieder ingeschakeld apparaat hoort precies één melding te krijgen.

Als toestemming eerder geweigerd is: open via het slotje in de adresbalk de site-
instellingen, zet Meldingen op Toestaan en herlaad. Op iPhone/iPad moet de site eerst
via Safari → Deel → Zet op beginscherm als PWA zijn geïnstalleerd. Buiten localhost is
geldige HTTPS vereist.

## Security en privacy

- VAPID private key, pushendpoint, `p256dh` en `auth` staan niet in frontendresponses of logs.
- Pushpayload bevat alleen kenteken, camera, reden en interne IDs/URL; geen afbeelding.
- De hitdetailroute blijft achter de bestaande authenticatie en RBAC.
- Meldingsinhoud kan op een vergrendelscherm zichtbaar zijn; de interface waarschuwt daarvoor.
- Een administrator kan alleen aantallen/statussen later centraal tonen; geheime
  apparaatgegevens zijn ook voor administrators niet beschikbaar via deze API.

## Bekende beperkingen en bewuste TODO's

- De API-outboxdispatcher kan later zonder contractwijziging naar een aparte worker
  worden verplaatst voor horizontale schaalbaarheid.
- Een delivery die exact tijdens een procescrash al extern is verstuurd maar nog
  `PROCESSING` staat, wordt bewust niet automatisch herhaald om dubbele alarmen te voorkomen.
- Er is nog geen in-app ongelezen-teller; Hits en Dashboard blijven de secundaire weergave.
- HTTPS/reverse-proxyproductieconfiguratie valt buiten deze lokale fase.
- Geen SMS, e-mail, Slack/Teams, live videotranscoding, OCR, retentiescheduler of deployment.

## Uitgevoerde controle

Prisma-validatie/migratie, API- en webtests, workerregressietests, TypeScript, lint,
productiebuilds, Compose-configuratie en Docker-build zijn onderdeel van de eindcontrole.
