#!/usr/bin/env bash
# Mohalla Connect — one-command VPS install (Ubuntu/Debian).
#
#   curl -fsSL https://raw.githubusercontent.com/tejassparky2/Connect/ccr-9a53ab63-qgyfrl/deploy/vps/install.sh | sudo bash
#   # or, with your own domain (DNS A record → this server):
#   curl -fsSL …/install.sh | sudo DOMAIN=api.example.in bash
#
# Re-running is safe: it updates the code, keeps .env (secrets) and all data, and rebuilds.
# Without DOMAIN it uses <your-ip>.sslip.io — a free wildcard DNS name that resolves to your IP — so
# Caddy can still get a real HTTPS certificate.
set -euo pipefail

REPO="${REPO:-https://github.com/tejassparky2/Connect.git}"
BRANCH="${BRANCH:-ccr-9a53ab63-qgyfrl}"
DIR="${DIR:-/opt/mohalla-connect}"

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (prefix with sudo)."

say "Installing prerequisites"
if ! command -v docker >/dev/null 2>&1; then
  command -v curl >/dev/null || (apt-get update -qq && apt-get install -y -qq curl)
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (apt-get install docker-compose-plugin)."
command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq git)
command -v openssl >/dev/null || (apt-get update -qq && apt-get install -y -qq openssl)

say "Fetching code ($BRANCH) into $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/deploy/vps"

if [ ! -f .env ]; then
  say "Generating secrets (.env, kept on re-runs)"
  if [ -z "${DOMAIN:-}" ]; then
    IP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me)" || die "Couldn't detect the public IP; re-run with DOMAIN=…"
    DOMAIN="${IP//./-}.sslip.io"
  fi
  umask 077
  cat > .env <<ENV
DOMAIN=$DOMAIN
DB_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
OTP_SECRET=$(openssl rand -hex 24)
# DEMO: OTP shown in the app, no SMS — anyone can sign in as any number. For real users set
# OTP_PROVIDER=supabase, SUPABASE_URL, SUPABASE_SECRET_KEY and DEMO_MODE=false, then re-run.
OTP_PROVIDER=dev
DEMO_MODE=true
SEED_DEMO_DATA=true
ENV
fi
set -a; . ./.env; set +a

for port in 80 443; do
  if ss -ltnH "sport = :$port" 2>/dev/null | grep -q . && ! docker compose ps caddy 2>/dev/null | grep -q Up; then
    die "Port $port is already in use (another web server such as nginx/apache?). Stop it or free ports 80/443, then re-run."
  fi
done
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  say "Opening ports 80/443 in ufw"; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

say "Building and starting (first build takes a few minutes)"
docker compose up -d --build

say "Waiting for https://$DOMAIN/health (certificate issuance can take a minute)"
for i in $(seq 1 90); do
  if curl -fsS --max-time 5 "https://$DOMAIN/health" >/dev/null 2>&1; then
    printf '\n\033[1;32m✔ Mohalla Connect is live: https://%s\033[0m\n' "$DOMAIN"
    echo "  In the app: Get started → enter  $DOMAIN  → Test & save."
    echo "  Demo logins: 99000 00001 (RWA admin) · 00002 (resident) · 00003 (café owner) · 00009 (admin); OTP shows on screen."
    echo "  Logs: cd $DIR/deploy/vps && docker compose logs -f api"
    exit 0
  fi
  sleep 4
done
echo
docker compose ps
docker compose logs --tail 30 api caddy
die "Not reachable over HTTPS yet. Check your cloud provider's firewall/security group allows inbound TCP 80 and 443, then re-run."
