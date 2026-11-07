# alwaysdata backend deployment

Prepared 7 November 2026. This guide matches the current Node/Express backend. No hosting account, external API, application data or secret is changed by these preparation steps.

## 1. What is implemented

- The HTTP listener respects the host-assigned `IP`, then `HOST`, and `PORT`.
- Production startup validates settings before connecting to MongoDB. Errors identify setting names without printing values.
- Startup checks MongoDB transaction support and creates all declared model indexes before accepting traffic. It does not drop indexes or rewrite documents. Conflicting existing indexes/duplicates must be resolved deliberately.
- `/health` is liveness; `/ready` returns 200 only after database initialization and while the MongoDB connection is available. These endpoints do not prove email, Stripe, Groq, Firebase or blockchain delivery.
- The general IP quota defaults to 300 requests/15 minutes. Sensitive auth actions share 60 requests/15 minutes per IP; existing tighter per-account and OTP controls remain. Refresh uses the general allowance. Production IP quotas persist in MongoDB and survive process restarts. IPv6 addresses share a /64 quota; IPv4-mapped addresses use the same bucket as IPv4.
- Native clients without a browser Origin are accepted. Browser requests use the exact `CLIENT_WEB_ORIGIN` allowlist. Development LAN allowances are not enabled in production. Preflights, health/readiness and the signature-verified Stripe webhook bypass general quotas.
- alwaysdata's `X-Real-IP` is used for IP quotas only when explicitly selected and the socket peer is trusted. Arbitrary client-supplied headers are not trusted by default.
- Email uses Brevo's HTTPS API with a bounded 15-second request timeout. Existing 90-second OTPs and registration/activation/reset payloads remain unchanged.
- Database pools default to max 10/min 0. Production buffers one upload request at a time, globally and per user; existing image limits and payloads remain unchanged.
- Workers start only after HTTP binding succeeds. Shutdown stops new work, drains active HTTP/jobs within a deadline, and disconnects MongoDB. Durable leases recover work after a forced stop. Request logging excludes query strings, headers and bodies.

## 2. Required hosting inputs

Your public backend and admin URLs are not assigned yet. Enter actual values after your hosts assign them; do not deploy placeholder values.

| Setting | What to enter |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODEJS_VERSION` | `22` in alwaysdata's environment settings |
| `IP` / `HOST`, `PORT` | Leave the values assigned by the Node.js site intact |
| `MONGO_URI` | Atlas connection URI with explicit `/hostelhive` database name and its connection options |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Different random secrets, at least 32 bytes each; do not use example values |
| `CLIENT_WEB_ORIGIN` | Actual public admin HTTPS origin, without trailing slash/path; comma-separate additional intended browser origins |
| `CLIENT_IP_HEADER` | `x-real-ip` for alwaysdata |
| `TRUST_PROXY` | Actual trusted upstream proxy IP/CIDRs, or a verified proxy-hop count; see below |
| `BREVO_API_KEY` | Brevo transactional email API key |
| `EMAIL_FROM` | Sender mailbox verified in Brevo |
| `EMAIL_API_TIMEOUT_MS` | `15000` by default; allowed 1000-30000 |
| `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | Your ImageKit account configuration |
| `BILLING_TIMEZONE` | `Asia/Karachi` unless your intended billing timezone differs |
| `ALLOW_SIMULATED_UPLOADS` | `false` |

Other provider keys stay server-side. Keep them in alwaysdata's site environment settings or a private backend `.env` with restrictive permissions. Do not put keys into web/mobile public variables, Git, command-line arguments, screenshots or documentation.

### Trusted proxy setup

alwaysdata documents `X-Real-IP` and `X-Forwarded-Proto`; do not assume it supplies `X-Forwarded-For`.

1. Select `CLIENT_IP_HEADER=x-real-ip`.
2. Obtain the connecting upstream proxy addresses/hop arrangement for your site from the host's configuration/support.
3. Set `TRUST_PROXY` to only those actual trusted IP/CIDRs. `loopback` is appropriate only if the upstream socket is confirmed to be loopback. A hop count such as `1` is appropriate only if that route is verified and the backend cannot be reached through a shorter, untrusted route.
4. Do not set blanket `TRUST_PROXY=true` or a `/0` range. Invalid settings prevent startup. Selecting `x-real-ip` without any trusted proxy also prevents production startup.
5. Verify from two client networks that quotas are independent; forged IP headers should not change the address recorded by the host proxy. Wrong configuration can otherwise make clients share a quota or allow spoofing.

### Optional provider setup

- **Stripe:** when enabled, configure matching secret/webhook keys and real HTTPS Admin return/refresh URLs ending `/admin/stripe/complete` and `/admin/stripe/refresh`. The webhook is `https://YOUR_BACKEND/api/payments/webhook`; use its hosted endpoint signing secret. Snapshot API events must match the current integration. The existing installed mobile routes are `hostelhive://payments/success` and `/cancel`; configuration accepts those, but provider acceptance/device return still needs verification. Alternatively implement actual HTTPS mobile return pages. The admin portal has no student payment-success page. Never mark an invoice paid from a return URL.
- **Groq:** retain your working chatbot model, separate vision model and key. Cleaning assessments are optional. Keep the global daily budget at 20 or below.
- **Blockchain:** configure both HTTPS RPC and a valid dedicated test-wallet private key (`0x` plus 64 hex digits), along with the network/explorer base. A missing provider is not checked by `/health`; production does not create simulated anchors. Testnet gas and RPC availability remain external requirements.
- **Firebase:** all three `FIREBASE_*` values must form a valid service-account configuration if push is enabled. The Android `google-services.json` must use the same Firebase project. Literal escaped `\n` in a private key is supported. No key is sent to the mobile application.

To intentionally leave an optional integration unconfigured, clear its entire credential group rather than leaving partial/dummy credentials. Core email and upload storage remain required for production workflows.

## 3. Install and start

1. Push the intended backend commit to GitHub, or upload its runtime files. Keep maintained tests/docs in development; they are excluded from npm/Docker runtime packaging. Native Git clones still contain tracked development files.
2. In alwaysdata choose Node.js 22 under Environment > Node.js, or set `NODEJS_VERSION=22`.
3. Upload/clone into `/home/ACCOUNT/hostelhive-backend` and install from that folder:

   ```sh
   npm ci --omit=dev
   npm run config:check
   ```

   The check forces production validation, does not make network calls and does not print secrets. If using dashboard-only variables, run it in an SSH environment with the same settings. A private backend `.env` is resolved relative to the backend folder regardless of working directory; environment variables take precedence.
4. In Atlas allow the alwaysdata server's actual outbound IP addresses. Database access needs transaction-capable replica-set/Atlas infrastructure. No local MongoDB install is required on alwaysdata.
5. Create a **Node.js** site in Web > Sites. Use this command, replacing the account/path:

   ```sh
   node /home/ACCOUNT/hostelhive-backend/server.js
   ```

   Keep the assigned `IP`/`PORT`. This starts the HTTP server and workers. Do not use nodemon, `npm run dev` or a command that imports only `src/app.js`.
6. Enable Force HTTPS in the website's SSL configuration. Keep the backend outside any static document directory; do not expose `.env` as a static file.
7. Configure `/ready` for the host readiness check where supported. Open `/health` and `/ready` at the public backend origin. Inspect startup logs for index or topology failures before allowing traffic.
8. Change the web `VITE_API_BASE_URL` and mobile EAS `EXPO_PUBLIC_API_URL` to `https://YOUR_BACKEND/api`, then rebuild the clients. This backend preparation does not alter either client.

No Dockerfile, paid service, hosting deployment, secret rotation or application database migration is created by this preparation.

## 4. Free-plan capacity and background work

alwaysdata Free is intended for noncommercial use and has 256 MB RAM, a quarter CPU and 1 GB storage. Runtime dependencies count toward disk usage; check actual installation size. Gallery uploads, SDKs and concurrent traffic still need on-host memory measurement; these defaults do not guarantee capacity.

The Node website can be stopped by the provider. Advanced > Idle time `0` disables deliberate idle shutdown, but is not a never-stop guarantee. Free plans do not offer always-on Services. Outbox/billing run again at startup; delayed notifications, chain transactions and cleaning assessments resume according to their retry/expiry policies. Expired cleaning jobs can become Unavailable rather than run indefinitely. Use an appropriate continuously running plan if uninterrupted workers become required.

## 5. Controls and checks

Additional knobs and defaults are listed in `.env.example`: `HTTP_*_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `API_RATE_LIMIT_*`, `AUTH_RATE_LIMIT_*`, `MONGO_*POOL_SIZE`, `MONGO_SERVER_SELECTION_TIMEOUT_MS`, `UPLOAD_MAX_CONCURRENT*`, and `EMAIL_*_TIMEOUT_MS`.

Development checks (install dev dependencies locally):

```sh
npm run lint
npx jest --runInBand tests/productionReadiness.test.js tests/productionLifecycle.test.js
```

These regression suites use mocks/in-process HTTP only; no email, Stripe, Groq, Firebase, blockchain or application database operations are performed. Other database-backed tests require their isolated test-database setup.

Before real use, verify deployed Admin/Student registration and OTP, staff activation, private uploads, booking approval/check-in, invoice creation, Stripe webhook settlement/return, payment explorer, cleaning assessment, chatbot and Android notifications. A valid environment file or passing health endpoint cannot prove provider delivery.

## Official hosting references

- [Node.js binding and environment](https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/)
- [Reverse proxy headers](https://help.alwaysdata.com/en/docs/web-hosting/sites/http-stack/)
- [HTTP to HTTPS](https://help.alwaysdata.com/en/docs/web-hosting/sites/ssl-tls/redirect-http-to-https/)
- [Idle process behavior](https://help.alwaysdata.com/en/docs/web-hosting/sites/misc/)
- [Free plan](https://www.alwaysdata.com/en/offers/)
- [Outbound network policy](https://help.alwaysdata.com/en/docs/technical-specifications/network/)
