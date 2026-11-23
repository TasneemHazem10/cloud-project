# API Contract — Authentication, Identity, Eligibility and Monitoring

Base URL: `http://localhost:3000/api/auth` locally, `https://<api-project>.vercel.app/api/auth` in the cloud.

All request and response bodies are JSON. Timestamps are ISO 8601 UTC strings. IDs are UUIDs.

## Authentication types

| Type | Header | Used for |
| --- | --- | --- |
| Donor JWT | `Authorization: Bearer <token>` | `/me`, `/profile`, `/eligibility`, `/donations`, own donation recording |
| Service token | `X-Service-Token: <shared secret>` | Booking eligibility lookup and check-in donation recording |
| Metrics token | `X-Metrics-Token: <shared secret>` | `/metrics` when `METRICS_TOKEN` is configured |
| Bot check | `X-Turnstile-Token: <token>` | `/register` and `/login` only |

Every response includes `X-Request-Id`. Send your own `X-Request-Id` to trace a request across services.

## Endpoint summary

| # | Method | Path | Auth | Purpose | Success |
| --- | --- | --- | --- | --- | --- |
| 1 | POST | `/register` | Turnstile | Create user + donor, issue JWT | 201 |
| 2 | POST | `/login` | Turnstile | Verify password, issue JWT | 200 |
| 3 | GET | `/me` | JWT | Read own profile | 200 |
| 4 | PUT | `/profile` | JWT | Update own donor profile | 200 |
| 5 | GET | `/eligibility` | JWT | Own eligibility result | 200 |
| 6 | GET | `/donations` | JWT | Own donation history | 200 |
| 7 | POST | `/donations` | JWT or service | Record a donation (eligibility enforced) | 201 |
| 8 | GET | `/donors/:donorId/eligibility` | service | Booking eligibility lookup | 200 |
| 9 | GET | `/health` | none | Liveness | 200 |
| 10 | GET | `/ready` | none | Database readiness | 200 / 503 |
| 11 | GET | `/metrics` | metrics token | Operational counters | 200 |

The API root `/` lists all endpoint paths and the monitoring endpoints also exist at `/api/auth/*`.

---

## 1. POST `/register`

Request headers: `Content-Type: application/json`, `X-Turnstile-Token`.

```json
{
  "fullName": "Tasneem Ali",
  "email": "tasneem@example.com",
  "phone": "+12345678901",
  "bloodType": "O+",
  "dateOfBirth": "2000-05-14",
  "city": "Amman",
  "password": "Blood2026"
}
```

Validation: `fullName` 2–100 characters; `email` valid and ≤254; `password` 8–72 characters with at least one letter and one number; `phone` 7–30 characters from digits/spaces/`+`/`-`/`(`/`)`; `bloodType` one of `A+ A- B+ B- AB+ AB- O+ O-`; `dateOfBirth` a real `YYYY-MM-DD` date not in the future; `city` ≤100. Optional fields may be omitted and are stored as `NULL`.

Turnstile middleware runs **before** the controller. A missing or failed token returns 403 `BOT_CHECK_FAILED`.

Success `201`:

```json
{
  "token": "eyJhbGciOi...",
  "tokenType": "Bearer",
  "expiresAt": "2026-11-23T13:00:00.000Z",
  "expiresInSeconds": 3600,
  "user": { "id": "uuid", "email": "tasneem@example.com", "role": "donor", "createdAt": "..." },
  "donor": { "id": "uuid", "fullName": "Tasneem Ali", "phone": "+12345678901", "bloodType": "O+", "dateOfBirth": "2000-05-14", "city": "Amman", "createdAt": "..." }
}
```

Errors: 400 `VALIDATION_ERROR` (with `details` array), 403 `BOT_CHECK_FAILED`, 409 `EMAIL_IN_USE`, 429 `RATE_LIMITED`, 500 `INTERNAL_ERROR`.

The response never contains `passwordHash`.

## 2. POST `/login`

```json
{ "email": "tasneem@example.com", "password": "Blood2026" }
```

Validation: email format and non-empty password; Turnstile token required. Email is lower-cased before lookup.

Success `200`: same shape as register. Errors: 400 `VALIDATION_ERROR`, 401 `INVALID_CREDENTIALS` (wrong password **or** unknown account, identical message), 403 `BOT_CHECK_FAILED`, 429 `RATE_LIMITED`.

## 3. GET `/me`

Requires donor JWT. Returns `{ user, donor }` exactly like the register response but without token fields. Errors: 401 `UNAUTHORIZED`, 404 `IDENTITY_NOT_FOUND`.

## 4. PUT `/profile`

Requires donor JWT. At least one editable field must be supplied: `fullName`, `phone`, `bloodType`, `dateOfBirth`, `city`. `email`, `role` and IDs cannot be changed through this endpoint. Omitted fields keep their current values.

```json
{ "fullName": "Tasneem Ali Updated", "city": "Dubai" }
```

Success `200`: `{ user, donor }`. Errors: 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 404 `IDENTITY_NOT_FOUND`.

## 5. GET `/eligibility`

Requires donor JWT. No body.

Success `200`:

```json
{
  "donorId": "uuid",
  "eligible": false,
  "reason": "WAITING_PERIOD",
  "donationIntervalDays": 56,
  "lastDonatedAt": "2026-01-01T10:00:00.000Z",
  "nextEligibleDate": "2026-02-26T10:00:00.000Z",
  "daysRemaining": 12,
  "checkedAt": "2026-02-14T10:00:00.000Z"
}
```

`reason` is `NO_PREVIOUS_DONATION` (eligible, `nextEligibleDate: null`), `WAITING_PERIOD` or `READY`. Errors: 401, 404 `DONOR_NOT_FOUND`.

## 6. GET `/donations`

Requires donor JWT. Returns the 100 newest donations.

```json
{
  "donorId": "uuid",
  "count": 1,
  "donations": [
    { "id": "uuid", "donorId": "uuid", "donatedAt": "...", "location": "City Clinic", "amountMl": 450, "createdAt": "..." }
  ]
}
```

An empty history is still `200` with `count: 0` and `donations: []`. Errors: 401, 404.

## 7. POST `/donations`

Requires donor JWT (donor is taken from the token) **or** service token (`donorId` required in body).

```json
{ "donatedAt": "2026-01-01T10:00:00Z", "location": "City Clinic", "amountMl": 450 }
```

`donatedAt` optional (default now, cannot be in the future or before 1900), `location` optional (≤120), `amountMl` optional integer 200–500 (default 450). Eligibility is evaluated at `donatedAt`; only donations at or before that time are considered.

Success `201`: the created donation object. Errors: 400 `VALIDATION_ERROR`, 401, 404 `DONOR_NOT_FOUND`, 409 `NOT_ELIGIBLE` with `details.nextEligibleDate` and `daysRemaining`, 429.

## 8. GET `/donors/:donorId/eligibility`

Requires a valid service token. `donorId` must be a UUID. Response is the same eligibility object as endpoint 5. Used by the Booking service before confirming an appointment. Errors: 400 `VALIDATION_ERROR`, 401, 404.

An equivalent query form `GET /donors/:donorId/eligibility?donorId=...` is accepted for clients that cannot use path parameters; the path value wins.

## 9–11. Monitoring endpoints

`/health` → `{ status: "ok", service: "auth-identity", environment, uptimeSeconds, timestamp, requestId }`.

`/ready` → `{ status: "ready", database: "ok", timestamp }`; on failure `503 { error: { code: "DATABASE_UNAVAILABLE", message: "Database connection failed." } }`.

`/metrics` → `{ uptimeSeconds, startedAt, generatedAt, counters: { ... } }`; `403 FORBIDDEN` without the metrics token when configured.

## Error shape and codes

Every error is `{ "error": { "code": "...", "message": "...", "details": [...] } }`.

| Code | Status | Meaning |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | Invalid or missing input; `details` lists field problems |
| `UNAUTHORIZED` | 401 | Missing, invalid, expired token or invalid service token |
| `FORBIDDEN` | 403 | Wrong auth type or missing metrics token |
| `BOT_CHECK_FAILED` | 403 | Turnstile token missing or rejected |
| `ROUTE_NOT_FOUND` | 404 | No route matches the method/path |
| `DONOR_NOT_FOUND` / `IDENTITY_NOT_FOUND` | 404 | Referenced donor does not exist |
| `EMAIL_IN_USE` | 409 | Duplicate registration |
| `NOT_ELIGIBLE` | 409 | 56-day interval has not passed |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 16 kb |
| `RATE_LIMITED` | 429 | Too many register/login attempts |
| `REQUEST_ERROR` / `INTERNAL_ERROR` | 400 / 500 | Unexpected client/server error |
| `DATABASE_UNAVAILABLE` | 503 | Readiness check could not reach Neon |
