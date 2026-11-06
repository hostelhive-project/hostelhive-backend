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

Self-registered Student and Admin accounts must verify their email before receiving tokens or logging in. For Gmail SMTP, set `EMAIL_USER` to the sending Gmail address and `EMAIL_APP_PASSWORD` to that account's Google App Password in `.env`. Do not use the Gmail account's normal password or commit `.env`. OTPs expire after 10 minutes.

## Stack

Express · MongoDB/Mongoose · JWT + bcrypt · Joi validation · Helmet/CORS/rate-limiting · node-cron (scheduled jobs) · Firebase Cloud Messaging (push) · external payment gateway + AI chatbot + blockchain ledger integrations.

## Status

Auth, Users, Hostels, Rooms, Bookings, Invoices, Payments (Stripe), Complaints, Cleaning Tasks, Reviews, and Admin Dashboard are fully implemented. Notifications, AI Chatbot, and Blockchain verification (read endpoint) are stubbed (return `501`) pending implementation — see the build-order table in `AGENTS.md`.

## Payments

Uses **Stripe Checkout Sessions**. Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.env` (see `.env.example`). For local testing, use the Stripe CLI — see the "Testing Stripe locally" section in `AGENTS.md`.
