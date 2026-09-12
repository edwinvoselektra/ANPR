# Groepshits, dashboard en Dahua-beelden — 12 september 2026

## Hervatting en concrete oorzaak

Het werk is hervat in de bestaande working tree op herstelpunt `c3c2fc7`. De eerdere sessie had de ITSAPI-ontvanger, conceptwizard en diagnose grotendeels gebouwd, met nog open controles en hardwareverificatie. De aanvullende opdracht over groepshits is daarop voortgezet. Geen reset, wijziging van fysieke camera-instellingen of verwijdering van bestaande testdata uitgevoerd.

Bij alleen-lezen controle van de lokale ontwikkeldata waren echte `DAHUA_CAMERA`-passages, Hit-records, gekoppelde HitGroup-redenen en SENT-pushregistraties aanwezig. De actieve camera gebruikt **DAHUA_CGI**. ITSAPI-registraties en inbox waren leeg. De door de gebruiker bevestigde Windows-push hoort dus bij de bestaande CGI-keten; de bron `DAHUA_CAMERA` onderscheidt het transport niet.

De groepsmatching gebruikte al `PlateGroupMember.active`, geldigheidsperiode en `PlateGroup.active/hitEnabled`. Er bestaat geen onafhankelijke individuele hitregel. Die werking is behouden en met integratietests onderbouwd.

De aantoonbare dashboardproblemen:

- Het dashboard haalde gegevens alleen bij openen op; Live passages gebruikte al polling iedere drie seconden.
- De teller gebruikte lokale middernacht van de server; de lijst had geen dagfilter. Tijdzone en selectie konden daardoor verschillen.
- De lijst las alleen de primaire groep en toonde de gekoppelde groepen/redenen niet.
- Teller en lijst werden zonder gemeenschappelijke databasesnapshot gelezen.

Geen filter gevonden dat groepshits als categorie uitsloot. De oplossing zit in de query, verversing en verwerking van de bestaande Hit-relaties.

## Resultaat

- `Hit` is de bron voor de dagteller en de laatste vijf hits van diezelfde dag. Beide gebruiken `Hit.timestamp`, dezelfde halfopen daggrens in Europe/Amsterdam en een RepeatableRead-transactie. Ook dagen van 23/25 uur zijn getest.
- De bestaande hitlijst blijft alle historie tonen. Een latere wijziging van groepsregels verwijdert geen bestaande Hit.
- Dashboard ververst elke drie seconden, zonder overlappende requests. Alle vier passage-/hitonderdelen verversen samen; een tijdelijke fout houdt de laatst ontvangen gegevens zichtbaar.
- Iedere kaart toont kenteken, camera, datum/tijd, maximaal twee groepen met redenen en zo nodig `+N`; doorklikken toont alle groepen.
- Demo telde al mee. Dit is behouden met afzonderlijke demo-aantallen en badges, zonder demo als echte detectie voor te stellen. Simulator-push vereist een expliciete keuze.
- Duplicaten gebruiken bestaande eventidentiteit en PostgreSQL-vergrendeling/unique constraint. De fallback gebruikt exacte camera/kenteken/tijd/lane-identiteit; twee aparte passages binnen 500 ms blijven apart.
- De pushroute blijft behouden. Een herhaalde dispatch van een reeds verzonden melding houdt de Hit op SENT en verstuurt niet opnieuw. SENT betekent dat de pushdienst het aanbod accepteerde, geen bewijs van zichtbare toestelontvangst.
- Hitdetails tonen ook de voertuiguitsnede en metadata-/beeldstatus. Een ontbrekend, ongeldig of niet opgeslagen beeld krijgt geen verzonnen foto. Een ontbrekend ondersteund voertuigtype blijft UNKNOWN met een diagnostische reden.
- Cameradiagnose toont de laatste opgeslagen CGI-passage, beelden, eventuele Hit en pushstatus afzonderlijk van de onbewezen ITSAPI-stappen. Historisch bewijs wordt als historie aangeduid, niet als bewijs van de huidige configuratie.

## Werkelijk ontvangen beelden en metadata

Een echte CGI-stream leverde `SceneImage.Offset/Length`, `Object.ObjectType=Plate` met `Object.Image.Offset/Length`, en `Vehicle.Image.Offset/Length`. `CommInfo.VehicleBody` wees naar dezelfde voertuiguitsnede. Eén multipart `image/jpeg` bevatte drie samengevoegde JPEGs:

| Beeld | Offset | Lengte |
| --- | ---: | ---: |
| Original | 0 | 932859 |
| Plate Cutout | 932859 | 7540 |
| Vehicle Body Cutout | 940399 | 228521 |

De JPEG-start- en eindmarkeringen zijn op de werkelijk opgeslagen bytes gecontroleerd. De nieuwe splitter is ook rechtstreeks op deze bestaande bytes getest, zonder de database te wijzigen. De eerdere parser sloeg deze volledige multipart-body alleen als overzicht op; een browser toont daarvan het eerste JPEG. Dat verklaart ontbrekende afzonderlijke uitsneden ondanks aanwezige bytes.

Nieuwe verwerking controleert veilige integer-offsets, lengte, bounds en JPEG-markeringen. Identieke bytes worden per event slechts eenmaal opgeslagen. De testfixtures gebruiken de waargenomen veldstructuur met volledig synthetische beeldbytes; echte kentekenfoto's staan niet in Git. Historische passages worden niet aangevuld. Dit bewijst de samengestelde CGI-body van deze camera; ondersteuning van andere multipart-indelingen of ITSAPI-beeldcodering wordt niet geclaimd.

De huidige mapper ontving kleur, merk, confidence en richting. Voor voertuigtype waren andere veldnamen aanwezig dan de ondersteunde typevelden; hun betekenis is niet geraden. De mapper bewaart de gebruikte oorspronkelijke type-/kleur-/richtingswaarden met de genormaliseerde passage en vermeldt een ontbrekende of onbekende typemapping.

De camera leverde UTC en RealUTC aanvankelijk met **3600 seconden verschil**; bij de latere controle was ook 3599 en 7200 seconden verschil zichtbaar; opgeslagen tijdstippen lagen bij de inspectie circa een uur voor het ontvangsttijdstip. De bestaande UTC-voorkeur en historische tijdstippen zijn behouden omdat de firmwarebetekenis en zomer-/wintertijd nog niet vastgesteld zijn. Nieuwe metadata toont dit verschil als waarschuwing. De Amsterdam-daggrens lost een foutieve cameraklok niet op.

## Bestanden en migratie

- API: `routes/dashboard.ts`, `routes/hits.ts`, `lib/application-time.ts`, `lib/public-hit.ts`, `lib/notification-dispatcher.ts` plus tests.
- Worker: `providers/dahua-images.ts`, `dahua-parser.ts`, `dahua.ts`, `passage-service.ts` plus tests.
- Web: dashboard, hitdetails, `lib/api.ts` en compacte kaartstijl.
- Eerdere ITSAPI-/wizardwijzigingen: `itsapi-receiver.ts`, `routes/camera-onboarding.ts`, protocol/Digest/diagnosehelpers, camerabeheer, wizard/diagnosecomponenten, configuratie en tests; zie [ITSAPI-documentatie](itsapi-receiver.md).
- Aanvullende migratie `20260911000200_itsapi_receiver_drafts` is lokaal toegepast. Geen aanvullende migratie nodig voor groepshits, dashboard of beelden. Geen database-reset of historische reparatie.

## Automatische controles

Typecheck, lint, alle **263 tests**, volledige applicatiebuild, vier lokale Dockerbuilds en Compose-validatie zijn geslaagd. De drie integratiescripts voor groepshits, native inname/verwijderen en ITSAPI zijn geslaagd. Prisma-schema geldig; negen migraties gecontroleerd en geen open migraties in de testdatabase. De eerder aangetroffen schema-diff betreft een bestaande Notification.updatedAt-default, niet de aanvullende ITSAPI-tabellen; geen ongevraagde schemawijziging toegepast.

Browsercontrole: dashboard desktop/mobiel, automatische verversing, groepscontext en hervatten van het bestaande concept zijn gecontroleerd. Een kleine mobiele overloop is verholpen; documentbreedte is nu gelijk aan de viewport. De nieuwste echte hit is via HTTPS geopend: alle drie afbeeldingen laden, ook op 390 px mobiel. CGI-diagnose toont opslag/beelden/watchlist/pushaanbod geslaagd en ITSAPI apart uitgeschakeld. De aanvullende publieke HTTPS-/sessiecontrole staat in [externe testomgeving](external-https-test.md). Lokale logs en screenshots in `data/` zijn genegeerd.

Regressies dekken HIT uit/aan, één Hit met twee groepen/redenen, herhaald/concurrent event, één push per device en stabiele SENT-status, dashboard na groepswijziging, Amsterdam/daggrenzen, polling en gegevensbehoud bij tijdelijke fouten, drie JPEG-uitsneden, ongeldige offsets, beeldopslagfout, admin-delete met behouden historie, concept hervatten, Digest/replay/quarantaine en geen vals ITSAPI-succes.

Test 8 (onafhankelijke individuele hitregel) is niet van toepassing: dat model bestaat niet. Test 6 wordt op de bestaande genormaliseerde passageketen uitgevoerd. Het is geen succesvolle ITSAPI-TollgateInfo-test: die parser ontbreekt nog. Bij een daadwerkelijk ingestelde Digest-upload worden onbekende ITSAPI-verzoeken bewust afgewezen met 501.

Exacte herhaalcommando's, vanuit de projectmap (de aparte testdatabase bestaat al):

```bash
docker run --rm -v /home/edwin/projects/anpr-platform:/app -w /app anpr-platform-api sh -c 'npm run typecheck && npm run lint && npm test && npm run build'
docker compose config --quiet
docker compose run --rm --no-deps -v /home/edwin/projects/anpr-platform:/app api sh -c 'export DATABASE_URL="${DATABASE_URL%/*}/anpr_native_test"; npm run db:validate && npm run db:migrate && npx tsx scripts/native-anpr-smoke.mts && npx tsx scripts/itsapi-smoke.mts && npx tsx scripts/group-hit-smoke.mts'
```

De scripts ruimen uitsluitend hun nieuwe fixtures op. Globale concept-/replaycleanup wordt niet door de integratietest aangeroepen, om bestaande testdata te behouden. Replaybewijzen verlopen volgens de gewone bewaartermijn.

## Praktijktest zonder de werkende camera om te schakelen

1. Laat de bestaande camera op **DAHUA_CGI** staan en wijzig haar credentials, RTSP, fysieke ITSAPI-instellingen en groepshistorie niet voor deze test.
2. Kies een eigen testkenteken en maak een nieuwe tijdelijke testgroep met HIT aan. Voeg het kenteken als actief lid toe met een herkenbare testreden en geldigheid die nu geldt. Controleer voor push het bestaande abonnement op het bedoelde Windows-/browserdevice; maak geen tweede abonnement.
3. Open Dashboard en Live passages. Laat dat voertuig eenmaal door de echte camera herkennen. Controleer dat de camera zelf één passage registreert.
4. Binnen de volgende dashboardverversing na backendopslag moet één nieuwe Hit verschijnen, met groep en reden; de dagteller stijgt met één. Houd rekening met de waarschuwing over de cameraklok. Demo-aantallen mogen hierdoor niet stijgen.
5. Open de Hit. Controleer kenteken, cameranaam, opgeslagen tijdstip, groep/reden, metadata en de drie afzonderlijke foto's. Bij een ontbrekend beeld moet de diagnose melden of het niet ontvangen, ongeldig of niet opgeslagen is. Controleer één push op het bedoelde device; SENT alleen is geen toestelbewijs.
6. Optioneel: maak een tweede tijdelijke HIT-groep voor hetzelfde kenteken en laat een **nieuwe** passage plaatsvinden. Verwacht één nieuwe Hit met beide groepen/redenen en één bedoelde push per device.
7. Zet uitsluitend de eigen tijdelijke testgroepen na afloop op inactief; behoud de nieuwe testpassages/hits als controlehistorie. Een echte retry/dubbele upload is synthetisch getest; geen camera-event-ID of cameraklok wijzigen om dit op hardware te forceren.

Voor de afzonderlijke, nog onbewezen ITSAPI-koppeling: volg [de instellingen- en heartbeatprocedure](itsapi-receiver.md). Voorgesteld Platform Server is `http://192.168.178.18:7071` (Windows 7070 is bezet door AnyDesk). Behoud Device ID; volledige waarde ontbreekt nog. Authentication gebruikt de afzonderlijk gegenereerde uploadinlog van een inactief ITSAPI-concept. Enable is uitsluitend geschikt voor een korte afgesproken protocolcapture, niet voor productieve ANPR-inname zolang de officiële V1.19-schema's en ACK ontbreken.

## Resterende grenzen

- **Nieuwe echte hardwarepassages zijn ontvangen na de workerwijziging.** De drie laatst gecontroleerde passages hebben overzicht, kentekenuitsnede en voertuiguitsnede afzonderlijk opgeslagen, met status RECEIVED. De nieuwste daarvan (12 september, ontvangst 15:13:59 UTC) heeft één groepshit met pushstatus SENT. Zichtbare ontvangst van die specifieke melding op het bedoelde toestel moet de gebruiker nog bevestigen.
- ITSAPI registratiepad, Device-ID-veld, echte heartbeat/ANPR-payload, beeldcodering, ACK en herstartidentiteit vragen protocolbewijs. Geen fictieve implementatie toegevoegd.
- CGI-EventID-hergebruik na camerareboot en zeer laat aangeleverde losse beeldparts blijven bestaande beperkingen; de nieuwe splitter bewijst alleen de waargenomen samengestelde body.
- Cameraklok/UTC versus RealUTC en niet ondersteunde voertuigtypevelden moeten op de werkelijke firmware worden uitgezocht. Historische data blijven ongemoeid.
- Daarna is op expliciete aanvullende opdracht de bestaande externe HTTPS-testomgeving omgeschakeld naar productiebuilds voor web/API; zie de aparte handleiding. Geen push naar een remote Git-repository uitgevoerd.
