# Deployment Guide — Neon + two Vercel projects

Free plans are enough: Neon Free, Vercel Hobby, Cloudflare Turnstile free. Never enter payment details.

## 1. GitHub

1. Create a repository for the team (public, or invite the module leader).
2. From the project root: `git init`, `git branch -M main`, `git add .`, `git commit -m "Authentication and identity service"`, add origin, `git push -u origin main`.
3. Verify `backend/.env` and `node_modules/` are not listed by `git status` before committing.

## 2. Neon

1. Create a project and keep default `neondb`; choose a US East region to be close to Vercel's default region.
2. In **Connection Details**, select branch `production`, database `neondb`, and copy the **pooled** connection string (hostname contains `-pooler`). This is the `DATABASE_URL` used by the app and by Vercel.
3. Also copy the **direct** connection string (same host without `-pooler`). Use the direct one for schema migrations; the pooled one is for normal application traffic.
4. Run the whole `backend/db/schema.sql` in the SQL Editor, or apply it with the direct connection string. Confirm `users`, `donors`, `donations` and the two indexes exist.
5. Logging into the Neon website with GitHub is **not** the same as CLI authentication. Run `neon login` in a terminal and finish the browser flow. Confirm with `neon status`; it should show the linked project and branch.
6. Install `npm i @neon/config` at the project root so `neon.ts` can be evaluated. Then run `neon deploy`. It applies `neon.ts`, reports `No changes` when the branch already matches the policy, and pulls `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_BRANCH_ID` and `NEON_FUNCTION_HOST_SUFFIX` into the root `.env.local` file.

## 3. Cloudflare Turnstile

1. For **local development you do not need a domain or host**. The code already uses the official test keys: site key `1x00000000000000000000AA`, secret key `1x0000000000000000000000000000000AA`, and dummy token `XXXX.DUMMY.TOKEN.XXXX`.
2. For production, deploy the frontend first, open the Vercel URL, and copy only the hostname from the address bar. Example: if the URL is `https://blood-donation-tasneem.vercel.app`, the hostname is `blood-donation-tasneem.vercel.app`.
3. Cloudflare dashboard → Turnstile → Add widget.
4. In **Widget settings → Allowed hostnames** (some screens call this **Domains** or **Host**), paste only that hostname. Do **not** include `https://`, a path, or a port. Do not add `www.` unless your real URL contains it. You can add more hostnames later.
5. Choose Widget Mode: Managed.
6. Copy the Site Key (public, goes in `frontend/js/config.js`) and Secret Key (private, goes only in the API's Vercel environment variables).
7. Replace `YOUR-TURNSTILE-SITE-KEY` and `YOUR-API-PROJECT.vercel.app` in `frontend/js/config.js` and `frontend/vercel.json` with the real deployed values, then redeploy both Vercel projects.

## 4. Vercel project 1 — API

1. Vercel → Add New → Project → Import the repository.
2. Project name: `<team>-auth-api`.
3. Root Directory: **backend**. Framework preset: Express. Leave build/output settings at defaults.
4. Environment variables:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Neon pooled connection string |
| `JWT_SECRET` | long random value (≥32 chars) |
| `TURNSTILE_SECRET_KEY` | real Cloudflare secret |
| `CORS_ORIGINS` | `http://localhost:8080` initially; add the deployed frontend domain later |
| `DONATION_INTERVAL_DAYS` | `56` |
| `INTERNAL_SERVICE_TOKEN` | shared secret for Booking/check-in |
| `METRICS_TOKEN` | shared secret for monitoring |
| `NODE_ENV` | `production` |
| `JWT_EXPIRES_IN` | `1h` |

5. Deploy. `server.js` exports the Express app, and `require.main === module` prevents `app.listen` from running inside Vercel.
6. Verification:
   - `<api-domain>/api/health` → `{"status":"ok","environment":"production"}`
   - `<api-domain>/api/auth/ready` → 200 if the database is configured
   - `<api-domain>/` → endpoint list

If health works but readiness returns 503, the deployment is fine and `DATABASE_URL` is wrong. If both 404, check that Root Directory is `backend`.

## 5. Vercel project 2 — frontend

1. Add New → Project → Import the **same** repository again.
2. Project name: `<team>-auth-web`. Root Directory: **frontend**. Framework preset: Other.
3. Before deploying, replace the two placeholders:
   - `frontend/js/config.js`: `YOUR-API-PROJECT.vercel.app` → your API domain; `YOUR-TURNSTILE-SITE-KEY` → your real site key.
   - `frontend/vercel.json`: `YOUR-API-PROJECT.vercel.app` in `connect-src` → your API domain.
4. Commit and push those changes.
5. Deploy. The site is served from Vercel's CDN with no build step.
6. Verification: open the site, see the Turnstile widget, register a donor.

## 6. Connect the two projects

1. API project → Settings → Environment Variables → edit `CORS_ORIGINS` to `http://localhost:8080,https://<web-domain>.vercel.app` (no trailing slash).
2. Deployments → latest → ⋯ → Redeploy. Environment changes only apply to new deployments.
3. Refresh the frontend; requests should now succeed without CORS errors.
4. Check headers with `curl.exe -I https://<web-domain>.vercel.app`: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy and COOP should appear.
5. Add `<web-domain>` to your Cloudflare widget's Allowed Hostnames if you created the widget before the domain existed.

## 7. Post-deployment checks

- Register/login with the real widget and confirm 201/200 in DevTools Network.
- `GET /api/auth/metrics` with `X-Metrics-Token` shows non-zero counters.
- Vercel → API → Logs shows JSON log lines with request IDs and named events.
- Neon Tables shows the new `users`, `donors` and `donations` rows.
- Booking and check-in calls work with the shared service token (see `docs/integration.md`).

## 8. Docker (local or VM)

Docker is an alternative to running two local Node processes. It is useful for demonstrating the whole stack on one machine or on a small VM. Neon is still the external database, so `DATABASE_URL` must be reachable from the container.

1. Install Docker Desktop and start it. Verify with `docker --version` and `docker compose version`.
2. From the project root run `npm run docker:up`. This builds `backend/Dockerfile` and `frontend/Dockerfile`, then starts both containers.
3. Open `http://localhost:8080`. The API is on `http://localhost:3000/api/auth`.
4. Check health with `http://localhost:3000/api/auth/health` and `http://localhost:3000/api/auth/ready`.
5. Use `npm run docker:ps` for status, `npm run docker:logs` for structured logs, and `npm run docker:down` to stop.
6. `docker-compose.yml` injects `backend/.env` with `env_file`; the secret is not baked into the image. After changing `.env`, run `docker compose up -d --force-recreate api`.
7. If you access the frontend from another machine, the browser hostname will not be `localhost`, so `frontend/js/config.js` will use the production placeholder URL. For remote demos, either use a hostname that is in `localhost`/`127.0.0.1` via port forwarding, or replace the production placeholders with real deployed URLs.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 500 on all data endpoints, health OK | `DATABASE_URL` missing/wrong | Check the Vercel env var and redeploy |
| 403 `BOT_CHECK_FAILED` in production | Real secret key not set, or widget hostname mismatch | Set the secret in the API project; register the hostname in Cloudflare |
| CORS error in browser | Frontend domain missing from `CORS_ORIGINS` | Add it and redeploy the API |
| Turnstile widget blank | CSP blocks the script/frame | Ensure `script-src`, `frame-src` and `connect-src` include `https://challenges.cloudflare.com` |
| 401 on internal calls | Service token mismatch | Use the exact token from the API environment |
| 404 at API root | Wrong Root Directory | Set it to `backend` and redeploy |
