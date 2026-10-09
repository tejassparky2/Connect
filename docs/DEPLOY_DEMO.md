# Hosted demo on Render (free)

`render.yaml` deploys the API + a PostGIS database as a **demo**: OTPs are shown in the app (no SMS), so anyone can sign in as any number. Use demo data only.

## Deploy (≈10 minutes, mostly Render building)

1. Sign in at https://dashboard.render.com with GitHub and allow access to this repository.
2. **New → Blueprint** → pick this repo and the branch with `render.yaml` → **Apply**.
   (Or open `https://render.com/deploy?repo=https://github.com/tejassparky2/Connect`.)
3. Render creates `mohalla-db` (Postgres) and `mohalla-connect-api` (Docker). The first boot applies migrations and loads the Bengaluru demo data; later restarts keep your data.
4. When the service shows **Live**, copy its URL (e.g. `https://mohalla-connect-api.onrender.com`) and check `https://…/health` returns `{"ok":true,…}`.

## Use it from the app

Open the app → **Get started** → enter the Render URL (no `https://` needed) → **Test & save**. Demo logins: `99000 00001` (RWA admin), `…02` (resident), `…03` (café owner), `…09` (admin); the OTP appears on screen.

## Free-plan limits

- The service **sleeps after ~15 min idle**; the next request takes about a minute (the app wakes it at launch and waits up to 75 s when saving the server).
- The free database **expires after 30 days** (Render emails first) — upgrade or recreate.
- Photos are stored on the container's disk and are **lost on redeploy**. For persistence set `UPLOAD_DRIVER=s3` + an S3/R2 bucket.

## Going real

Set `OTP_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (DLT-registered SMS via MSG91), delete `DEMO_MODE` and `SEED_DEMO_DATA`, move to paid plans, and see the README production checklist.
