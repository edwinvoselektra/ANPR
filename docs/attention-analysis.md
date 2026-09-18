# Aandachtsscore en patroonanalyse

De aandachtsscore beschrijft uitsluitend hoeveel een nieuwe passage afwijkt van de beschikbare historie van hetzelfde genormaliseerde kenteken. De score is geen oordeel over een persoon of voertuig en veroorzaakt geen watchlist-, push- of andere externe actie.

## Transparant scoremodel

De engine gebruikt acht onafhankelijke factoren. Gewichten staan centraal in `ATTENTION_SCORE_CONFIG` en tellen op tot 100%:

| Factor | Gewicht | Betekenis |
|---|---:|---|
| Tijdstip | 25% | Circulaire afstand tot de vijf meest vergelijkbare lokale tijdstippen |
| Weekdag/weekend | 10% | Afwijking van de eigen verdeling tussen werkdagen en weekend |
| Frequentie | 15% | Huidige dagfrequentie tegenover de begrensde 30-dagenbaseline |
| Nacht | 10% | Alleen afwijkend wanneer nachtpassages ongebruikelijk zijn voor dit kenteken |
| Herhaling | 15% | Meerdere duidelijke afwijkingen binnen drie dagen |
| Camera/locatie | 15% | Nieuwe of weinig gebruikte camera of locatie |
| Rijrichting | 5% | Alleen bij een bekende richting en minimaal vijf bekende historische richtingen |
| Reeks/terugkeer | 5% | Afwijkende tijd tussen passages of herhaalde richting |

Historie wordt maximaal 90 dagen en maximaal 5.000 passages gelezen. Waarnemingen tot 7 dagen oud tellen driemaal, tot 30 dagen tweemaal en oudere beschikbare waarnemingen eenmaal. De bestaande retentie blijft de werkelijke bovengrens. Lokale patroonvelden worden met de IANA-tijdzone van de passage berekend; opslag blijft UTC.

De overige eerste-versiedrempels staan naast de gewichten in `ATTENTION_SCORE_CONFIG`: een tijdsverschil van zes uur geldt als volledige tijdsafwijking, de frequentiefactor start boven 1,5× en bereikt zijn maximum bij 4×, en een eerdere score vanaf 25 telt gedurende drie dagen mee als herhaalde afwijking. Eén eerdere afwijking telt licht; twee of meer activeren de volledige herhalingsfactor. Nachtgedrag wordt volledig als baseline beschouwd zodra minstens 40% van het gewogen patroon in het nachtvenster valt. Richting telt pas mee bij minimaal vijf bekende richtingwaarnemingen.

Minder dan vijf historische passages geeft `LOW` en `INSUFFICIENT_DATA`; de voorlopige score wordt dan begrensd op 35. Vijf tot negentien passages geeft `MEDIUM`; vanaf twintig is de confidence `HIGH`.

## Verwerking en opslag

De passage-transactie maakt ook één unieke `AttentionAnalysisJob`. De ANPR-worker claimt taken atomair, verwerkt maximaal tien taken per cyclus en probeert tijdelijke fouten maximaal driemaal opnieuw. Daardoor wacht passage-ingest niet op de historische analyse en blijft werk bij een procesherstart bewaard.

`AttentionSnapshot` bewaart score, confidence, factoruitleg, maximaal vier hoofdredenen en het gebruikte venster. De vervaldatum is gelijk aan die van de bronpassage. Cascade-relaties en periodieke opruiming verwijderen afgeleide data bij fysieke verwijdering, verlopen retentie of een logisch verwijderde passage.

`PatternReview` bewaart een optioneel menselijk label en notitie. Review wijzigt de oorspronkelijke score niet. Alleen administrators kunnen review schrijven; lezen volgt `passages.view`. Reviewmutaties worden geaudit, automatische berekeningen niet.

## API

- `GET /attention/:normalized` — nieuwste beschikbare score;
- `GET /attention/:normalized/history?limit=25` — begrensde historie, maximaal 100;
- `PUT /attention/:snapshotId/review` — ADMIN-review met `NORMAL`, `ATTENTION`, `SUSPICIOUS_PATTERN` of `INSUFFICIENT_INFO`.

De API retourneert geen ruwe passagepayloads, credentials of interne jobdetails.
