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

Self-registered Student and Admin accounts must verify their email before receiving tokens or logging in. For Gmail SMTP, set `EMAIL_USER` to the sending Gmail address and `EMAIL_APP_PASSWORD` to that account's Google App Password in `.env`. Do not use the Gmail account's normal password or commit `.env`. OTPs expire after 90 seconds.

## Stack

Express · MongoDB/Mongoose · JWT + bcrypt · Joi validation · Helmet/CORS/rate-limiting · node-cron (scheduled jobs) · Firebase Cloud Messaging (push) · external payment gateway + AI chatbot + blockchain ledger integrations.

## Status

The application routes, services and provider configuration are described in `AGENTS.md`. Notifications, the Groq chatbot, blockchain audit verification and optional cleaning photo assessment are implemented; external features require their corresponding environment configuration.

## Payments

Uses **Stripe Checkout Sessions**. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env` (see `.env.example`). For local testing, use the Stripe CLI — see the "Testing Stripe locally" section in `AGENTS.md`.

## Production deployment files

Deploy `server.js`, `src/`, `package.json`, `package-lock.json` and `scripts/start-local-mongo.cjs`. The small startup helper is referenced by `npm start`; without machine-local settings it leaves MongoDB management to `MONGO_URI`.

Install production dependencies with `npm ci --omit=dev`, configure the environment on the hosting service, and start with `npm start`. Use a transaction-capable MongoDB replica set or Atlas database.

Permanent tests stay in the repository for development. The `files` allowlist excludes tests, reports, local settings and development tools from npm package archives. `.dockerignore` applies the same runtime-only policy to Docker build contexts. Neither setting filters a host that clones the entire Git repository; configure that host's project root as this backend folder.

Do not upload `.env`, `.local-mongo.json`, `node_modules`, test output or Git history as deployment files. Install dependencies on the target and supply secrets through its environment settings.
