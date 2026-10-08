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
                                                     PostgreSQL 16 + PostGIS 3.4 (GIST indexes)
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

**Prisma + PostGIS.** Prisma can't read/write `geography`, so those columns are `Unsupported(...)` and all spatial SQL lives in `src/lib/geo.ts` as parameterised `Prisma.sql` templates. GIST indexes are declared with `@@index([location], type: Gist)` so `prisma migrate dev` never drops them. Prisma also refuses `create()` on models with a *required* Unsupported column, so point columns are optional to Prisma and **NOT NULL is enforced at COMMIT by deferred constraint triggers** (`*_integrity_constraints` migration). Rows are created with `createWithPoint()` = `create` + `setPoint` in one transaction. CHECK constraints (radius 2–5 km, rating 1–5, ad spend ≤ budget, ordered conversation pairs, …) are also invisible to Prisma's diff, so they're safe.

**Privacy invariants**
- `users.homeLocation` is never serialised (Prisma never selects Unsupported columns, so it *can't* leak by accident).
- Distances shown to users are rounded up to 100 m; the neighbour-directory cursor (which holds an exact distance) is **AES-GCM sealed**.
- Feed centre = the verified home pin, never the live GPS, so users can't "teleport" to scrape other areas. Single posts are only readable within 10 km.
- Phone numbers of residents are never returned to other users (parking alerts route to the owner without revealing who they are). Businesses/workers publish phones by consent.
- DPDP Act 2023: account deletion anonymises the user, removes addresses/home pin, revokes sessions; worker listings require explicit consent.

## 2. Geospatial queries that don't fall over

The brief: *10,000 users within 2 km must not crash the DB.* The rules, all in `geo.ts`:

1. **Filter with `ST_DWithin(geog, centre, metres)`** — index-aware (bounding-box GIST scan, then exact check). Never `ST_Distance(...) < r`.
2. **Centres are bound parameters**, not joined rows, so the planner always picks the GIST index.
3. **Nearest-first with KNN `<->`**: the index is walked in distance order and stops at `LIMIT` — the first 30 of 10,000 costs ~30 index probes, not a sort of 10,000.
4. **Keyset pagination** on `(distance, id)` or `(createdAt, id)`; never `OFFSET`. The *same* expression (`<->`) is used for ORDER BY, the cursor predicate and the displayed value (mixing sphere `<->` with spheroid `ST_Distance` made pages skip/repeat rows — caught by our tests). The cursor distance is bound as a string because Prisma serialises floats with ~15 significant digits.
5. **Fan-out streaming**: emergency alerts notify everyone within 2 km via `streamUserIdsWithin()` — id-keyset batches of 1,000, so memory is flat for 100k recipients.
6. **Denormalise location onto posts** so the feed never joins users.

Verified by `tests/geo.test.ts`: 10,000 users in 2 km + 2,000 decoys → exact counts, `EXPLAIN` shows `users_homeLocation_idx` and no seq scan, average page latency < 100 ms (≈5 ms locally), 7 fan-out batches covering all 10,000 exactly once.

**Scaling further:** read replicas for feed/directory reads; partition `posts` by month; cache first feed pages per ~500 m geohash cell (Redis, 30 s TTL); move jobs to BullMQ/pg-boss; PgBouncer in transaction mode in front of Postgres.

## 3. Trust & verification without manual overhead

Level is **derived from evidence** by `recomputeLevel()`, never set by a route — downgrades (moving home, being removed from a society) are automatic.

| Level | How | Unlocks |
|---|---|---|
| `PHONE` | OTP (Indian SIMs are KYC'd → real identity anchor) | Read the feed |
| `LOCATION` | Home pin + **2 on-device GPS checks ≥ 6 h apart** within 200 m, accuracy ≤ 150 m, mock-location flag rejected | Post, comment, message, list businesses/workers, create a society |
| `ADDRESS` | Any one of: approval by the RWA of a **platform-verified** society (home within 500 m); invite code + auto-approve; **2 vouches** from ADDRESS-verified neighbours within 1 km (max 5 vouches/month each) | Vouch for others & workers, full trust badge |

Humans review only: **societies** (RWA registration certificate — one review unlocks hundreds of residents, retroactively), flagged content (auto-hidden at 3 reports), and flagged ads. Anti-abuse: society creation requires LOCATION + living within 300 m + no other society within 75 m; vouching is geo-fenced and rate-limited; OTP sends are limited per phone (30 s cooldown, 5/h) and per IP.

## 4. The cold-start problem

Technical levers built in:
- **Adaptive radius** — if a user's radius has < 8 posts in 30 days, the first feed page widens to 5 km and says so (`expanded: true`), instead of showing an empty app.
- **Seeded neighbourhoods** — admins import ward/OSM polygons as GeoJSON (`POST /v1/admin/neighborhoods`, `ST_MakeValid` repairs bad data); residents who signed up earlier are adopted automatically. Neighbourhoods graduate SEEDED → ACTIVE at 25 members.
- **Society-led growth** — one RWA admin registers the society, shares an 8-char invite code on the existing WhatsApp group, and can enable auto-approve: whole buildings onboard in a day. This is the primary acquisition loop in India.
- **Supply-side seeding** — businesses and workers can be listed by residents (with consent), so the Local tab is useful before shop owners join; "Newly opened" badges + free offers give businesses a reason to join early.
- **Feed stats** ("48 neighbours within 3 km") create social proof; the empty state pushes the first post.

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
| Blocking | Bidirectional: hides posts, comments, directory rows and prevents messages |

## 6. Security checklist

helmet, explicit CORS allow-list in production, JSON body limit, global + route rate limits (IPv6-safe keys), zod on every input, parameterised SQL only, image magic-byte sniffing (no SVG/HTML uploads), HMAC'd OTPs/refresh tokens, timing-safe comparisons, Razorpay signature + server-side amount check, nonce-based CSP on the checkout page, and **refuse-to-boot** in production with dev OTP, wildcard CORS or placeholder secrets.

## 7. Known limitations / next steps
- Chat uses 4 s polling; upgrade path is a WebSocket gateway (or Supabase Realtime) behind the same endpoints.
- The background job runner is in-process; with >1 API replica, swap `enqueue()` for BullMQ/pg-boss.
- Rate-limit store is in-memory; use the Redis store when horizontally scaling.
- i18n: language preference is stored; UI strings are English-only for now.
- Native Razorpay SDK (`react-native-razorpay`) can replace the hosted checkout in a dev build.
