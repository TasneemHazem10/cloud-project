# Test Plan and Evidence Table

Automated: `cd backend && npm test` → 34 tests, all passing locally. The table below is for the manual evidence required by the coursework report. Fill **Actual result** with the response you received and **Evidence** with a screenshot ID or file name.

## Environment for manual tests

- API: `http://localhost:3000/api/auth` (later the deployed domain)
- Frontend: `http://localhost:8080`
- Database: Neon SQL Editor → Tables
- Tool: Postman, `curl.exe`, or browser DevTools
- Local Turnstile site key: `1x00000000000000000000AA`; dummy token: `XXXX.DUMMY.TOKEN.XXXX`

## Test cases

| ID | Scenario | Request / action | Expected result | Actual result | Pass/Fail | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | API alive | GET `/health` | 200, `status:"ok"`, request ID header | | | |
| A02 | Database reachable | GET `/ready` | 200, `database:"ok"` | | | |
| A03 | Register valid donor | POST `/register` + dummy token | 201, session token + user + donor, no password hash | | | |
| A04 | Row created in Neon | Open `users` and `donors` tables | One new row in each, linked by `user_id` | | | |
| A05 | Password hashed | Inspect `users.password_hash` | `scrypt$<cost>$<salt>$<hash>`, not the password | | | |
| A06 | Stored session | Inspect `sessions` and call `/me` | Row has token hash, user id and expiry; raw token is never stored | | | |
| A07 | Register missing bot token | POST `/register` without header | 403 `BOT_CHECK_FAILED` | | | |
| A08 | Register rejected bot token | POST `/register` with `INVALID` token | 403 `BOT_CHECK_FAILED` | | | |
| A09 | Register invalid input | email `bad`, password `short`, name `A` | 400 `VALIDATION_ERROR` with details | | | |
| A10 | Duplicate email | POST `/register` same email twice | 409 `EMAIL_IN_USE` | | | |
| A11 | Login valid | POST `/login` + dummy token | 200, new session token | | | |
| A12 | Login wrong password | POST `/login` wrong password | 401 `INVALID_CREDENTIALS` | | | |
| A13 | Login unknown email | POST `/login` unknown email | 401 same message as A12 | | | |
| A14 | Login missing bot token | POST `/login` without header | 403 `BOT_CHECK_FAILED` | | | |
| A15 | Profile read | GET `/me` with session token | 200, own user + donor | | | |
| A16 | No token | GET `/me` without header | 401 `UNAUTHORIZED` | | | |
| A17 | Tampered token | GET `/me` with modified session token | 401 `UNAUTHORIZED` | | | |
| A18 | Profile update | PUT `/profile` `{city,phone}` | 200, changed values returned | | | |
| A19 | Profile persists | GET `/me` after update | 200 with saved values | | | |
| A20 | Invalid profile | PUT `/profile` `bloodType:"Z-"` | 400 `VALIDATION_ERROR` | | | |
| A21 | Eligibility, no history | GET `/eligibility` | 200, `eligible:true`, reason `NO_PREVIOUS_DONATION` | | | |
| A22 | Record old donation | POST `/donations` `donatedAt` 100 days ago | 201 with id, location, amount | | | |
| A23 | History read | GET `/donations` | 200, count 1, newest first | | | |
| A24 | Record current donation | POST `/donations` without `donatedAt` | 201 | | | |
| A25 | Eligibility blocked | GET `/eligibility` after A24 | `eligible:false`, ~56 days, next date = last + 56d | | | |
| A26 | Second donation blocked | POST `/donations` again | 409 `NOT_ELIGIBLE` with next date/days | | | |
| A27 | Future date rejected | POST `/donations` `donatedAt` in 2999 | 400 `VALIDATION_ERROR` | | | |
| A28 | Invalid amount | POST `/donations` `amountMl:900` | 400 `VALIDATION_ERROR` | | | |
| A29 | Booking lookup | GET `/donors/{id}/eligibility` + service token | 200 with same result as A25 | | | |
| A30 | Booking without token | Same request without service token | 401 `UNAUTHORIZED` | | | |
| A31 | Check-in recording | POST `/donations` + service token + `donorId`, old date | 201 | | | |
| A32 | Check-in invalid donorId | Same with `donorId:"not-a-uuid"` | 400 `VALIDATION_ERROR` | | | |
| A33 | Metrics protected | GET `/metrics` without metrics token | 403 `FORBIDDEN` (when configured) | | | |
| A34 | Metrics snapshot | GET `/metrics` with metrics token | 200, counters include register/login/donation | | | |
| A35 | Unknown route | GET `/api/auth/nope` | 404 `ROUTE_NOT_FOUND` | | | |
| A36 | Oversized body | POST `/register` with >16 kb body | 413 `PAYLOAD_TOO_LARGE` | | | |
| B01 | Browser register | Complete Turnstile + register form | Dashboard appears, banner green | | | |
| B02 | Browser login | Log out, log in again | Dashboard reloads with correct email | | | |
| B03 | Banner waiting | Insert today's donation in Neon, refresh | Amber banner, days remaining ≈56, date shown | | | |
| B04 | Profile screen | Change city in the UI and reload | Value persists from Neon | | | |
| B05 | History screen | Check table after A24 | Rows sorted newest first, formatted dates | | | |
| B06 | DevTools Network | Inspect POST/GET calls | Correct methods, URLs, 200/201, session token header, no password | | | |
| B07 | Logout | Click Log out | Auth screen returns; protected calls fail | | | |
| C01 | Cloud health | GET `<api>/api/auth/health` | 200, `environment:"production"` | | | |
| C02 | Cloud readiness | GET `<api>/api/auth/ready` | 200 with Neon configured | | | |
| C03 | Cloud end-to-end | Register/login from deployed frontend | Works with real Turnstile keys | | | |
| C04 | Security headers | `curl.exe -I <web-domain>` | CSP, X-Frame-Options, nosniff etc. present | | | |
| C05 | Vercel logs | Open API project → Logs | JSON events for register/login/eligibility/donation | | | |
| C06 | CORS | Deployed frontend loads data | No CORS error; API domain listed in `CORS_ORIGINS` | | | |

## End-to-end workflow for the demo video

1. Deployed frontend → Register a new donor (Turnstile widget visible) → dashboard.
2. Eligibility banner shows "eligible".
3. Edit profile and save; show the value in Neon.
4. Booking service calls `GET /donors/{id}/eligibility` with service token (Postman).
5. Check-in calls `POST /donations` with service token (Postman).
6. Refresh the frontend: history has the new row, banner shows waiting period and next eligible date.
7. Try a second check-in: 409 `NOT_ELIGIBLE`.
8. Show Vercel Logs and `/metrics` to prove logging and monitoring.
