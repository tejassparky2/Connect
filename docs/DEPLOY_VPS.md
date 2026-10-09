# Deploy on your own VPS

One command sets up **PostGIS + the API + Caddy (automatic HTTPS)** with Docker. Data, photos and certificates live in Docker volumes and survive restarts and updates.

## Requirements

- Ubuntu 22.04+/Debian 12+ VPS, **≥ 1 GB RAM** (2 GB recommended for the first build), ~5 GB disk.
- Inbound **TCP 80 and 443** open — check your provider's firewall / security group too, not only `ufw`.
- Nothing else listening on ports 80/443 (stop nginx/apache first).
- Optional: your own domain with an **A record → the VPS IP**. Without one, the script uses `<ip-with-dashes>.sslip.io` (free wildcard DNS that resolves to your IP), so HTTPS still works.

## Install / update

```bash
curl -fsSL https://raw.githubusercontent.com/tejassparky2/Connect/ccr-9a53ab63-qgyfrl/deploy/vps/install.sh | sudo bash
# with your own domain:
curl -fsSL https://raw.githubusercontent.com/tejassparky2/Connect/ccr-9a53ab63-qgyfrl/deploy/vps/install.sh | sudo DOMAIN=api.example.in bash
```

It installs Docker if needed, clones the repo to `/opt/mohalla-connect`, generates secrets into `deploy/vps/.env` (mode 600, kept on re-runs), builds and starts everything, waits for `https://<domain>/health`, and prints the address to enter in the app. **Run the same command again to update** to the latest code.

## Use it from the app

Open the app → **Get started** → enter the printed domain (e.g. `203-0-113-7.sslip.io`) → **Test & save**. Demo logins: `99000 00001` (RWA admin), `…02` (resident), `…03` (café owner), `…09` (admin); the OTP appears on screen.

## Demo mode ⚠️

The default `.env` runs in **DEMO_MODE**: OTPs are shown in the app and no SMS is sent, so anyone can sign in as any number. Use demo data only. For real users, edit `/opt/mohalla-connect/deploy/vps/.env`: set `OTP_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (DLT-registered SMS via MSG91), `DEMO_MODE=false`, `SEED_DEMO_DATA=false`, then re-run the install command.

## Operations

```bash
cd /opt/mohalla-connect/deploy/vps
docker compose ps                      # status
docker compose logs -f api             # API logs
docker compose exec db pg_dump -U mohalla mohalla | gzip > ~/mohalla-$(date +%F).sql.gz   # backup
docker compose restart api
```
