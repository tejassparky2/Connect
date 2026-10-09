# 🏘️ Mohalla Connect

**Apna mohalla, ab ek app mein.** A hyper-local, verified community app for India's neighbourhoods and housing societies, a bit like Nextdoor but built for Indian realities: RWAs, gated communities, kirana stores, and the informal workers every household relies on.

| Pillar | What you get |
|---|---|
| 🏡 **Neighbours** | A feed limited to your neighbourhood radius (2–5 km by default; 0.5–5 km filter): marketplace, hobby partners, recommendations, events, lost & found, and **emergency alerts pushed to everyone within 2 km**. Also 1:1 chat and a directory of verified neighbours. |
| 🏪 **Local commerce** | A directory of shops and cafés, offers from newly opened places, reviews, **resident-vouched maids, cooks, plumbers and drivers**, and **self-serve hyper-local ads** paid from a wallet (Razorpay). |
| 🏢 **Society / RWA** | Private groups for verified residents, with geo-fenced join requests, RWA approvals, invite codes, a notice board, a maintenance helpdesk, and **parking alerts that reach the vehicle owner without sharing phone numbers**. |

## Stack

- **Mobile:** Expo SDK 57 (React Native 0.86), Expo Router, NativeWind (Tailwind), TanStack Query, Zustand, SecureStore. Runs on iOS, Android and web.
- **API:** Node 22, Express 5, TypeScript, zod, Prisma 6.
- **Database:** PostgreSQL 16 or 17 + **PostGIS 3.4/3.5** (Docker Compose uses 17-3.5; CI tests both), with GIST-indexed `geography` columns.
- **Auth:** phone OTP through **Supabase Auth**, proxied by the API, which then issues its own JWT plus rotating refresh tokens. A `dev` provider exists for local work and is blocked in production.
- **Payments:** Razorpay (hosted checkout and signed webhook). **Push:** Expo Push. **Images:** local disk or any S3-compatible store (S3, R2, Supabase Storage).

```
apps/api      Express API · prisma/schema.prisma · migrations · seed · 137 integration tests
apps/mobile   Expo app · src/app (routes) · src/components · src/lib
e2e           Playwright end-to-end suite (web build ↔ real API ↔ PostGIS)
docs          ARCHITECTURE.md (design, geo-scaling, verification, cold start) · API.md (endpoint blueprint)
```

## Quick start (local)

```bash
# 1. Database (PostGIS) — Docker, or any Postgres 16/17 with the postgis extension (17 recommended)
docker compose up -d db

# 2. API
npm install                       # installs the api workspace
cp apps/api/.env.example apps/api/.env
npm run db:migrate                # prisma migrate deploy (creates PostGIS extension, GIST indexes, constraints)
npm run db:seed                   # Bengaluru demo data: HSR Layout, Koramangala, Indiranagar
npm run api:dev                   # http://localhost:4000  (GET /health)

# 3. Mobile
cd apps/mobile && npm install
npx expo start                    # press w for web, a for Android, i for iOS
# On a physical phone set the API address: EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:4000 npx expo start
```

**Demo logins** (`OTP_PROVIDER=dev` shows the OTP on screen):

| Phone | Who |
|---|---|
| 99000 00001 | Priya Sharma — RWA admin, Green Meadows Residency (verified) |
| 99000 00002 | Arjun Mehta — resident (verified) |
| 99000 00003 | Kavya Reddy — owns *Filter Kaapi House* café (ad wallet ₹1,500) |
| 99000 00004 | Rohan Iyer — location-verified neighbour |
| 99000 00005–07 | Fatima, Sanjay, Meera — residents |
| 99000 00009 | Platform admin |
| any other number | brand-new user → full onboarding |

New accounts must tick the privacy-notice consent box (DPDP Act 2023); the consent time and notice version are stored on the user.
The society invite code for Green Meadows Residency is `GREEN234`.

> **Testing verification locally:** production requires two GPS checks at least 6 hours apart. For local testing, set `GPS_CHECK_MIN_GAP_HOURS=0` in `apps/api/.env`.

## Tests

| Command | What it covers | Result on the last run |
|---|---|---|
| `npm run api:test` | Vitest integration suite against a real PostGIS DB (`mohalla_test`). It includes 25 security regression tests and a 100k-resident scale test. | 137/137 on PostgreSQL 16 and 17 |
| `npm run test:supabase -w apps/api` | API ↔ a **real Supabase Auth (GoTrue)** server: OTP send, verify, wrong code, rate limit, IP forwarding. Needs a running GoTrue; setup is in the file header and the CI job. | 5/5 |
| `cd apps/mobile && npm test` | Formatting unit tests plus jest-expo component tests rendered for **iOS and Android** | 5/5 + 40/40 |
| `cd apps/mobile && npx tsc --noEmit && npx expo-doctor` | Types and Expo SDK compatibility | clean, 21/21 |
| `npm run e2e` | Boots a seeded stack and runs Playwright through the real UI (web build → API → PostGIS) | 9/9 journeys |
| `node e2e/load/run-load.mjs` | autocannon load test against 100k residents and 20k posts | see ARCHITECTURE §2 |

The scale test puts 100,000 residents around one point. It asserts exact counts and uses an `EXPLAIN` assertion to check that the nearest-first users query walks the GiST index (no Seq Scan, no full Sort). It also checks that keyset pagination never skips or repeats a row, even when 150 users share the identical point (more than the 64-row tie buffer). Alert fan-out must reach every recipient exactly once.

E2E journeys cover:
- onboarding (with consent) → GPS verification → posting, liking and commenting
- resident helpdesk and parking alert
- join request → RWA approval → address verified
- café owner tops up the wallet → launches an ad → posts an offer
- a neighbour reviews a shop and lists a worker
- buyer and seller chat → item marked sold → logout
- privacy notice readable before sign-up
- the alert anti-profiling gate
- sheet → confirm delete
- error toasts over open sheets

CI (`.github/workflows/ci.yml`) runs all of the above except the load test. The API suite runs on a PostGIS 16 and 17 matrix.

## Production deployment

```bash
docker build -f apps/api/Dockerfile -t mohalla-api .
docker run -p 4000:4000 \
  -e NODE_ENV=production -e DATABASE_URL=... \
  -e JWT_ACCESS_SECRET=$(openssl rand -hex 48) -e JWT_REFRESH_SECRET=$(openssl rand -hex 48) -e OTP_SECRET=$(openssl rand -hex 24) \
  -e OTP_PROVIDER=supabase -e SUPABASE_URL=... -e SUPABASE_SECRET_KEY=sb_secret_... -e TRUST_PROXY=1 \
  -e CORS_ORIGINS=https://app.example.in -e PUBLIC_BASE_URL=https://api.example.in \
  -e UPLOAD_DRIVER=s3 -e S3_BUCKET=... -e S3_PUBLIC_URL=... \
  -e RAZORPAY_KEY_ID=... -e RAZORPAY_KEY_SECRET=... -e RAZORPAY_WEBHOOK_SECRET=... \
  -e PUSH_ENABLED=true -e EXPO_ACCESS_TOKEN=... mohalla-api
```

The container applies migrations on start. It **refuses to boot** if it is given the dev OTP provider, a wildcard CORS setting or placeholder secrets.

Production checklist:
- **Proxy.** Set `TRUST_PROXY` to the number of proxies in front of the API, for example `1` behind one load balancer. A wrong value lets clients spoof their IP and dodge rate limits.
- **SMS / OTP.** Use Supabase phone auth. In India every SMS needs a TRAI DLT-registered sender ID and template. Textlocal has shut down, so use MSG91 (or another DLT-registered gateway) through Supabase's **Send-SMS hook**. Enable "IP address forwarding" in Supabase Auth and use an `sb_secret_…` key: the API sends `Sb-Forwarded-For` so Supabase's per-IP limits apply to end users rather than your server.
- **Razorpay.** Point the webhook at `/pay/webhook`, subscribe to `order.paid` (and optionally `payment.captured`), and set `RAZORPAY_WEBHOOK_SECRET`. Ad-wallet balances are closed-loop prepaid credit and are never withdrawable. Add 18% GST to your invoices.
- **Push.** Run `npx eas-cli init` once so `app.json` gets `extra.eas.projectId`. Without it the app skips push registration. Set `PUSH_ENABLED=true` and `EXPO_ACCESS_TOKEN`.
- **Grievance officer.** The IT Rules 2021 require a published grievance officer. Build the app with `EXPO_PUBLIC_GRIEVANCE_EMAIL=...` (shown on the in-app privacy screen) and `EXPO_PUBLIC_API_URL=https://api.example.in`.
- **Database.** Use PostgreSQL 17 + PostGIS 3.5 if you can (see ARCHITECTURE §2). Migrations disable JIT and force custom plans at database level; managed services that refuse `ALTER DATABASE` skip it with a notice, so set `jit=off` and `plan_cache_mode=force_custom_plan` in the parameter group instead.
- **Builds.** `npx eas-cli build --platform all`.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for design decisions, edge cases and the scaling plan, and **[docs/API.md](docs/API.md)** for every endpoint, and **[docs/MARKET_RESEARCH.md](docs/MARKET_RESEARCH.md)** for the India market, regulatory and competitor research behind these decisions.
