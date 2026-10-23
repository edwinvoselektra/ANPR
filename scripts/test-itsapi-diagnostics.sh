#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_container="anpr-itsapi-diagnostics-${RANDOM}-${RANDOM}"
cleanup() { docker rm --force "$test_container" >/dev/null; }
trap cleanup EXIT
docker run --detach --name "$test_container" --publish 127.0.0.1:55440:5432 \
  --env POSTGRES_DB=itsapi_diagnostics_test --env POSTGRES_USER=diagnostics_test \
  --env POSTGRES_PASSWORD=synthetic-test-only --tmpfs /var/lib/postgresql/data:rw,size=256m postgres:16-alpine >/dev/null
ready=false
for attempt in $(seq 1 30); do
  if docker exec "$test_container" pg_isready -U diagnostics_test -d itsapi_diagnostics_test >/dev/null 2>&1; then ready=true;break;fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Tijdelijke diagnosedatabase niet beschikbaar." >&2;exit 1;fi
# No project .env is loaded. The fixture guard refuses every other database and storage path.
export DATABASE_URL='postgresql://diagnostics_test:synthetic-test-only@127.0.0.1:55440/itsapi_diagnostics_test'
export REDIS_URL='redis://127.0.0.1:6379'
export CAMERA_CREDENTIALS_KEY='0000000000000000000000000000000000000000000000000000000000000000'
export NODE_ENV=test WEB_ORIGIN='http://localhost:3400' ITSAPI_PORT=7702 API_PORT=4401
export STORAGE_PATH="$PWD/data/itsapi-diagnostics-test-store"
export VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT=
export ITSAPI_DIAGNOSTICS_INTEGRATION=1
npm run db:generate
npm run db:migrate
npm run build -w @anpr/shared
npx vitest run --root apps/api --configLoader runner src/itsapi-diagnostics.integration.test.ts --maxWorkers 1
if [[ "${1:-}" == "--browser" ]]; then
  test -f data/diagnostics-browser/node_modules/playwright/index.mjs
  API_INTERNAL_URL=http://127.0.0.1:4401 NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 npm run build -w @anpr/web
  mkdir -p data/diagnostics-browser/tmp
  export TMPDIR="$PWD/data/diagnostics-browser/tmp"
  if [[ -d data/diagnostics-browser/runtime/extracted/usr/lib/x86_64-linux-gnu ]]; then
    export LD_LIBRARY_PATH="$PWD/data/diagnostics-browser/runtime/extracted/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  fi
  PLAYWRIGHT_BROWSERS_PATH="$PWD/data/diagnostics-browser/browsers" npx tsx scripts/itsapi-diagnostics-browser.mts
fi
