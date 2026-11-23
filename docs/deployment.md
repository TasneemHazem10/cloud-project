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
4. Run the whole `backend/db/schema.sql` in the SQL Editor, or apply it with the direct connection string. Confirm `users`, `donors`, `donations`, `sessions` and their indexes exist.
5. Copy the pooled connection string into `backend/.env` locally and into the `DATABASE_URL` environment variable of each deployment. That single variable is the only Neon configuration the app needs.

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
| `TURNSTILE_SECRET_KEY` | real Cloudflare secret |
| `CORS_ORIGINS` | `http://localhost:8080` initially; add the deployed frontend domain later |
| `DONATION_INTERVAL_DAYS` | `56` |
| `INTERNAL_SERVICE_TOKEN` | shared secret for Booking/check-in |
| `METRICS_TOKEN` | shared secret for monitoring |
| `NODE_ENV` | `production` |
| `SESSION_EXPIRES_IN` | `1h` |

5. Deploy. `server.js` exports the Express app, and `require.main === module` prevents `app.listen` from running inside Vercel.
6. Verification:
   - `<api-domain>/api/auth/health` → `{"status":"ok","environment":"production"}`
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
- Neon Tables shows the new `users`, `donors`, `donations` and `sessions` rows.
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

## 9. Floci AWS emulator deployment

This project also deploys the same service onto **Floci**, a free local AWS emulator that listens on port `4566`. No Floci account or auth token is needed. Docker Desktop must be running.

One-time AWS CLI profile setup (dummy keys, like the labs):

```powershell
aws configure set aws_access_key_id test --profile floci
aws configure set aws_secret_access_key test --profile floci
aws configure set region us-east-1 --profile floci
aws configure set endpoint_url http://localhost:4566 --profile floci
```

```powershell
npm run aws:up       # starts floci/floci:latest-compat from infra/floci/docker-compose.yml
npm run aws:deploy   # creates IAM, Lambda, HTTP API v2, CloudWatch log group and S3 frontend
npm run aws:down     # stops/removes the Floci container
```

`scripts/deploy-floci.ps1` reads `backend/.env`, injects those values into the Lambda environment, creates the IAM role and CloudWatch log group, packages `backend/lambda.js` (`serverless-http`) into `backend/lambda.zip`, deploys Lambda with `nodejs24.x` / `lambda.handler`, creates an **API Gateway HTTP API v2** with explicit routes and stage `$default`, then uploads `frontend/` with `aws s3 sync`. It writes the generated invoke URL to `frontend/js/config.js`. No secret value is printed.

Verification after deployment:

```powershell
# Health through API Gateway (use the ID printed by npm run aws:deploy)
curl.exe -i http://API_ID.execute-api.localhost.floci.io:4566/api/auth/health

# Frontend from S3
curl.exe -i http://localhost:4566/blood-donation-frontend/index.html
```

Expected: health `200 {"status":"ok",...}` and frontend `200`. On Floci Dash, HTTP APIs are not listed; verify with `aws apigatewayv2 get-apis`, `get-routes` and `get-stages`. The end-to-end harness can be run with `BASE_URL` set to the printed API Gateway URL. Verified: 16/16 through API Gateway → Lambda → Neon; CloudWatch log group `/aws/lambda/auth-identity-api` contains JSON request and event lines; S3 frontend returns HTTP 200.

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| 500 on all data endpoints, health OK | `DATABASE_URL` missing/wrong | Check the Vercel env var and redeploy |
| 403 `BOT_CHECK_FAILED` in production | Real secret key not set, or widget hostname mismatch | Set the secret in the API project; register the hostname in Cloudflare |
| CORS error in browser | Frontend domain missing from `CORS_ORIGINS` | Add it and redeploy the API |
| Turnstile widget blank | CSP blocks the script/frame | Ensure `script-src`, `frame-src` and `connect-src` include `https://challenges.cloudflare.com` |
| 401 on internal calls | Service token mismatch | Use the exact token from the API environment |
| 404 at API root | Wrong Root Directory | Set it to `backend` and redeploy |
