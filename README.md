# Blood Donation System — Authentication, Identity, Logging and Monitoring

This folder contains one complete service of the group project: **Authentication and identity** plus **Logging and monitoring**. It is written with the same stack as the module labs (Node.js/Express, Neon Postgres, Vercel, Cloudflare Turnstile) and can run locally or as two Vercel projects.

No code comments are used anywhere in `backend/` or `frontend/`. Every design decision is explained in this README and in `docs/`.

---

## 1. What this part delivers

| Area | Delivered |
| --- | --- |
| Functions (more than three) | Register, Login, Donor profile (read + update), Eligibility check, Donation history, Record donation |
| Screens | Register/Login screen, Profile screen, Eligibility banner, Donation history table |
| Business logic | Next eligible date = last donation date + 56 days (configurable with `DONATION_INTERVAL_DAYS`), password hashing with bcrypt, JWT signed with HS256, eligibility enforced again when a donation is recorded |
| Neon tables | `users`, `donors`, `donations` |
| External service | Cloudflare Turnstile bot check on **register** and **login**; server-side verification against `siteverify` |
| Integration | `GET /api/auth/donors/:donorId/eligibility` for the Booking service; `POST /api/auth/donations` with a service token for check-in |
| Logging & monitoring | Structured JSON logs, request IDs, request/error/auth/donation/eligibility events, `/api/auth/health`, `/api/auth/ready`, `/api/auth/metrics`, security headers, rate limiting |

### Architecture

```mermaid
flowchart LR
  U[Donor browser] -->|HTTPS / JSON| W[Vercel CDN: frontend]
  W -->|fetch + JWT| A[Vercel Function: Express API]
  T[Cloudflare Turnstile siteverify] <-.->|token check| A
  B[Booking service] -->|X-Service-Token| A
  C[Check-in kiosk] -->|X-Service-Token| A
  A -->|SQL over TLS: DATABASE_URL| N[(Neon Postgres)]
  V[Vercel Logs / runtime logs] <--- A
```

Cloud model: **PaaS/serverless**. The frontend is static on Vercel's CDN, the API is one auto-scaling Vercel Function, and the database is managed serverless Postgres on Neon. This suits a small coursework app because there is no server to maintain, free tiers are sufficient, secrets stay in environment variables, and every push to GitHub redeploys automatically.

### Request flow examples

```
REGISTER: browser form -> Turnstile widget -> POST /api/auth/register + X-Turnstile-Token
       -> API validates -> Cloudflare verifies token -> bcrypt hash -> INSERT users + donors
       -> JWT issued -> 201 + token -> dashboard opens
```

```
LOGIN: POST /api/auth/login + X-Turnstile-Token -> Cloudflare verifies -> find user by email
       -> bcrypt.compare -> JWT issued -> 200 + token
```

```
ELIGIBILITY: GET /api/auth/eligibility (Bearer JWT) -> load last donation -> last + 56 days
       -> { eligible, nextEligibleDate, daysRemaining } -> banner updates
```

```
BOOKING: GET /api/auth/donors/{id}/eligibility + X-Service-Token -> same eligibility result
CHECK-IN: POST /api/auth/donations + X-Service-Token + { donorId, donatedAt, location, amountMl }
       -> eligibility re-checked -> INSERT donations -> 201
```

---

## 2. Repository structure

```
.
├── README.md                         this file
├── .gitignore                        keeps .env and node_modules out of Git
├── backend/
│   ├── app.js                        Express app factory (middleware, CORS, routes, errors)
│   ├── server.js                     loads .env + config, builds dependencies, starts/export app
│   ├── config.js                     validates environment variables
│   ├── .env.example                  template with safe test values and empty secrets
│   ├── db/
│   │   ├── schema.sql                users, donors, donations + indexes
│   │   └── neon.js                   creates the Neon SQL tagged-template client
│   ├── repositories/
│   │   └── authRepository.js         all SQL queries (create/read/update/search)
│   ├── services/
│   │   ├── password.js               bcrypt hashing and comparison
│   │   ├── token.js                  JWT sign/verify
│   │   ├── eligibility.js            pure 56-day calculation
│   │   ├── metrics.js                in-memory counters
│   │   └── logger.js                 JSON log writer
│   ├── middleware/
│   │   ├── turnstile.js              server-side Cloudflare verification
│   │   ├── authenticate.js           Bearer JWT and service-token authentication
│   │   ├── requestLogger.js          request ID, duration, status, counters
│   │   ├── metricsAuth.js            protects /metrics with X-Metrics-Token
│   │   └── errorHandler.js           404 and central error responses
│   ├── controllers/authController.js HTTP logic for all endpoints
│   ├── routes/authRoutes.js          endpoint table
│   ├── utils/                        validation, errors, response shape
│   ├── test/                         34 automated tests (node:test + fetch)
│   └── testing/fakes.js              in-memory repository used by tests
└── frontend/
    ├── index.html                    all four screens
    ├── css/styles.css
    ├── js/config.js                  API URL and public Turnstile site key
    ├── js/app.js                     API calls, rendering, form handling
    ├── vercel.json                   security headers and CSP
    └── package.json                  npm start -> local static server on 8080
```

Detailed contracts are in `docs/api-contract.md`, `docs/data-model.md`, `docs/test-plan.md`, `docs/integration.md`, `docs/deployment.md` and `docs/individual-contribution.md`.

---

## 3. How this part was built, step by step

1. **Defined the contract first.** I listed the resources (`auth`, `donors`, `donations`), chose nouns for paths, and wrote method, body, validation and status codes for each endpoint in `docs/api-contract.md`. This let the frontend and the other services be designed against a fixed interface.
2. **Designed the data model.** I created three Neon tables: `users` holds credentials and role, `donors` holds profile data with a one-to-one `user_id` foreign key, `donations` holds history with a `donor_id` foreign key. A composite index on `(donor_id, donated_at DESC)` makes "last donation" and history queries fast. See `docs/data-model.md`.
3. **Split the backend into layers.** `routes` maps URLs, `controllers` handle HTTP and validation, `repositories` own SQL, `services` hold pure business logic. Because `app.js` is a factory that receives its dependencies, tests can inject a fake repository and run without a database or network.
4. **Implemented password hashing.** `bcryptjs` hashes with a configurable cost (12 by default). Plain passwords are never stored or logged. Login compares with `bcrypt.compare`.
5. **Implemented JWT authentication.** `jsonwebtoken` signs HS256 tokens containing `sub` (user id), `email`, `donorId` and `role`, with issuer/audience checks and expiry. The auth middleware verifies the signature, then loads the identity from Neon so a deleted user cannot keep using an old token.
6. **Implemented the eligibility rule as a pure function.** `evaluateEligibility(lastDonatedAt, now, intervalDays)` adds 56 days to the last donation using UTC milliseconds, returns `eligible`, `reason`, `nextEligibleDate`, `daysRemaining` and `lastDonatedAt`. Pure functions are easy to unit-test and are reused by the banner, the Booking endpoint and the donation check-in.
7. **Added the hard part of the business rule.** Recording a donation calls eligibility again. If a check-in sends a backdated `donatedAt`, the repository queries the last donation **before that timestamp** (`getLastDonationBefore`), so a future record cannot incorrectly block a historical one. This bug was found by the automated tests and fixed.
8. **Added Turnstile on the trust boundary.** The widget sends a token in `X-Turnstile-Token`; the server calls Cloudflare `siteverify` with the secret key and a 5-second timeout before register/login logic runs. A missing secret fails closed with 500; a failed token returns 403. An optional hostname check prevents a widget from another site being replayed.
9. **Added validation and consistent errors.** All request bodies are validated server-side with field-level messages. Errors use one shape: `{ error: { code, message, details? } }`. Status codes: 200, 201, 400, 401, 403, 404, 409, 413, 429, 500, 503.
10. **Added logging and monitoring.** Every response emits one JSON line with request ID, method, path, status, duration and user ID. Security-relevant events (register, login success/failure, profile update, eligibility check, donation recorded/rejected, bot check rejection, DB failure) have their own event names. Health, readiness and metrics endpoints expose operational state; metrics are protected by a token.
11. **Hardened the API.** `helmet()` adds security headers, CORS uses an explicit allow-list, JSON bodies are limited to 16 kb, and register/login are rate limited.
12. **Built the four screens.** Plain HTML/CSS/JS keeps deployment simple. The auth screen has Login and Register tabs with two Turnstile widgets; after success the dashboard shows the eligibility banner, editable profile and donation history table. All values are inserted with `textContent`, so user data is never interpreted as HTML.
13. **Wrote and ran tests.** `npm test` runs 34 tests: pure eligibility cases plus HTTP tests with an in-memory repository. All 34 pass locally. The same scenarios are written as a manual test plan in `docs/test-plan.md` for Postman/browser/cloud evidence.
14. **Documented deployment and integration.** `docs/deployment.md` lists every manual cloud step; `docs/integration.md` gives Booking and check-in teams exact request examples.

---

## 4. Local setup

### 4.1 Prerequisites

- Node.js 20 or newer (Node 22/24 recommended)
- A free Neon account and a free Vercel account (both can use the same GitHub account)
- A free Cloudflare account only if you want real Turnstile keys; local testing uses Cloudflare's official test keys

### 4.2 Create the database

1. In Neon create a project (name it for your team) and keep the default `neondb` database and a US East region.
2. Open **SQL Editor**, paste all of `backend/db/schema.sql`, and run it. Confirm the three tables and the two indexes exist.
3. Copy the pooled connection string from **Connect**. It looks like `postgresql://USER:PASSWORD@HOST-pooler.REGION.aws.neon.tech/neondb?sslmode=require`.

### 4.3 Configure the backend

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Edit `backend/.env`:

| Variable | Local value |
| --- | --- |
| `DATABASE_URL` | the Neon connection string from step 4.2 |
| `JWT_SECRET` | generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `TURNSTILE_SECRET_KEY` | keep the test key `1x0000000000000000000000000000000AA` for localhost |
| `CORS_ORIGINS` | `http://localhost:8080` |
| `INTERNAL_SERVICE_TOKEN` | any long random string shared with Booking/check-in teams |
| `METRICS_TOKEN` | any long random string for monitoring access |
| `DONATION_INTERVAL_DAYS` | `56` |

Never commit `backend/.env`. It is ignored by Git.

### 4.4 Run locally

Use two terminals:

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm install
npm start
```

Open `http://localhost:8080`. The API is on `http://localhost:3000/api/auth`. Confirm with `http://localhost:3000/api/auth/health`.

The frontend's `config.js` automatically uses the localhost API and the official Turnstile test site key `1x00000000000000000000AA` when `window.location.hostname` is `localhost` or `127.0.0.1`.

### 4.5 Build and Neon CLI

Run these from the project root:

```powershell
npm run build
npm test
npm start
```

`npm run build` syntax-checks every JavaScript file, validates the JSON files, and checks that all required files exist. The app already talks to Neon through `DATABASE_URL`, so the Neon CLI is optional for normal runs. If you want the CLI-managed env pull, run `neon login` in a terminal and finish the browser flow (logging into the Neon website with GitHub is not enough), then run `npm i @neon/config` and `neon deploy`. It applies `neon.ts` and writes the branch's Neon variables into the root `.env.local` file.

The `production` branch already has `users`, `donors` and `donations` plus both indexes. The end-to-end run created one user, one donor and three donation rows in Neon.

### 4.6 Run with Docker

Docker runs the API and the static frontend as two containers. Neon remains the external database; there is no local database container.

```powershell
npm run docker:up
```

Open `http://localhost:8080`. The API is on `http://localhost:3000/api/auth`.

Useful commands:

```powershell
npm run docker:ps
npm run docker:logs
npm run docker:down
```

`docker-compose.yml` passes `backend/.env` and the Neon-pulled `.env.local` into the API container with `env_file`, so secrets are never copied into the image and fresh Neon values take precedence. If you change either file, recreate the API container:

```powershell
docker compose up -d --force-recreate api
```

### AWS emulator deployment (Floci equivalent)

A Floci account is not available in this workspace, so the same architecture was deployed to **LocalStack 3.8.0**, an equivalent AWS emulator. Five AWS services belong to this student's part: **API Gateway (REST API), Lambda, IAM, CloudWatch Logs and S3**. Neon remains the external Postgres database and Cloudflare Turnstile the external bot-protection API.

```powershell
npm run aws:up       # start LocalStack on http://localhost:4566
npm run aws:deploy   # create IAM role, Lambda, API Gateway, CloudWatch log group and S3 bucket
npm run aws:down     # stop the emulator
```

`scripts/deploy-localstack.ps1` generates `frontend/js/config.js` with the deployed API Gateway URL and uploads the frontend to S3. The Lambda entry point is `backend/handler.js`, which wraps the same Express app with `@vendia/serverless-express`. Secrets are read from `backend/.env` and `.env.local` and injected into the Lambda environment; they are never printed or committed.

Verified on the emulator: API Gateway → Lambda → Neon end-to-end suite 16/16, structured JSON logs in CloudWatch, and S3 frontend HTTP 200.

---

## 5. Manual tasks only you can do

These need your accounts, secrets or deployed URLs, so I could not finish them in the code. Nothing here is a code change; tell me the public values if you want me to update the docs with them.

| # | Manual task | Where | What to send me afterwards |
| --- | --- | --- | --- |
| 1 | Create the Neon project and run `backend/db/schema.sql` | neon.com → SQL Editor | Confirmation that three tables exist (screenshot) |
| 2 | Copy your real Neon connection string into `backend/.env` | local file only | **Do not send the password.** Send only the host/region if you need help |
| 3 | Generate a real `JWT_SECRET`, `INTERNAL_SERVICE_TOKEN` and `METRICS_TOKEN` | local `.env` + Vercel dashboard | Confirmation they are set; never send the values |
| 4 | Create a Cloudflare Turnstile widget for your deployed frontend hostname | Cloudflare → Turnstile → Add widget | The **public site key** (safe to share) and confirmation the secret is in Vercel only |
| 5 | Replace `YOUR-TURNSTILE-SITE-KEY` in `frontend/js/config.js` | local file | Tell me your site key and I can update it |
| 6 | Import `backend` as Vercel project (API) and set env vars | vercel.com | Deployed API domain, e.g. `...vercel.app` |
| 7 | Import `frontend` as Vercel project (Web) | vercel.com | Deployed frontend domain |
| 8 | Replace `YOUR-API-PROJECT` in `frontend/js/config.js` and `frontend/vercel.json` | local files | Your API domain and I can update both |
| 9 | Add the frontend domain to `CORS_ORIGINS` on the API project and redeploy | Vercel → API → Settings → Environment Variables | Confirmation |
| 10 | Create the team GitHub repository, push, and invite the module leader | GitHub | Repository URL and commit hashes for your contribution |
| 11 | Capture evidence: Postman responses, Neon table view, Vercel logs, browser screens, Network tab | local + cloud | Screenshots/response bodies so I can fill the `Actual result` and `Evidence` columns of `docs/test-plan.md` |
| 12 | Record the demo video on the deployed URL | screen recorder | Link for the report |
| 13 | Agree the service token with the Booking and check-in students | team chat | Confirmation so I can note the integration as tested |

Security rule: **never paste `DATABASE_URL`, `JWT_SECRET`, `TURNSTILE_SECRET_KEY`, `INTERNAL_SERVICE_TOKEN` or `METRICS_TOKEN` into GitHub, screenshots, chat or the report.** The site key is public by design.

---

## 6. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | - | Neon Postgres connection used by every data operation |
| `JWT_SECRET` | Yes | - | HMAC key for signing tokens; must be at least 32 characters |
| `TURNSTILE_SECRET_KEY` | Yes | - | Private key sent to Cloudflare `siteverify` |
| `JWT_EXPIRES_IN` | No | `1h` | Token lifetime |
| `BCRYPT_ROUNDS` | No | `12` | Password hashing cost (4–15) |
| `DONATION_INTERVAL_DAYS` | No | `56` | Minimum days between donations |
| `CORS_ORIGINS` | No | `http://localhost:8080` | Comma-separated browser origins |
| `TURNSTILE_EXPECTED_HOSTNAME` | No | empty | If set, the verified token's hostname must match |
| `INTERNAL_SERVICE_TOKEN` | No | empty | Enables Booking/check-in service calls |
| `METRICS_TOKEN` | No | empty | If set, `/metrics` requires `X-Metrics-Token` |
| `RATE_LIMIT_MAX` | No | `20` | Register/login attempts per window |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate-limit window (15 minutes) |
| `PORT` | No | `3000` | Local listening port |
| `NODE_ENV` | No | `development` | Controls logs and trust proxy |

`config.js` fails fast at startup if a required value is missing or invalid, so a misconfiguration is obvious in the Vercel logs instead of appearing as a random 500 later.

---

## 7. Testing in detail

### 7.1 Automated tests (no cloud needed)

```powershell
cd backend
npm test
```

Expected: `tests 34`, `pass 34`, `fail 0`. These cover health/readiness, registration success/validation/duplicate/bot check, login success and failures, JWT protection, profile read/update, eligibility with no donation and inside the 56-day window, donation recording, 409 rejection, history ordering, Booking service call, check-in service call, metrics protection and 404 handling. The eligibility unit tests cover 55 days, exactly 56 days, no donation and a configurable interval.

### 7.2 Manual API tests against real Neon (Postman or curl)

Start the backend with `npm run dev`, then run these requests. Replace the token with the one returned by register/login.

```powershell
curl.exe -i http://localhost:3000/api/auth/health
curl.exe -i http://localhost:3000/api/auth/ready

curl.exe -i -X POST http://localhost:3000/api/auth/register `
  -H "Content-Type: application/json" -H "X-Turnstile-Token: XXXX.DUMMY.TOKEN.XXXX" `
  -d '{\"fullName\":\"Test Donor\",\"email\":\"test@example.com\",\"password\":\"Donor2026\",\"bloodType\":\"O+\"}'

curl.exe -i -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" -H "X-Turnstile-Token: XXXX.DUMMY.TOKEN.XXXX" `
  -d '{\"email\":\"test@example.com\",\"password\":\"Donor2026\"}'

curl.exe -i http://localhost:3000/api/auth/me -H "Authorization: Bearer PASTE_TOKEN"
curl.exe -i http://localhost:3000/api/auth/eligibility -H "Authorization: Bearer PASTE_TOKEN"
curl.exe -i http://localhost:3000/api/auth/donations -H "Authorization: Bearer PASTE_TOKEN"

curl.exe -i -X POST http://localhost:3000/api/auth/donations `
  -H "Authorization: Bearer PASTE_TOKEN" -H "Content-Type: application/json" `
  -d '{\"donatedAt\":\"2026-01-01T10:00:00Z\",\"location\":\"Clinic\",\"amountMl\":450}'

curl.exe -i -X PUT http://localhost:3000/api/auth/profile `
  -H "Authorization: Bearer PASTE_TOKEN" -H "Content-Type: application/json" `
  -d '{\"city\":\"Amman\",\"phone\":\"+123456789\"}'

curl.exe -i http://localhost:3000/api/auth/donors/PASTE_DONOR_UUID/eligibility `
  -H "X-Service-Token: YOUR_SERVICE_TOKEN"

curl.exe -i -X POST http://localhost:3000/api/auth/donations `
  -H "X-Service-Token: YOUR_SERVICE_TOKEN" -H "Content-Type: application/json" `
  -d '{\"donorId\":\"PASTE_DONOR_UUID\",\"donatedAt\":\"2025-01-01T10:00:00Z\",\"location\":\"Check-in Desk\"}'

curl.exe -i http://localhost:3000/api/auth/metrics -H "X-Metrics-Token: YOUR_METRICS_TOKEN"
```

A Postman collection is not required, but the table in `docs/test-plan.md` gives the exact expected status/body for each request. Fill in the `Actual result` and `Evidence` columns with your responses.

### 7.3 Browser tests

1. Open `http://localhost:8080`. The Login tab is active and the Turnstile test widget is visible.
2. Submit an empty or invalid form: the API returns 400 and the message appears in red.
3. Switch to Register, fill the form, complete the bot check and submit: you land on the dashboard.
4. Check the eligibility banner: with no donations it says "You are eligible to donate" and the next date is `-`.
5. Edit the profile (for example city), save, and reload the page: the new value persists because it came from Neon.
6. In Neon, open the `donations` table and insert a row for your donor with `donated_at` = today. Reload the dashboard: the banner turns amber, shows about 56 days remaining and the next eligible date.
7. Use the API to record another donation today: it returns 409 `NOT_ELIGIBLE`. This is the business rule being enforced server-side, not only in the UI.
8. Confirm the donation history table shows the new row sorted newest first.
9. Open DevTools → Network: check `POST /register`, `POST /login`, `GET /me`, `GET /eligibility`, `GET /donations` and their status codes. Check that the JWT appears in the `Authorization` request header and that no password appears anywhere.
10. Log out: the token is removed from `sessionStorage` and the protected calls cannot be made.

### 7.4 Cloud tests after deployment

1. `GET <api-domain>/api/health` → 200 `{"status":"ok",...}`.
2. `GET <api-domain>/api/auth/ready` → 200 if `DATABASE_URL` is correct; 503 if the database is unreachable.
3. `GET <api-domain>/api/auth/health` in a browser → 200; opening the API root shows the endpoint list.
4. Open the frontend domain, register and log in with **real** Turnstile keys. A missing widget token must show "Please complete the bot check first."
5. Open DevTools → Network and confirm requests go to `https://<api-domain>/api/auth/...`, not localhost.
6. Check `curl.exe -I <web-domain>` shows the security headers and the CSP with your API domain.
7. In Vercel → API → Logs, confirm JSON log lines such as `user_registered`, `user_logged_in`, `eligibility_checked`, `donation_recorded` and `http_request`.
8. Call `/api/auth/metrics` with `X-Metrics-Token` and record the counters for the demo.

### 7.5 Negative cases to demonstrate

| Case | Expected |
| --- | --- |
| Register without `X-Turnstile-Token` | 403 `BOT_CHECK_FAILED` |
| Register with invalid email or short password | 400 `VALIDATION_ERROR` with details |
| Register the same email twice | 409 `EMAIL_IN_USE` |
| Login with wrong password or unknown email | 401 `INVALID_CREDENTIALS` (same message, no account disclosure) |
| Protected endpoint with no/tampered/expired token | 401 `UNAUTHORIZED` |
| Service endpoint without service token | 401 |
| Profile update with an invalid blood type | 400 `VALIDATION_ERROR` |
| Second donation inside 56 days | 409 `NOT_ELIGIBLE` with `nextEligibleDate` |
| Donation with a future date or amount outside 200–500 | 400 `VALIDATION_ERROR` |
| Unknown route | 404 `ROUTE_NOT_FOUND` |

---

## 8. Logging and monitoring explained

- **Request logging:** `middleware/requestLogger.js` generates or accepts `X-Request-Id`, returns it in the response, and logs method, path, status, duration in ms, user ID and auth type when the response finishes. No headers, tokens or passwords are logged.
- **Event logging:** named JSON events (`user_registered`, `login_failed`, `profile_updated`, `eligibility_checked`, `donation_recorded`, `donation_rejected`, `turnstile_rejected`, `database_unavailable`, `request_failed`) go to stdout/stderr, which Vercel captures in Logs.
- **Error logging:** the central handler logs code, message, request ID and stack (stack only outside production) and sends a safe generic message to the client for 5xx errors.
- **Health:** `/api/auth/health` never touches the database, so it proves the function is running.
- **Readiness:** `/api/auth/ready` runs `SELECT 1` and returns 503 with `DATABASE_UNAVAILABLE` on failure.
- **Metrics:** `/api/auth/metrics` returns uptime and counters such as `requests.total`, `requests.status.200`, `auth.login.failed`, `turnstile.failed`, `eligibility.checked`, `donation.recorded`, `errors.total`.
- **Deployment monitoring:** use Vercel Observability/Log Drains in production. The in-memory counters are per serverless instance and are intended for demonstration; see Limitations.

---

## 9. Security decisions you can defend

- bcrypt (cost 12) instead of plain text or fast hashes, because password hashes must be slow to brute force.
- JWT with HS256, expiry, issuer and audience; the middleware re-checks the user in the database on every protected request.
- Tokens are kept in `sessionStorage`, not `localStorage`, so they disappear when the tab closes.
- Turnstile is verified on the server. A widget alone protects nothing because a bot can call the API directly.
- Generic `INVALID_CREDENTIALS` response avoids account enumeration; service-token comparison uses `timingSafeEqual`.
- Parameterised Neon tagged templates prevent SQL injection.
- Server-side validation is authoritative; frontend validation is only for convenience.
- `helmet()`, a CORS allow-list, 16 kb body limit, rate limiting and a strict CSP (including Turnstile domains) reduce common web attacks.
- Secrets exist only in `.env` locally and in Vercel environment variables.

---

## 10. Exam Q&A — be ready for these

**Q: What does your component do?**
A: It owns identity (register, login, profile), the donor-facing eligibility and donation history screens, and the operational logging/monitoring endpoints. It also exposes internal endpoints for Booking and check-in.

**Q: Why three tables?**
A: `users` holds authentication data, `donors` holds profile data (one-to-one with users), and `donations` holds the history (one-to-many from donors). Splitting users and donors means we can add staff/admin accounts without giving them donor profiles.

**Q: How is the next eligible date calculated?**
A: `lastDonatedAt + DONATION_INTERVAL_DAYS` in UTC milliseconds (default 56). If there is no previous donation, the donor is eligible immediately and `nextEligibleDate` is null. Days remaining is rounded up so a donor is never told "0 days" while still blocked.

**Q: What happens at exactly 56 days?**
A: `now >= due`, so the donor is eligible. There is a unit test for this boundary.

**Q: How do you stop someone from forging a donation history entry or forging eligibility?**
A: History and profile are keyed to the donor ID inside the verified JWT, not to an ID from the browser. Only service calls with the shared service token may pass an explicit `donorId`, and they still go through the same eligibility rule.

**Q: Where is the 56-day rule enforced?**
A: In the pure `eligibility.js` service. It is used by the donor banner, the Booking endpoint and the donation recording check-in, so the three paths cannot disagree.

**Q: Why check eligibility again when recording a donation?**
A: A booking may be made days before the actual donation. The check-in is the moment the donor physically donates, so the server must re-validate the interval to prevent an ineligible donation.

**Q: Why does a backdated donation use `getLastDonationBefore`?**
A: If a check-in imports a donation dated 100 days ago while a newer donation exists, the newer one must not be used as the "previous donation". Filtering by timestamp keeps historical imports correct. This was a real bug caught by the test suite and fixed.

**Q: Why bcrypt and not SHA-256?**
A: SHA-256 is fast and vulnerable to brute force/GPU attacks. bcrypt is deliberately slow and salted; the cost is configurable.

**Q: What is in the JWT and how is it invalidated?**
A: `sub`, `email`, `donorId`, `role`, `iat`, `exp`, issuer and audience. It expires after `JWT_EXPIRES_IN` (default 1 hour); logout removes it from the browser. Deleting the user also makes it fail because the middleware reloads the identity.

**Q: How does Turnstile actually protect you?**
A: The browser widget produces a one-time token. The server sends that token plus the secret key to Cloudflare's `siteverify`. Only a `success: true` response allows register/login. Missing secret fails closed.

**Q: Why do you have both rate limiting and Turnstile?**
A: Defence in depth. Turnstile distinguishes humans from bots; rate limiting also caps brute-force attempts if a token is obtained or the widget is bypassed.

**Q: What is the difference between health and readiness?**
A: Health proves the deployment/function is alive without dependencies. Readiness proves the database is reachable. If health works but readiness fails, the problem is `DATABASE_URL`, not the deployment.

**Q: What do the metrics show and what are their limits?**
A: Request counts by status and endpoint, auth successes/failures, bot-check failures, donation/eligibility counters and errors. On serverless, each instance has its own in-memory counters, so they reset; for long-term monitoring use Vercel logs/log drains and alerts.

**Q: How did you test your part?**
A: 34 automated tests with an injected in-memory repository, plus Postman/curl tests against real Neon, browser end-to-end tests, negative cases, and cloud verification after deployment. See `docs/test-plan.md`.

**Q: What was the hardest problem and how did you solve it?**
A: Two issues: (1) a backdated check-in donation was being compared with a newer donation and wrongly rejected — fixed with `getLastDonationBefore` and a regression test; (2) serverless has no persistent file system, so all state lives in Neon and logs/metrics go to stdout, with the limitation noted in the report.

**Q: How does another team call your service?**
A: Booking calls `GET /api/auth/donors/{donorId}/eligibility` with `X-Service-Token`; check-in calls `POST /api/auth/donations` with `X-Service-Token` and a body containing `donorId`. Exact examples are in `docs/integration.md`.

**Q: Why are there two Vercel projects?**
A: The frontend is static content on the CDN and the backend is a Node function. Using two projects keeps builds and environment variables separate; the API alone receives the database secret.

**Q: Why is the API address and site key in `config.js` but the secret key is not?**
A: The browser can read any frontend file, so only public values belong there. Secrets stay in environment variables read by the backend.

---

## 11. Limitations and proposed improvements

| Limitation | Reason | Improvement |
| --- | --- | --- |
| Metrics counters are in memory and reset per serverless instance | Vercel functions are ephemeral | Send metrics to a managed store or Vercel Log Drains and add alerts |
| JWT cannot be revoked before expiry without extra state | Stateless tokens | Add a token version column or a Redis deny-list |
| Eligibility uses a fixed day interval and does not check age, weight or medical deferrals | Scope was the 56-day rule | Add deferral rules as configuration and data fields |
| Donation history is capped at 100 rows | Keeps the dashboard light | Add pagination and filtering |
| Real Turnstile keys must use the registered hostname | Cloudflare design | Register every deployment hostname or use a wildcard pattern |
| Rate limiting is per instance on serverless | No shared memory | Use a shared store such as Upstash Redis |
| No password reset or email verification | Out of scope | Add signed one-time links via an email service |

---

## 12. Evidence checklist for the report

- [ ] Neon tables screenshot (`users`, `donors`, `donations`) after a registration and a donation
- [ ] Postman/curl request + response for register, login, eligibility, history, profile update and both internal endpoints
- [ ] Turnstile failure response without a token (403)
- [ ] 409 `NOT_ELIGIBLE` response with `nextEligibleDate`
- [ ] Browser screenshots: login/register, eligibility banner (eligible and waiting), profile, history
- [ ] DevTools Network screenshot showing JWT in the Authorization header
- [ ] Vercel Logs screenshot showing structured log events
- [ ] `/api/auth/health`, `/ready` and `/metrics` responses from the deployed domain
- [ ] GitHub commit history for this component
- [ ] Deployed frontend and API URLs, demo video link

Fill the `Actual result` and `Evidence` columns of `docs/test-plan.md` from these artefacts, and complete the placeholders in `docs/individual-contribution.md` before submitting the report.
