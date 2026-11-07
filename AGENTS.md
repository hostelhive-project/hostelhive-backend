# AGENTS.md — HostelHive Backend

This file orients any agent (or developer) working in this repo. Read it before writing code. It tells you what exists, what's intentionally stubbed, and — critically — where this codebase deliberately *deviates* from the project's own SRS/SDS documents, so you don't "fix" something back into a documented bug.

## What this project is

HostelHive is a hostel management platform (FYP, University of Central Punjab, Group S26SE020). This repo is the **backend only**: a Node.js/Express REST API over MongoDB, serving a React web dashboard (admins) and a React Native app (students/residents/cleaning staff). Source docs live outside this repo (SRS Phase I, SDS Phase II) — a full synthesis of them is in `docs/BACKEND_UNDERSTANDING.md` if present in your workspace; treat that document, not the raw SRS/SDS, as the source of truth for *intent*, because it already reconciles the conflicts described below.

## Ground rules for this repo

1. **Layered architecture, strictly.** `routes → controllers → services → repositories → models`. Controllers are thin (parse req, call service, format res via `utils/response.js`). Business logic lives in `services/`. Mongoose queries live in `repositories/`, never directly in a controller or service.
2. **Every async controller/middleware is wrapped in `catchAsync`.** Never write a bare `try/catch` in a controller — throw an `AppError` and let `middleware/errorHandler.js` handle it.
3. **Every mutating route needs a Joi validator** in `validators/`, applied via `middleware/validate.js`.
4. **Every route needs explicit RBAC.** Use `authenticate` (JWT) + `requireRole(...)` (role check) + `scopeToOwnHostel(loader)` (multi-tenant check) as needed. Don't assume a role check elsewhere in the stack — each router declares its own.
5. **New collection → new file in `models/`, matching the naming/index style already there.** Add a one-line comment if the field/entity is an *addition* over the original ERD (see below) so future readers know it's intentional, not drift.
6. **Don't add a 4th `role` value.** See Deviation #2 below — this is deliberate, not an oversight.

## Deliberate deviations from the original SRS/SDS diagrams

The original design documents (SRS Phase I, SDS Phase II) contain some internal contradictions and gaps. This codebase resolves them as follows. If you're tempted to "correct" the code to match a diagram literally, read this first:

1. **Booking → Payment flow.** The SDS's "Room Booking & Blockchain Payment" sequence diagram shows a student's booking going straight to payment in one call. The class diagram's `Booking.status` enum (`Pending → Approved → CheckedIn → Cancelled`) and a separate "Hostel Admin Operations" sequence diagram both require an admin-approval step in between. **We implement the approval pipeline** (`Pending` → admin `PATCH /api/bookings/:id/approve` → pay outstanding invoice → `PATCH /api/bookings/:id/checkin`). Do not collapse booking and payment into one endpoint.

2. **`role` enum has 3 values, not 4.** The original ERD included `Resident` as a role chosen at registration. There is no "Resident registration screen" anywhere in the UI — residency is a *status* a Student reaches once their booking is `CheckedIn`. `models/User.js` only has `Student | Admin | CleaningStaff`. To check if a user is "currently a resident," query for an active `CheckedIn` booking, don't add a role value.

3. **Invoice sits between Booking and Payment, and Payments use Stripe Connect, not a single HostelHive-owned account.** The original ERD said a Booking "bills Exactly 1" Payment — that can't represent monthly recurring rent. The chain is `Booking (1) → Invoice (1..*, one per billing month) → Payment (0..*)`. On top of that, per project decision: **there is no separate "Owner" entity.** The existing `Admin` role connects the hostel's own Stripe Express account (`Hostel.stripeAccountId`) on the real-world owner's behalf, and every resident payment is a **destination charge** that goes straight to that hostel's Stripe balance — HostelHive's own Stripe account never holds the money, and takes no platform fee. `Payment`/`Invoice` are only marked `Paid` inside the **webhook handler**, never from the client-facing checkout call — never trust a client-side "success" redirect for money.

4. **Hostel-scoped RBAC exists and must be used.** `middleware/hostelScope.middleware.js` is not in the original SDS. It exists because the SDS's RBAC was purely role-based (any Admin could edit any hostel), which breaks the "support multiple hostels" NFR. Every Admin-only mutation on a hostel-owned resource (hostels, rooms, bookings, complaints, cleaning tasks) must pass through `scopeToOwnHostel(loader)`. Note that Bookings/Complaints/Cleaning Tasks don't have a direct `hostelId` field — their loaders resolve it by walking `Booking → Room → hostelId` (see each service's `loaderById`).

5. **Blockchain writes go to a real testnet (Polygon Amoy) when a wallet is configured, and fall back to a simulated hash-only write when it isn't.** `integrations/blockchain.js` checks `BLOCKCHAIN_RPC_URL`/`BLOCKCHAIN_PRIVATE_KEY` at call time (same lazy pattern as Stripe/Groq/Firebase): if set, it sends the SHA-256 hash of the source document as a zero-value self-transaction via `ethers.js`, waits for confirmation, and stores the real transaction hash plus a clickable PolygonScan `explorerUrl`; if unset, it stores a `sim-block-...` placeholder and `network: 'simulated'`, `explorerUrl: null` — same shape either way, so callers (`payment.service.js`, `complaint.service.js`, `blockchain.controller.js`) never need to change. In the **Payment webhook path specifically**, the chain write is fire-and-forget (not awaited) — Stripe expects a fast webhook response and a testnet confirmation can take a few seconds, so `payment.blockchainRef` is filled in asynchronously after the webhook has already responded. In the **Complaint path**, it IS awaited, since that's a normal admin HTTP request with no external timeout pressure, and awaiting lets the API response include the real `explorerUrl` immediately.

6. **Five collections exist that aren't in the original ERD**: `Invoice`, `Notification`, `ChatMessage`, `Review`, `BlockchainRecord`. Each has a comment at the top of its model file explaining what requirement it fulfills that the original diagrams missed. Don't delete them for not matching the ERD — the ERD is the thing that's incomplete.

## Payments — Stripe Connect (how it actually works)

Per project decision, there is **no separate "Owner" entity** — the existing `Admin` role manages the hostel's Stripe account entirely on the real-world owner's behalf. HostelHive is a **record-keeper only**: money never touches a HostelHive-owned Stripe balance, and no platform fee is taken (`application_fee_amount` is deliberately omitted in `integrations/stripe.js`).

**Onboarding (Admin, one-time per hostel):**
1. `GET /api/hostels/:hostelId/stripe/onboard` (Admin, own hostel only) — creates a Stripe Express connected account for the hostel if one doesn't exist yet (`Hostel.stripeAccountId`), and returns a fresh Stripe-hosted onboarding link. Safe to call repeatedly — the account is only created once, but the link is regenerated each time (Stripe links expire quickly).
2. Admin completes the form on Stripe's hosted page (bank details, business info — this is Stripe's UI, not ours).
3. `GET /api/hostels/:hostelId/stripe/status` — checks `details_submitted` and `charges_enabled` directly against Stripe's API and syncs `Hostel.stripeOnboardingComplete`. Call this after the Admin is redirected back, or on-demand from a "refresh status" button.

**Paying an invoice (Student/Resident):**
1. `POST /api/payments/checkout` with `{ invoiceId }` — blocked with a 409 (`"This hostel has not finished setting up payments yet."`) if the hostel hasn't connected/finished Stripe onboarding. Otherwise creates a `Payment` (`Processing`) and a Stripe Checkout Session as a **destination charge**, routing funds to `Hostel.stripeAccountId`. Returns `checkoutUrl` for the frontend to redirect to.
2. Resident pays on Stripe's hosted checkout page.
3. `POST /api/payments/webhook` (raw body, signature-verified) — the only place a `Payment`/`Invoice` is ever marked `Paid`. Handles `checkout.session.completed` (settle), `checkout.session.expired`/`payment_intent.payment_failed` (mark `Failed`), and `account.updated` (onboarding progress — currently just logged; status is synced on-demand instead, see above).
4. On settlement, a `BlockchainRecord` is written (still simulated — see Deviation #5) and its `blockRef` attached to the `Payment`.

**Known constraint:** Stripe Connect does not support payouts to Pakistani bank accounts. Test mode works regardless of country, so this doesn't block development or demoing — but flag it if this project is ever deployed for real money in Pakistan; a local rail (JazzCash/EasyPaisa) or a Stripe-supported intermediary entity would be needed instead.

**Testing locally:** the webhook can't reach `localhost` from Stripe's servers directly. Use the Stripe CLI:
```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```
This prints a `whsec_...` — put it in `.env` as `STRIPE_WEBHOOK_SECRET` (different from your dashboard's webhook secret when using the CLI). Onboard a test hostel with `GET /api/hostels/:hostelId/stripe/onboard`, complete Stripe's test-mode onboarding form (use their test data — no real bank account needed), then trigger a real checkout via `POST /api/payments/checkout`, pay with test card `4242 4242 4242 4242` (any future expiry, any CVC), and watch the CLI forward `checkout.session.completed` to your running server.

`PATCH /api/invoices/:id/mark-paid` (Admin-only) still exists as a manual/offline stand-in for cash or bank-transfer rent payments collected outside the app — keep it even with Stripe wired up; hostels will always have some offline payments.

## Current state (check before assuming something isn't built)

| Module | Status | Files |
|---|---|---|
| Project setup / config / DB connection | ✅ Done | `src/config/`, `server.js` |
| Auth (email OTP verification, login/refresh/logout/me, password reset) | ✅ Done | `routes/auth.routes.js` + chain |
| Users (profile get/update) | ✅ Done | `routes/user.routes.js` + chain |
| Hostels (CRUD, search) | ✅ Done | `routes/hostel.routes.js` + chain |
| Rooms (CRUD, status/lock) | ✅ Done | `routes/room.routes.js` + chain |
| Room discovery (layout summaries, paginated search, rent sorting) | Implemented | Public `GET /api/hostels/:id/room-catalog` and `GET /api/hostels/:id/room-options`; existing `/rooms` stays an array. Available means unlocked with free capacity. |
| Bookings (Pending→Approved→CheckedIn, atomic room-lock, + GET /hostel/:hostelId) | ✅ Done | `routes/booking.routes.js` + chain |
| Invoices (monthly billing per booking + cron job + manual mark-paid + GET /hostel/:hostelId) | ✅ Done | `routes/invoice.routes.js`, `jobs/generateMonthlyInvoices.js` |
| Payments (Stripe Connect — destination charges to the hostel's own account, no platform fee) | ✅ Done | `routes/payment.routes.js`, `integrations/stripe.js`, Stripe onboarding routes in `routes/hostel.routes.js` |
| Complaints (lifecycle + Critical-severity blockchain log) | ✅ Done | `routes/complaint.routes.js` + chain |
| Cleaning Tasks (assign/start/complete, afterImageUri enforced + GET /hostel/:hostelId) | ✅ Done | `routes/cleaningTask.routes.js` + chain |
| Cleaning photo assessment (optional Groq vision, advisory score out of 10) | Implemented | `services/cleaningAssessment.service.js`, durable outbox + persistent quota; setup and limits in `docs/CLEANING_AI.md`. Never changes staff task status or makes an approval decision. |
| Reviews (nested under hostels, requires a completed stay) | ✅ Done | mounted inside `routes/hostel.routes.js` |
| Admin Dashboard (rent/occupancy/complaints aggregation) | ✅ Done | `routes/admin.routes.js` + chain |
| Notifications (in-app inbox + best-effort FCM push) | ✅ Done | `routes/notification.routes.js` + chain, `integrations/firebase.js` |
| AI Chatbot (Groq, grounded in Admin's per-hostel info form) | ✅ Done | `routes/chatbot.routes.js` + chain, `integrations/groq.js`, `Hostel.chatbotInfo` |
| Blockchain (real Polygon Amoy writes with simulated fallback, + verify endpoint) | ✅ Done | `integrations/blockchain.js`, `routes/blockchain.routes.js` + chain |

All 14 planned backend modules are implemented. The unused placeholder router was removed during cleanup. This folder contains the backend; the admin web portal and mobile app are sibling projects.

## Build order

1. ~~Project setup~~ ✅
2. ~~Auth & RBAC~~ ✅
3. ~~Users~~ ✅
4. ~~Hostels~~ ✅ ~~(Reviews)~~ ✅
5. ~~Rooms~~ ✅
6. ~~Bookings~~ ✅
7. ~~Invoices + Payments~~ ✅ (Stripe Connect)
8. ~~Complaints~~ ✅
9. ~~Cleaning Tasks~~ ✅
10. ~~Notifications~~ ✅ — `notificationService.notify(...)` is wired into `booking.service.js` (approve/reject), `complaint.service.js` (updateStatus + assign), `cleaningTask.service.js` (assign), `invoice.service.js` (generateForBooking), and `payment.service.js` (settleFromWebhookSession). Push via `integrations/firebase.js` is best-effort and lazy — the app runs fine with zero Firebase config; the in-app inbox (`GET /api/notifications`) always works regardless. `User.deviceToken` is the FCM registration token, set via `PUT /api/users/:id`.
11. ~~Admin dashboard~~ ✅ — aggregation endpoints only. "Staff clocked-in" is currently proxied by "staff with a task InProgress" (see `adminDashboard.service.js` comment). Attendance and shift management are outside the current scope of HostelHive.
12. ~~AI Chatbot~~ ✅ — uses Groq (free tier, OpenAI-compatible API — see `integrations/groq.js`), grounded in the Admin's per-hostel `chatbotInfo` form (`PUT /api/hostels/:hostelId/chatbot-info`), not a generic assistant. `chatbot.service.js` resolves the resident's hostel from their active booking, builds a system prompt from only that hostel's facts (explicitly told not to guess beyond them), and replays recent `ChatMessage` history per `sessionId` for real conversational context — not a one-shot Q&A. If a resident has no active booking, it falls back to a generic "no specific hostel" prompt rather than erroring.

    **Cost note:** Groq's free tier is used deliberately (per project constraint — no paid APIs for this FYP). It has per-minute rate limits; if the chatbot starts returning 502s under rapid testing, that's Groq's rate limit, not a bug — wait a few seconds and retry, or check https://console.groq.com for current free-tier limits.
13. ~~Blockchain verify~~ ✅ — `writeRecord()` now does a real Polygon Amoy testnet write (via `ethers.js`) when `BLOCKCHAIN_RPC_URL`/`BLOCKCHAIN_PRIVATE_KEY` are set in `.env`, and falls back to the old simulated hash-only write otherwise — the app runs fine with zero blockchain setup. `GET /api/blockchain/:sourceType/:sourceId/verify` returns the hash, block reference, network, and (if real) a clickable PolygonScan `explorerUrl`. Setup is genuinely free: a MetaMask wallet, free test MATIC from https://faucet.polygon.technology/, and a free RPC URL from Alchemy or Infura — see the comments in `.env.example`. Never put a real funded wallet's private key here — use a throwaway test wallet.

## Commands

```bash
cp .env.example .env        # then fill in real secrets
npm install
npm run dev                 # nodemon, requires local/remote MongoDB reachable via MONGO_URI
npm test                    # jest + supertest
```

## Conventions checklist for every new route you add

- [ ] Model already exists or is added with a comment if new
- [ ] Repository function added (no raw Mongoose calls outside `repositories/`)
- [ ] Service function has the business logic + throws `AppError` for domain errors
- [ ] Controller is thin, wrapped in `catchAsync`, uses `utils/response.js`
- [ ] Joi validator added, wired via `middleware/validate.js`
- [ ] Route has `authenticate` + `requireRole(...)` + `scopeToOwnHostel(...)` where applicable
- [ ] Router mounted in `src/app.js` without placeholder handlers
- [ ] This table in AGENTS.md updated


## UI and navigation hardening (6 November 2026)

- Hostel setup supports explicit `publicationStatus: Draft`. Drafts are excluded from public discovery, details, rooms, reviews, seeker chatbot context and booking requests. Existing records without this field remain public. Legacy creation defaults remain Published.
- The owning Admin can reload/manage a draft and publish through `POST /api/hostels/:id/publish` with authentication, Admin RBAC, hostel scope and Joi validation. The web setup creates a draft and publishes from its final review step.
- Stripe checkout return URLs preserve existing query parameters and include invoice/booking IDs. The redirect remains informational; webhook settlement remains authoritative.
- FCM messages include string-valued notification/user/type/entity routing fields. Mobile notification handling waits for session and navigator readiness.
- Regression coverage: `tests/uiNavigationRegression.test.js`, `tests/roomCatalog.test.js` and deterministic cases in `tests/stripeCurrency.test.js`. Use a dedicated test database; do not run the live Stripe integration case without an available test-mode connection.

## Production hosting preparation (7 November 2026)

- See `docs/ALWAYSDATA_DEPLOYMENT.md`; `npm run config:check` performs offline production configuration validation without provider calls or secret output.
- `server.js` binds host-assigned IP/HOST/PORT, starts workers after successful binding and drains HTTP/jobs with a deadline before disconnecting MongoDB. Production startup verifies transaction-capable topology and creates declared indexes, never syncs/drops them.
- IP quotas persist through `RateLimitBucket` in production; isolated tests/development use memory. Tighter per-account buckets remain. Explicit trusted-proxy configuration protects forwarded headers; alwaysdata's X-Real-IP requires opt-in and a trusted socket peer. `/health`, `/ready`, OPTIONS and the signed raw-body Stripe webhook are exempt from the general limiter.
- Production CORS uses exact HTTPS browser origins; native originless requests remain supported. The frontend/backend contracts and OTP expiry remain unchanged. Email uses Brevo's HTTPS API with a bounded timeout. Pool/upload defaults suit initial small-host evaluation, not a guaranteed load rating.

## Render + Brevo email delivery (7 November 2026)

- Brevo is the only email provider in local development and deployment, using its fixed HTTPS transactional email endpoint through Node's built-in fetch. Configure server-only `BREVO_API_KEY` and a verified `EMAIL_FROM` sender. The request deadline defaults to 15 seconds (`EMAIL_API_TIMEOUT_MS`, allowed 1-30 seconds).
- `sendOtpEmail(email, otp, purpose)`, the three OTP purposes and 90-second expiry are preserved; auth, routes and client payloads are unchanged. The email configuration contains only the API key, sender and API timeout.
- Brevo requires HTTP 201 with a message ID for acceptance. Safe logs record a failure category/status only; provider acceptance does not prove delivery. No automatic retry, key/OTP/provider-body logging or live provider call is made during configuration validation.
- Follow `docs/RENDER_DEPLOYMENT.md`. Render Free sleeps while idle, pausing in-process billing/outbox workers until the backend runs again; this integration does not provide always-on background execution.

## Backend CI and Render deployment (7 November 2026)

- `.github/workflows/backend-ci.yml` runs on pushes/PRs to `main` and manual dispatch: Node 22.22.0, locked install, source lint, tracked JavaScript syntax and the existing Jest suite. A temporary MongoDB 8.0 replica set supports transaction tests; never supply an Atlas URI or real provider credentials to this job. Existing fixtures isolate database names and disable live providers; live Stripe tests stay opt-in outside CI.
- Continuous deployment uses Render's connected GitHub integration with **Auto-Deploy > After CI Checks Pass**, linked to `main`. No deploy-hook/API token is used. Dashboard setup and first deployment are separate from committing the workflow; follow `docs/RENDER_DEPLOYMENT.md`. GitHub checks indicate CI status; Render reports the actual deployment result.
