#!/usr/bin/env bash
# Boots a full local stack for E2E: fresh seeded PostGIS DB → API (dev OTP) → Expo web export → static server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_URL="${E2E_DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/mohalla_e2e?schema=public}"
API_PORT="${API_PORT:-4100}"
WEB_PORT="${WEB_PORT:-8100}"

psql "${DB_URL%%\?*}" -c 'select 1' >/dev/null 2>&1 || psql "$(echo "$DB_URL" | sed 's#/mohalla_e2e.*#/postgres#')" -c 'CREATE DATABASE mohalla_e2e' >/dev/null
cd "$ROOT/apps/api"
DATABASE_URL="$DB_URL" npx prisma migrate deploy >/dev/null
DATABASE_URL="$DB_URL" npx tsx prisma/seed.ts

if [ "${SKIP_WEB_BUILD:-0}" != "1" ]; then
  cd "$ROOT/apps/mobile"
  EXPO_PUBLIC_API_URL="http://localhost:$API_PORT" npx expo export --platform web --output-dir dist-e2e --clear >/dev/null
fi

cd "$ROOT/apps/api"
NODE_ENV=development OTP_IP_LIMIT_PER_15MIN=1000 PORT=$API_PORT DATABASE_URL="$DB_URL" OTP_PROVIDER=dev LOG_LEVEL=warn \
  GPS_CHECKS_REQUIRED=2 GPS_CHECK_MIN_GAP_HOURS=0 PUBLIC_BASE_URL="http://localhost:$API_PORT" UPLOAD_DIR=/tmp/mohalla-e2e-uploads \
  npx tsx src/server.ts > /tmp/mohalla-e2e-api.log 2>&1 &
echo $! > /tmp/mohalla-e2e-api.pid
node "$ROOT/e2e/serve.js" "$ROOT/apps/mobile/dist-e2e" "$WEB_PORT" > /tmp/mohalla-e2e-web.log 2>&1 &
echo $! > /tmp/mohalla-e2e-web.pid
for i in $(seq 1 30); do curl -sf "http://localhost:$API_PORT/health" >/dev/null && break; sleep 1; done
echo "API :$API_PORT  WEB :$WEB_PORT"
