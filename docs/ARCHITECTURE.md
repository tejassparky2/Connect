# Mohalla Connect — System Architecture

> Hyper-local, verified community network for Indian neighbourhoods and housing societies.
> Three pillars: **Neighbours** (geo-fenced feed), **Local Commerce** (shops, informal workers, self-serve ads), **Societies/RWAs** (private groups).

```
┌───────────────────────────┐        HTTPS/JSON         ┌──────────────────────────────────────────┐
│  Expo app (iOS/Android/   │ ───────────────────────▶ │  API — Node 22 · Express 5 · TypeScript  │
│  web) · NativeWind ·      │ ◀─────────────────────── │  zod validation · JWT + rotating refresh │
│  React Query · SecureStore│   Expo Push (FCM/APNs)    │  in-process job queue (→ BullMQ/pg-boss) │
└───────────────────────────┘                            └───────────┬──────────────┬───────────────┘
        │ Razorpay Checkout (hosted page)                            │ Prisma +     │ S3/R2/Supabase
        ▼                                                            │ raw PostGIS  │ Storage (images)
   Razorpay  ── signed webhook ──▶ /pay/webhook                      ▼              ▼
                                                     PostgreSQL 16/17 + PostGIS 3.4/3.5 (GIST)
   Supabase Auth (phone OTP; Twilio/Textlocal/MSG91 DLT hook) ◀── API proxies OTP send/verify
```

## 1. Data model (see `apps/api/prisma/schema.prisma`)

| Area | Tables | Key decisions |
|---|---|---|
| Identity | `users`, `sessions`, `otp_challenges`, `push_tokens`, `blocks` | Phone (E.164) is the only login id. Refresh tokens stored as HMAC, rotated, family-revoked on reuse. |
| Geography | `neighborhoods` (MultiPolygon + centre), `addresses`, `location_checks`, `vouches` | `geography(…, 4326)` everywhere so distances are **metres on the spheroid**. |
| Roles | `users.platformRole` (USER/MODERATOR/ADMIN) + `society_memberships.role` (RESIDENT/RWA_COMMITTEE/RWA_ADMIN) + `users.verificationLevel` | Roles are *scoped*: being an RWA admin in one society grants nothing elsewhere. Business ownership is a relation (`businesses.ownerId`), not a role. |
| Neighbours | `posts`, `comments`, `post_reactions`, `conversations`, `messages`, `reports` | `posts.location` is the author's home **snapped to a ~150 m grid**; the feed queries posts directly by location. |
| Commerce | `businesses`, `business_announcements`, `service_providers`, `provider_vouches`, `reviews`, `ad_campaigns`, `ad_events`, `wallet_transactions` | Money is integer **paise**. Ad events unique per (campaign, user, type, day). |
| Societies | `societies`, `society_memberships`, `notices`, `tickets`, `ticket_comments`, `vehicles`, `parking_alerts` | Every private route checks an APPROVED membership. |

**Prisma + PostGIS.** Prisma can't read/write `geography`, so those columns are `Unsupported(...)` and all spatial SQL lives in `src/lib/geo.ts` as parameterised `Prisma.sql` templates. GIST indexes are declared with `@@index([location], type: Gist)` so `prisma migrate dev` never drops them. Prisma also refuses `create()` on models with a *required* Unsupported column, so the point columns of user-created rows (users, posts, businesses, …) are optional to Prisma and **NOT NULL is enforced at COMMIT by deferred constraint triggers** (`*_integrity_constraints` migration). Rows are created with `createWithPoint()` = `create` + `setPoint` in one transaction. CHECK constraints (radius 2–5 km, rating 1–5, ad spend ≤ budget, ordered conversation pairs, …) are also invisible to Prisma's diff, so they're safe.

**Privacy invariants**
- `users.homeLocation` is never serialised (Prisma never selects Unsupported columns, so it *can't* leak by accident).
- Distances shown to users are rounded up to 100 m; the neighbour-directory cursor (which holds an exact distance) is **AES-GCM sealed**.
- Feed centre = the verified home pin, never the live GPS, so users can't "teleport" to scrape other areas. Single posts are only readable within 10 km.
- Phone numbers of residents are never returned to other users (parking alerts route to the owner without revealing who they are). Businesses/workers publish phones by consent.
- DPDP Act 2023: account deletion anonymises the user, removes addresses/home pin, revokes sessions; worker listings require explicit consent.

## 2. Geospatial queries that don't fall over

The brief says that 10,000 users within 2 km must not crash the database. We tested ten times that. These are the rules (all in `apps/api/src/lib/geo.ts`) and **what we measured** that forced each one:

1. **Filter with `ST_DWithin(geog, centre, metres)`**, which uses the index. Never filter with `ST_Distance(...) < r`.
2. **Nearest-first lists ("neighbours", "businesses", "workers") walk the GiST index in distance order** (`knnPage`):
   - **The inner query orders by `<->` only and has no radius in `WHERE`.** On PostgreSQL 16, `ORDER BY dist, id` cannot use the GiST ordering; PG17 adds incremental sort. PostGIS also misestimates clustered points badly: it estimated 10 rows where 100,000 matched. Either problem pushed the planner to a sequential scan plus a full sort (**624 ms** at 100k rows).
   - **The radius test becomes an `inRange` output column.** The `(distance, id)` keyset and the tie-break are applied in JS over a buffer of `limit + 64` rows. The walk stops at that buffer or at `1.01 × radius`.
   - **Exact ties wider than the buffer fall back to an exact query,** for example a whole apartment tower sharing one pin. A test puts 150 users on the identical point.
   - **An `EXPLAIN` assertion in `tests/geo.test.ts`** (on the users KNN query, which businesses and workers share via `knnPage`) fails the build if a Seq Scan or a full Sort ever comes back.
3. **One distance expression everywhere.** ORDER BY, the cursor and the displayed value all use sphere `<->`. Mixing it with spheroid `ST_Distance` made pages skip or repeat rows. The cursor distance is passed as a string because Prisma serialises floats to about 15 significant digits. Every cursor is sealed with AES-256-GCM and schema-checked on the way back in (tests send garbage cursors to every paginated endpoint, and a correctly sealed cursor of the wrong shape to the neighbour directory), so clients can't forge a cursor to probe locations.
4. **The feed is time-ordered.** It is `ST_DWithin` plus a `(createdAt, id)` keyset. The worst case was about 63 ms per page with 100k posts in range; the sparse case was 0.05 ms.
5. **Counts are capped and bucketed.** "Neighbours near you" is a KNN-capped count bucketed to <10 / 10s / 50s / 100s. It is cheap, and it can't be used as a location oracle by moving your pin and watching the count change. Fixing this took neighbourhood stats from **16 → 250 req/s**.
6. **Database settings (two migrations):**
   - **`jit = off`.** The planner's cost estimates crossed `jit_above_cost`, so Postgres spent about 35 ms compiling a 5 ms query. Feed page: **43 → 8 ms**.
   - **`plan_cache_mode = force_custom_plan`.** Prisma uses prepared statements. After five executions Postgres may switch to a generic plan that can't see the actual radius or centre. That was **4× slower (29 → 7 ms)**.
7. **Fan-out streams.** Emergency alerts reach everyone within 2 km via `streamUserIdsWithin()`, in id-keyset batches of 1,000, so memory stays flat.
8. **Location is denormalised onto posts,** so the feed never joins users. Post locations are snapped to a ~150 m grid (`ST_SnapToGrid`, 0.0015°) so exact homes never leak.

**Load test** (`e2e/load/run-load.mjs`):
- Setup: autocannon with 50 connections, 10 s per endpoint, against a single API process and PostgreSQL 16 + PostGIS 3.4.
- Hardware: the load generator, API and database all share one 4-vCPU dev container, so treat these as lower bounds, not production capacity.
- Data: 100,000 residents and 20,000 posts.
- **0 errors and 0 non-2xx responses in every run.**

| Endpoint | Throughput (two idle runs) | p50 / p99 latency |
|---|---|---|
| Feed | **115–117 req/s** | ~420 / 550–590 ms |
| Neighbourhood stats | **178–186 req/s** | ~265 / 415–445 ms |
| Neighbours directory | **516–518 req/s** | ~90 / 137–149 ms |
| Businesses directory | **474–488 req/s** | ~102 / 143–154 ms |
| Workers directory | **438–514 req/s** | 95–111 / 137–182 ms |
| Badges | **902–930 req/s** | ~52 / 87 ms |

The fixes above roughly **doubled feed throughput and multiplied neighbourhood-stats throughput about 15×**, measured before and after on the same machine (feed 62 → 137 req/s, stats 16 → 250 req/s). Absolute numbers vary between container hosts: a later re-run on a fresh container gave the table above, and one run made while native builds were compiling on the same CPUs was 30–48% lower again.

**Scaling further:** add read replicas for feed and directory reads, partition `posts` by month, and cache first feed pages per ~500 m geohash cell (Redis, 30 s TTL). Move jobs to BullMQ or pg-boss. Put PgBouncer in transaction mode in front of Postgres (this needs Prisma's `pgbouncer=true`). Prefer **PostgreSQL 17**.

## 3. Trust & verification without manual overhead

Level is **derived from evidence** by `recomputeLevel()`, never set by a route — downgrades (moving home, being removed from a society) are automatic.

| Level | How | Unlocks |
|---|---|---|
| `PHONE` | OTP (Indian SIMs are KYC'd → real identity anchor) | Read the feed |
| `LOCATION` | Home pin + **2 on-device GPS checks ≥ 6 h apart** within 200 m, accuracy ≤ 150 m, mock-location flag rejected | Post, comment, message, list businesses/workers, create a society |
| `ADDRESS` | LOCATION (GPS) **plus** any one of: approval by the RWA of a **platform-verified** society (home within 500 m), or that society's invite code with auto-approve on; **2 vouches** from ADDRESS-verified neighbours within 1 km. Anti-ring rules: max 5 vouches per 30 days (enforced under an advisory lock), no vouching back for someone who vouched for you, and residents who were themselves verified by vouches can vouch only once their account is 30 days old. Leaving or being removed from a society revokes society-based verification. | Vouch for others & workers, full trust badge |

Humans review only: **societies** (RWA registration certificate — one review unlocks hundreds of residents, retroactively), flagged content (posts and comments are auto-hidden at 3 reports from trusted accounts, i.e. ≥ 3 days old or ADDRESS-verified), and flagged ads. Anti-abuse: society creation requires LOCATION + living within 300 m + no other society within 75 m; vouching is geo-fenced and rate-limited; OTP sends are limited per phone (60 s cooldown, 5 per hour; the dev provider also allows 5 attempts per code, while GoTrue enforces its own in production) and per IP (`OTP_IP_LIMIT_PER_15MIN`, default 10). With Supabase, the end-user IP is forwarded via `Sb-Forwarded-For`, so Supabase's own per-IP limits apply to users, not to our server. This was verified against a real GoTrue server in `tests-integration/`.

## 4. The cold-start problem

Technical levers built in:
- **Adaptive radius** — if a user's radius has < 8 posts in 30 days, the first feed page widens to 5 km and says so (`expanded: true`), instead of showing an empty app.
- **Seeded neighbourhoods** — admins import ward/OSM polygons as GeoJSON (`POST /v1/admin/neighborhoods`, `ST_MakeValid` repairs bad data); residents who signed up earlier are adopted automatically. Neighbourhoods graduate SEEDED → ACTIVE at 25 members.
- **Society-led growth** — one RWA admin registers the society, shares an 8-char invite code on the existing WhatsApp group, and can enable auto-approve: whole buildings onboard in a day. This is the primary acquisition loop in India.
- **Supply-side seeding** — businesses and workers can be listed by residents (with consent), so the Local tab is useful before shop owners join; "Newly opened" badges + free offers give businesses a reason to join early.
- **Feed stats** ("40+ neighbours within 3 km"; counts are bucketed) create social proof; the empty state pushes the first post.

## 5. Edge cases handled

| Case | Handling |
|---|---|
| GPS spoofing | Mocked-location flag, two time-separated checks, accuracy threshold; vouches only count after LOCATION |
| Users near neighbourhood edges | Polygon containment, then nearest centre within 2 km; feed is radius-based so edges don't matter |
| Moving house | New primary address ⇒ level recomputed ⇒ re-verification |
| Refresh-token theft | Rotation + reuse detection revokes the whole session family |
| Concurrent ad impressions | Single atomic `UPDATE` derives spend from impressions, caps at budget, flips EXHAUSTED |
| Double payment credit | Wallet credit idempotent on Razorpay payment id (client callback + webhook) |
| Banned user with valid JWT | Every request reloads the user row → immediate lockout |
| Panic/spam alerts | 3 alerts/day/user; CRITICAL pushes high-priority; scam-phrase moderation |
| Non-UUID path params | Rejected with 404 before any `::uuid` cast |
| Swapped lat/lng | India bounding-box validation |
| Unregistered vehicle in parking alert | Escalated to the RWA committee |
| Blocking | Bidirectional for the feed, comments, the neighbour directory and messages. Deliberate exception: pinned **safety alerts** are hidden only from people who blocked the author, so being blocked never stops you seeing a fire or flood alert nearby |

## 6. Security checklist

**Baseline:**
- helmet, an explicit CORS allow-list in production, a JSON body limit
- global, per-IP and per-user rate limits (IPv6-safe keys; `TRUST_PROXY` defaults to 0, so `X-Forwarded-For` can't be spoofed)
- zod on every input; parameterised SQL only, with `ILIKE` wildcards escaped
- image magic-byte sniffing (no SVG/HTML uploads); media URLs must be https or our own uploads
- HMAC'd OTPs and refresh tokens; timing-safe comparisons
- **refuse-to-boot** in production with dev OTP, wildcard CORS or placeholder secrets

**Found by an adversarial audit, then fixed with a regression test each** (`tests/security.test.ts`, 23 tests; 22 failed on the old code and the 23rd was strengthened until it did):
- **Races are closed:**
  - State transitions such as join requests and report decisions are conditional `UPDATE … WHERE status = …`.
  - Ad settlement uses `SELECT … FOR UPDATE`.
  - The vouch cap and GPS-check counting use `pg_advisory_xact_lock`.
- **Ads:** impressions are billed only when the viewer is actually eligible for the ad. Clicks require a prior impression. The feed serves at most one ad, and only on page 1. The mobile app reports an impression only after the card is 60% visible for 1 s.
- **Payments:**
  - Razorpay checks: the signature `HMAC(order_id|payment_id)`, the amount fetched server-side, and the order's `notes.businessId` must match the wallet being credited.
  - The credit is idempotent on the payment id.
  - Status `attempted` returns 202 pending.
  - The webhook accepts `order.paid` and `payment.captured`.
  - The wallet is capped and closed-loop.
- **Privacy:**
  - Distances and counts are bucketed. Post locations are fuzzed.
  - Reports on posts and comments, and chats started from a listing, require that post to be visible to you (within 10 km).
  - Auto-hide counts only reporters who are at least 3 days old or ADDRESS-verified, so brigades of fresh accounts can't silence people.
  - Address changes are limited to 3 per 30 days, which stops pin-walking.
- **Compliance (India):**
  - **DPDP Act 2023:** affirmative consent is recorded (`consentAt`, `consentVersion`) and checked *before* the OTP is consumed. A plain-language notice is readable before sign-up. Account deletion is self-serve.
  - **IT Rules 2021:** a grievance contact is shown in the app.
  - **Alerts:** the composer requires confirming that the alert "describes behaviour, not identity". This counters the communal and caste profiling that neighbourhood apps are known for.

## 7. Known limitations / next steps
- **Not yet tested on physical devices or with live credentials:** Razorpay live mode, MSG91 SMS delivery and Expo push to real phones. Contract tests mock those services' documented responses, and Supabase Auth was tested against a real GoTrue server.
- Push receipt ticket ids are held in memory; they are lost on restart (tokens are still pruned on the next send). Persist them if you need guaranteed pruning.
- Chat uses 4 s polling; upgrade path is a WebSocket gateway (or Supabase Realtime) behind the same endpoints.
- The background job runner is in-process; with >1 API replica, swap `enqueue()` for BullMQ/pg-boss.
- Rate-limit store is in-memory; use the Redis store when horizontally scaling.
- i18n: language preference is stored; UI strings are English-only for now.
- Native Razorpay SDK (`react-native-razorpay`) can replace the hosted checkout in a dev build.
