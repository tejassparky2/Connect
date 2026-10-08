# 🏘️ Mohalla Connect

**Apna mohalla, ab ek app mein.** A hyper-local, verified community app for India's neighbourhoods and housing societies, a bit like Nextdoor but built for Indian realities: RWAs, gated communities, kirana stores, and the informal workers every household relies on.

| Pillar | What you get |
|---|---|
| 🏡 **Neighbours** | A feed limited to a 2–5 km radius: marketplace, hobby partners, recommendations, events, lost & found, and **emergency alerts pushed to everyone within 2 km**. Also 1:1 chat and a directory of verified neighbours. |
| 🏪 **Local commerce** | A directory of shops and cafés, offers from newly opened places, reviews, **resident-vouched maids, cooks, plumbers and drivers**, and **self-serve hyper-local ads** paid from a wallet (Razorpay). |
| 🏢 **Society / RWA** | Private groups for verified residents, with geo-fenced join requests, RWA approvals, invite codes, a notice board, a maintenance helpdesk, and **parking alerts that reach the vehicle owner without sharing phone numbers**. |

## Stack

- **Mobile:** Expo SDK 57 (React Native 0.86), Expo Router, NativeWind (Tailwind), TanStack Query, Zustand, SecureStore. Runs on iOS, Android and web.
- **API:** Node 22, Express 5, TypeScript, zod, Prisma 6.
- **Database:** PostgreSQL 16 + **PostGIS 3.4**, with GIST-indexed `geography` columns.
- **Auth:** phone OTP through **Supabase Auth**, proxied by the API, which then issues its own JWT plus rotating refresh tokens. A `dev` provider exists for local work and is blocked in production.
- **Payments:** Razorpay (hosted checkout and signed webhook). **Push:** Expo Push. **Images:** local disk or any S3-compatible store (S3, R2, Supabase Storage).

```
apps/api      Express API · prisma/schema.prisma · migrations · seed · 106 integration tests
apps/mobile   Expo app · src/app (routes) · src/components · src/lib
e2e           Playwright end-to-end suite (web build ↔ real API ↔ PostGIS)
docs          ARCHITECTURE.md (design, geo-scaling, verification, cold start) · API.md (endpoint blueprint)
```

## Quick start (local)

```bash
# 1. Database (PostGIS) — Docker, or any Postgres 16 with the postgis extension available
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
| 99000 00009 | Platform admin |
| any other number | brand-new user → full onboarding |

> **Testing verification locally:** production requires two GPS checks at least 6 hours apart. For local testing, set `GPS_CHECK_MIN_GAP_HOURS=0` in `apps/api/.env`.

## Tests

```bash
npm run api:test                  # 106 Vitest integration tests against a real PostGIS DB (mohalla_test)
cd apps/mobile && npm test        # unit tests (formatting, phone/₹ helpers)
cd apps/mobile && npx tsc --noEmit && npx expo-doctor
npm run e2e                       # boots seeded stack + Playwright: 6 multi-user journeys through the real UI
```

The API suite includes a **scale test with 10,000 users inside 2 km**. It checks exact counts, confirms through `EXPLAIN` that the GIST index is used with no sequential scan, and requires average page latency under 100 ms. It also checks that keyset pagination never skips or repeats a row, and that alert fan-out reaches all 10,000 users exactly once.

E2E journeys: new-user onboarding → GPS verification → posting, liking and commenting · resident helpdesk and parking alert · join request → RWA approval → address verified · café owner tops up the wallet → launches an ad → posts an offer · neighbour reviews a shop and lists a worker · buyer and seller chat → item marked sold → logout.

## Production deployment

```bash
docker build -f apps/api/Dockerfile -t mohalla-api .
docker run -p 4000:4000 \
  -e NODE_ENV=production -e DATABASE_URL=... \
  -e JWT_ACCESS_SECRET=$(openssl rand -hex 48) -e JWT_REFRESH_SECRET=$(openssl rand -hex 48) -e OTP_SECRET=$(openssl rand -hex 24) \
  -e OTP_PROVIDER=supabase -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... \
  -e CORS_ORIGINS=https://app.example.in -e PUBLIC_BASE_URL=https://api.example.in \
  -e UPLOAD_DRIVER=s3 -e S3_BUCKET=... -e S3_PUBLIC_URL=... \
  -e RAZORPAY_KEY_ID=... -e RAZORPAY_KEY_SECRET=... -e RAZORPAY_WEBHOOK_SECRET=... \
  -e PUSH_ENABLED=true -e EXPO_ACCESS_TOKEN=... mohalla-api
```

The container applies migrations on start. It **refuses to boot** if it is given the dev OTP provider, a wildcard CORS setting or placeholder secrets. Configure Supabase phone auth with an Indian DLT-registered SMS sender (Textlocal, or MSG91 through the Send-SMS hook). Point the Razorpay webhook (`payment.captured`) at `/pay/webhook`. Build the apps with EAS: `npx eas-cli build --platform all`.

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for design decisions, edge cases and the scaling plan, and **[docs/API.md](docs/API.md)** for every endpoint.
