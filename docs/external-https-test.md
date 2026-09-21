# Externe HTTPS-testomgeving met productiebuild

## Aangetoonde oorzaak op 12 september 2026

De publieke HTML gaf 200, maar een JavaScript-chunk met `Origin: https://anpr.vanmilligentechniek.com` gaf extern 403 met body `Unauthorized` en `cf-cache-status: BYPASS`. Exact dezelfde aanvraag rechtstreeks op `http://localhost:3000` gaf ook 403 met dezelfde body. De Next.js-webserver logde:

```text
Blocked cross-origin request to Next.js dev resource ... from "anpr.vanmilligentechniek.com".
Cross-origin access to Next.js dev resources is blocked by default for safety.
```

De geïnstalleerde Next.js 16.3.3-broncode `block-cross-site-dev.js` bevestigt deze status/body. Cloudflare gaf de weigering van de developmentserver door. Sommige CSS-aanvragen zonder Origin gaven wel 200; alleen de HTML of één stylesheet testen is onvoldoende.

Geen DNS-, tunnel-, WAF- of `allowedDevOrigins`-wijziging uitgevoerd. Zie officiële documentatie over [development origins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins) en [standalone-output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## Expliciete externe modus

`docker-compose.external.yml` is een expliciete overlay op de bestaande lokale Compose-configuratie. Beide gebruiken dezelfde bestaande projectnaam, poorten, database en mediavolumes. Het zijn twee alternatieve modi van deze installatie, geen twee gelijktijdige omgevingen. De tunnel blijft naar dezelfde poort 3000 verwijzen.

- Web: bestaande productie-Dockerstage, `next build` en standalone `node apps/web/server.js`. Geen `next dev`, HMR of devtoolsruntime. Turbopack kan de productiebuild compileren; dat maakt de draaiende server geen developmentserver.
- `/api/*` rewrite wordt tijdens de build vastgelegd op `http://api:4000`. Alleen een runtimevariabele instellen is daarvoor niet voldoende.
- API: bestaande productie-Dockerstage, gecompileerde JavaScript, `NODE_ENV=production` en exacte `WEB_ORIGIN=https://anpr.vanmilligentechniek.com`.
- Sessiecookies blijven HttpOnly/SameSite=Strict en krijgen Secure. API-antwoorden krijgen `Cache-Control: private, no-store`; statische buildbestanden behouden hun eigen cacheheaders.
- Web draait als de bestaande niet-root gebruiker. API houdt in deze **testoverlay** de eerdere root-UID: de huidige workers schrijven root-owned 0600-mediabestanden. Zo blijft historische foto- en snapshottoegang werken. Een gezamenlijke niet-root UID voor API/workers vereist een aparte gecontroleerde opslagmigratie; geen brede chmod/chown uitgevoerd.
- Camera-/video-workers blijven ongewijzigd draaien. Geen databasemigratie nodig voor deze wijziging. Bestaande secrets, VAPID-sleutels en media blijven behouden.
- De buildcontext sluit `.env.*`, private `data/` en lokale agentmappen uit.

Build en inschakelen, vanuit de projectmap:

```bash
cd /home/edwin/projects/anpr-platform
docker compose -f docker-compose.yml -f docker-compose.external.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.external.yml build api web
docker compose -f docker-compose.yml -f docker-compose.external.yml up -d --no-deps api web
```

Gebruik bij vervolgacties voor de externe web/API-services steeds beide `-f`-opties. Een gewone `docker compose up` kan anders weer de ontwikkelmodus selecteren.

Bewust terug naar lokale ontwikkeling (niet tegelijk met externe acceptatietests):

```bash
cd /home/edwin/projects/anpr-platform
docker compose build api web
docker compose up -d --no-deps api web
```

De lokale `.env` blijft de lokale `WEB_ORIGIN` bevatten. Gebruik die modus via `http://localhost:3000`. De tunnelconfiguratie wordt hiermee niet aangepast; zolang de tunnel blijft draaien wordt ook die lokale devserver publiek doorgestuurd, en de oorspronkelijke externe dev-originblokkade geldt dan weer. Gebruik daarom de externe overlay zolang publiek getest wordt. Voor gelijktijdige geïsoleerde ontwikkeling is een afzonderlijk project met eigen poorten/database nodig; dat is hier niet automatisch ingericht.

## Verificatie

Leesbare openbare HTTP-controles zonder accountwijzigingen:

```bash
docker compose run --rm --no-deps -v /home/edwin/projects/anpr-platform:/app api npx tsx scripts/external-http-smoke.mts
```

Dit controleert `/`, `/login`, alle uit de pagina's verwezen `/_next/static/*`-bestanden met publieke Origin/Referer, afwezigheid van dev/HMR-chunks, `/api/health=200` en beveiligde API-routes zonder sessie `401`, met `no-store`.

Een aanvullende test gebruikt een nieuw tijdelijk account en controleert werkelijk inloggen over HTTPS, cookie-attributen, sessie opvragen, dashboard, verkeerde origin (403), uitloggen en daarna ingetrokken sessie (401). Deze test wijzigt geen bestaand account, logt geen wachtwoord of cookie en ruimt uitsluitend het eigen tijdelijke account op. De browsercontrole moet tonen dat de loginpagina hydrateert en niet blijft hangen op “Beveiligde omgeving laden...”.

Na omschakelen één keer de publieke pagina opnieuw laden zodat de browser de nieuwe gehashte buildbestanden opvraagt. De bestaande serviceworker cachet geen beveiligde pagina- of API-data. Wijzig geen Cloudflare-regels om oude development-chunks bereikbaar te maken.


## Uitgevoerd resultaat

- Productie-Dockerbuilds web/API en Compose-configuratie: geslaagd. Beide containers healthy; web meldt Next.js zonder dev/HMR en draait met NODE_ENV=production.
- Publiek `/` en `/login`: 200. Alle negen verwezen productie-assets per pagina: 200, met publieke Origin-header. Geen developmentchunks.
- `/api/health`: 200. `/api/auth/me`, `/api/auth/sessions` en `/api/dashboard` zonder sessie: verwacht 401, met no-store.
- Werkelijke HTTPS-login met tijdelijk account: 200; Secure, HttpOnly, SameSite=Strict vastgesteld. Ingelogde me/sessions/dashboard: 200. Verkeerde origin: 403. Logout: 200; ingetrokken sessie: 401. Eigen tijdelijke account opgeruimd.
- Chromium: echte loginpagina en ingelogd dashboard, geen laadblokkade of consolefouten; herhaalde dashboardrequests vastgesteld. Mobiel 390 px: documentbreedte 390 px.
- Nieuwste echte hit via HTTPS: alle drie foto’s laden, mobiele pagina past binnen 390 px. Cameradiagnose houdt CGI-bewijs en ITSAPI-status gescheiden.
- Typecheck, lint en alle 263 unit-/componenttests opnieuw geslaagd na de API-headerwijziging.

Cloudflare DNS, tunnel en WAF zijn ongewijzigd gebleven. Dit is de door de gebruiker aangevraagde externe **testomgeving**; geen remote Git-push uitgevoerd.

## Mobiele sessiestart (21 september 2026)

De publieke omgeving was opnieuw met alleen `docker-compose.yml` gestart en serveerde
daardoor `next dev`, HMR en devtools via de tunnel. Tegelijk kende `AppShell` alleen de
toestanden “laden” en “ingelogd”: een hangende sessieaanvraag of mislukte client-side
redirect na een 401 liet “Beveiligde omgeving laden…” onbeperkt staan.

De sessiestart heeft nu expliciete loading-, authenticated-, unauthenticated- en
errorstates. `/api/auth/me` gebruikt de same-origin proxy, `no-store` en een timeout van
tien seconden. Een 401/403 toont direct een loginmogelijkheid; netwerk-, 500- en
ongeldige responses tonen opnieuw proberen en een gewone `/login`-link. De service
worker heeft geen fetch-handler, wordt met `updateViaCache: "none"` geregistreerd en
`/sw.js` krijgt `no-cache, no-store`, zodat een oude workerupdate niet vier uur via de
publieke cache blijft hangen.

De lokale ontwikkelmodus accepteert voor mutaties uitsluitend de ingestelde weborigin
plus localhost, private LAN-adressen en lokale hostnamen op poort 3000. Productie blijft
beperkt tot de exact ingestelde HTTPS-origin. Developmentcookies zijn host-only,
HttpOnly en zonder `Secure` voor lokaal HTTP; productiecookies blijven host-only,
HttpOnly, SameSite=Strict en Secure. De bestaande standaard van zeven dagen blijft
ongewijzigd.
