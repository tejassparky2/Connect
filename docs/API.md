# Mohalla Connect — REST API (v1)

Base URL `/v1`. JSON in/out. Auth: `Authorization: Bearer <accessToken>` (15 min JWT) + rotating refresh token.
Errors: `{ "error": { "code", "message", "details?" } }` — codes include `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `VERIFICATION_REQUIRED` (`details.requiredLevel`), `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `CONSENT_REQUIRED` (new user verified without `consent: true`).
Lists use opaque `cursor` / `nextCursor` keyset pagination. Money is integer **paise**. Distances are metres, rounded up to 100 m.

Level column: minimum verification level (— = any signed-in user).

## Auth & profile
| Method | Path | Level | Notes |
|---|---|---|---|
| POST | `/auth/otp/request` | public | `{phone}` → sends OTP (`devCode` only in dev). 60 s cooldown and 5/h per phone; 10 per IP per 15 min (`OTP_IP_LIMIT_PER_15MIN`) |
| POST | `/auth/otp/verify` | public | `{phone, code, consent?}` → `{accessToken, refreshToken, isNewUser, user}`. `consent: true` is required for new users (DPDP); it is checked before the OTP is consumed |
| POST | `/auth/refresh` | public | `{refreshToken}` → rotated pair (reuse ⇒ family revoked) |
| POST | `/auth/logout` | public | `{refreshToken}` |
| GET / PATCH / DELETE | `/me` | — | profile (incl. own phone, societies, businesses); PATCH name/bio/avatar/language/feedRadiusM (2–5 km); DELETE = DPDP erasure |
| PUT | `/me/address` | — | `{unit, building?, street?, locality, city, pincode, lat, lng}` sets home pin + neighbourhood; resets verification |
| GET | `/me/verification` | — | level, GPS progress, vouch count |
| POST | `/me/verification/gps` | — | `{lat, lng, accuracyM, isMocked?}` → `{passed, reasons[], level, progress}` |
| GET | `/me/neighborhood` | — | neighbourhood + neighbours/posts in radius |
| GET | `/me/neighbors` | LOCATION | verified neighbours nearest-first (sealed cursor) |
| GET | `/me/badges` | — | unread notifications / conversations |
| POST / DELETE | `/me/push-tokens` | — | Expo push token registration |
| GET | `/me/posts` | — | my posts & listings |
| GET | `/users/:id` | — | public profile (no phone/location) |
| POST / DELETE | `/users/:id/block` | — | bidirectional block |
| POST | `/users/:id/vouch` | ADDRESS | vouch neighbour lives at their address (≤1 km, 5/month) |

## Pillar 1 — Neighbours
| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `/feed?type&radius&cursor&limit` | — | geo-fenced feed → `{items, pinnedAlerts, sponsored, radiusM, expanded, nextCursor}` |
| POST | `/posts` | LOCATION | `type` ∈ GENERAL, HOBBY(`hobbyTag`), CLASSIFIED(`title, pricePaise, condition`), ALERT(`severity, expiresInHours`), LOST_FOUND(`title`), RECOMMENDATION, EVENT(`title, eventAt`); `images[]`. WARNING/CRITICAL alerts push to everyone within 2 km |
| GET / PATCH / DELETE | `/posts/:id` | — | readable within 10 km; PATCH title/body/price/isSold (author) |
| POST / DELETE | `/posts/:id/like` | — | idempotent |
| GET / POST | `/posts/:id/comments` | POST: LOCATION | |
| DELETE | `/comments/:id` | — | comment author or post author |
| GET / POST | `/conversations` | POST: LOCATION | inbox; start/continue chat `{userId, postId?, body}` |
| GET | `/conversations/:id` | — | other user + linked listing |
| GET / POST | `/conversations/:id/messages?after&cursor` | GET: — · POST: LOCATION | `after` = poll for new |
| POST | `/conversations/:id/read` | — | |
| POST | `/reports` | LOCATION | `{targetType, targetId, reason}`. 3 reports from trusted accounts (≥ 3 days old or ADDRESS-verified) auto-hide a post or comment; reports on posts/comments require the post to be visible to you |
| GET | `/notifications` · POST `/notifications/read-all` · POST `/notifications/:id/read` | — | |
| POST | `/uploads` (multipart `file`) | — | JPEG/PNG/WebP ≤ 5 MB, magic-byte checked → `{url}` |

## Pillar 2 — Local commerce
| Method | Path | Level | Notes |
|---|---|---|---|
| GET | `/businesses?category&q&radius&cursor` | — | nearest-first directory |
| GET | `/businesses/offers/nearby` | — | live announcements within 5 km |
| GET | `/businesses/mine` | — | |
| POST | `/businesses` | LOCATION | name, category, phone, whatsapp?, address, pincode, lat/lng, hours?, photos?, gstin? |
| GET / PATCH | `/businesses/:id` | — | owner sees wallet; name/GSTIN edits drop the verified badge |
| POST / DELETE | `/businesses/:id/announcements[/:aid]` | owner | ≤3/day |
| POST / DELETE | `/businesses/:id/reviews[/mine]` | POST: LOCATION · DELETE: — | one per user (upsert) |
| GET | `/businesses/:id/wallet` | owner | balance, mode (`razorpay` / `dev` / `disabled`), transactions |
| POST | `/businesses/:id/wallet/orders` | owner | `{amountPaise}` → Razorpay order + hosted `checkoutUrl` |
| POST | `/businesses/:id/wallet/verify` | owner | `{orderId, paymentId, signature}` — HMAC + server-side amount, idempotent |
| GET | `/providers?skill&q&cursor` | — | workers whose service radius covers you |
| POST | `/providers` | LOCATION | `{name, phone, skills[], …, consent: true}`; lister auto-vouches |
| POST | `/providers/claim` | — | a worker claims the listing whose phone matches their OTP-verified number |
| GET / PATCH | `/providers/:id` | GET: — · PATCH: lister or claimed worker | |
| POST | `/providers/:id/relocate` | lister or claimed worker | |
| POST / DELETE | `/providers/:id/vouch` | POST: ADDRESS · DELETE: — | |
| POST | `/providers/:id/reviews` | LOCATION | |
| GET | `/ads/estimate?businessId&radiusM` | owner | verified households in range |
| GET / POST | `/ads/campaigns` | GET `?businessId=` (required, owner) · POST: LOCATION + owner | create draft: headline, body, cta, radiusM, budgetPaise (≥₹100), cpmPaise, endAt |
| GET | `/ads/campaigns/:id` | owner | stats incl. CTR, remaining |
| POST | `/ads/campaigns/:id/{launch,pause,resume,end}` | owner | launch reserves budget; end refunds unspent |
| GET | `/ads/serve` | — | eligible ads for my home |
| POST | `/ads/:id/impression` · `/ads/:id/click` | LOCATION | deduped per user/day; CPM billing only if you are eligible for the ad; a click needs a prior impression |
| GET | `/pay/checkout?s=` · POST `/pay/complete` · POST `/pay/webhook` | public (signed) | hosted Razorpay Checkout + `order.paid` / `payment.captured` webhook |

## Pillar 3 — Societies / RWAs
All `/:id/...` routes below require an APPROVED membership; **staff** = RWA_ADMIN or RWA_COMMITTEE.

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/societies/nearby?q` | — | within 2 km of home |
| GET | `/societies/mine` | — | memberships + pending-request counts for staff |
| POST | `/societies` | LOCATION | creator becomes RWA_ADMIN; must live within 300 m; no duplicate within 75 m |
| GET / PATCH | `/societies/:id` | — / admin | public summary; members see stats; staff see invite code; PATCH name/requireApproval |
| POST | `/societies/:id/invite-code/rotate` | admin | |
| POST | `/societies/join` | — | `{societyId | inviteCode, tower?, unit, occupancy}`; home must be inside the compound |
| DELETE | `/societies/:id/membership` | member | last admin can't leave |
| GET | `/societies/:id/members?status=APPROVED|PENDING` | member / staff | directory / join queue |
| POST | `/societies/:id/members/:mid/{approve,reject}` | staff | approval in a verified society ⇒ ADDRESS level |
| PATCH | `/societies/:id/members/:mid` | admin | `{role}` or `{remove: true}` |
| GET / POST | `/societies/:id/notices` | member / staff | POST notifies all members; pinned first |
| PATCH / DELETE | `/societies/:id/notices/:nid` | staff | |
| GET / POST | `/societies/:id/tickets?status&mine` | member | private tickets visible to author + staff |
| GET / PATCH | `/societies/:id/tickets/:tid` | member | PATCH status: staff any; author CLOSED/OPEN |
| POST | `/societies/:id/tickets/:tid/comments` | member | |
| GET / POST / DELETE | `/societies/:id/vehicles[/:vid]` | member | normalised Indian plates (incl. BH series) |
| GET / POST | `/societies/:id/parking-alerts` | member | owner notified privately; unknown plate ⇒ committee |
| POST | `/societies/:id/parking-alerts/:aid/resolve` | reporter / owner / staff | |

## Admin (MODERATOR / ADMIN; items marked ADMIN-only need ADMIN)
`GET /admin/stats` · `POST /admin/neighborhoods` (GeoJSON import, ADMIN-only) · `GET /admin/reports` · `POST /admin/reports/:id/resolve` · `POST /admin/societies/:id/verify` · `POST /admin/businesses/:id/verify` · `POST /admin/providers/:id/id-verify` · `GET /admin/ads` · `POST /admin/ads/:id/review` · `POST /admin/users/:id/ban` (ADMIN-only) · `POST /admin/users/:id/recompute-level`

`GET /health` → `{ ok, db, version }` (503 when the DB is down)
