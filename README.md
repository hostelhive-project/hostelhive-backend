# HostelHive Backend

Node.js / Express / MongoDB REST API for HostelHive (BSSE FYP, University of Central Punjab, Group S26SE020).

- **Start here if you're an AI coding agent or a new contributor:** [`AGENTS.md`](./AGENTS.md)
- **Full design rationale, conflict resolutions, and data model:** [`docs/BACKEND_UNDERSTANDING.md`](./docs/BACKEND_UNDERSTANDING.md)

## Quick start

```bash
cp .env.example .env      # fill in MONGO_URI, JWT secrets, etc.
npm install
npm run dev                # starts on http://localhost:5000
curl http://localhost:5000/health
```

### Email verification

Self-registered Student and Admin accounts must verify their email before receiving tokens or logging in. OTPs expire after 90 seconds. Signup, password reset and staff invitation emails share the same delivery integration.

Email uses Brevo's HTTPS API in local development and deployment. Set `BREVO_API_KEY` and `EMAIL_FROM` to a Brevo-verified sender. The request timeout defaults to 15 seconds, configurable with `EMAIL_API_TIMEOUT_MS`. See [`docs/RENDER_DEPLOYMENT.md`](./docs/RENDER_DEPLOYMENT.md).

Keep credentials server-side and never commit `.env`. Delivery failures return the existing safe HTTP 503 response without logging keys, OTPs, recipients or provider response bodies. Ambiguous requests are not automatically resent.

## Stack

Express · MongoDB/Mongoose · JWT + bcrypt · Joi validation · Helmet/CORS/rate-limiting · node-cron (scheduled jobs) · Firebase Cloud Messaging (push) · external payment gateway + AI chatbot + blockchain ledger integrations.

## Status

The application routes, services and provider configuration are described in `AGENTS.md`. Notifications, the Groq chatbot, blockchain audit verification and optional cleaning photo assessment are implemented; external features require their corresponding environment configuration.

## Payments

Uses **Stripe Checkout Sessions**. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env` (see `.env.example`). For local testing, use the Stripe CLI — see the "Testing Stripe locally" section in `AGENTS.md`.

## Production deployment files

Deploy `server.js`, `src/`, `package.json`, `package-lock.json` and `scripts/start-local-mongo.cjs`. The small startup helper is referenced by `npm start`; without machine-local settings it leaves MongoDB management to `MONGO_URI`.

Install production dependencies with `npm ci --omit=dev`, configure the environment on the hosting service, and start with `npm start`. Use a transaction-capable MongoDB replica set or Atlas database.

For Render + Brevo, follow [`docs/RENDER_DEPLOYMENT.md`](./docs/RENDER_DEPLOYMENT.md). The alternative alwaysdata guide is [`docs/ALWAYSDATA_DEPLOYMENT.md`](./docs/ALWAYSDATA_DEPLOYMENT.md). Run `npm run config:check` before starting with production settings. Startup checks transaction support and creates declared model indexes before opening the assigned `IP`/`PORT`; index conflicts prevent startup. `/health` is liveness and `/ready` includes database readiness. Production rate limits persist in MongoDB. Email startup validation requires the Brevo API key, sender and valid request timeout.

Permanent tests stay in the repository for development. The `files` allowlist excludes tests, reports, local settings and development tools from npm package archives. `.dockerignore` applies the same runtime-only policy to Docker build contexts. Neither setting filters a host that clones the entire Git repository; configure that host's project root as this backend folder.

Do not upload `.env`, `.local-mongo.json`, `node_modules`, test output or Git history as deployment files. Install dependencies on the target and supply secrets through its environment settings.
