# Deploy HostelHive backend on Render with Brevo

Prepared 7 November 2026. These instructions match the existing backend. Email uses Brevo's HTTPS API in local development and deployment. No account, deployment, API key, live email or database data is created by this preparation.

## 1. Configure Brevo

1. Sign in to Brevo. Open **Settings > SMTP & API > API Keys & MCP** and generate an API key with permission to send transactional emails. This integration uses an API key, not an SMTP key.
2. Add and verify the sender under **Senders, Domains & Dedicated IPs**. Authenticate the sending domain when available. The actual sender in `EMAIL_FROM` must be approved for your account. A technical SMTP login is not a sender address.
3. Complete any account activation/transactional sending requirements shown by Brevo.
4. Keep the key private. Enter it in Render's environment settings, never in Git or web/mobile public variables.

## 2. Prepare MongoDB Atlas and application URLs

- Use your Atlas connection string with an explicit `/hostelhive` database name. URL encode special characters in the database password. Local `127.0.0.1` MongoDB cannot serve the deployed backend.
- In Render, open the backend service's **Connect > Outbound** tab. Add all listed outbound CIDR ranges to Atlas **Network Access**. They are database connection allowlist entries, not incoming trusted proxy addresses.
- Assign the actual admin HTTPS origin before completing `CLIENT_WEB_ORIGIN` and Stripe Connect callbacks. You can reserve the admin domain first and deploy the admin afterward. Placeholder/localhost origins fail production validation.
- Keep existing strong, different JWT access/refresh secrets, ImageKit configuration and valid credentials for each enabled optional integration.

## 3. Create the Render service

Commit and push the intended backend changes, including `.github/workflows/backend-ci.yml`, to `main` without committing `.env`. In GitHub's **Actions** tab, wait for the **Backend CI / Backend checks** job to pass before creating the first service. In Render select **New > Web Service** and connect the GitHub repository through the GitHub integration.

| Field | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Root directory | Leave blank for a backend-only repository. For a combined repository use the actual backend folder path relative to its Git root. |
| Build command | `npm ci --omit=dev && npm run config:check` |
| Start command | `node server.js` |
| Health check path | `/ready` |
| Instance | Free for evaluation within Render's limits; continuously running paid compute if uninterrupted workers are required. |

The build command validates configuration offline, without opening a database connection or contacting providers. Production startup separately connects to Atlas, verifies transaction support, and creates declared indexes before listening. Index conflicts prevent startup; no indexes or documents are dropped.

Do not use nodemon, local MongoDB startup commands or a command that imports only `src/app.js`.

### Configure continuous deployment once

1. Open the service's **Settings > Auto-Deploy** and select **After CI Checks Pass**. If the creation form exposes this option under **Advanced**, select it there before the first deployment; otherwise make the change after creation. The initial service creation is a deployment, so check the first GitHub run before clicking **Deploy web service**.
2. Keep the linked branch set to `main`. Use a connected GitHub repository, not just a public Git URL. Grant Render access to that repository when GitHub requests it.
3. Keep production secrets in Render's **Environment** section. This CI workflow does not need `.env`, an Atlas URI, provider keys, a Render API token or a deploy-hook secret in GitHub.
4. Subsequent pushes/merges to `main` run CI. Render automatically builds and deploys the commit after its checks pass. Pull requests run CI without deploying; a manual GitHub workflow run only runs CI and is not an explicit deployment request.
5. Check CI in GitHub **Actions**, then deployment status in Render **Events** and build/runtime logs. A green CI check does not prove that Render's separate build, configuration validation or readiness checks passed. If CI fails, correct the failure and push again; do not switch to **On Commit** to bypass it.

Render's default **On Commit** setting deploys immediately without waiting for CI. Set **After CI Checks Pass** explicitly. Render does not deploy when no checks are detected or any check fails; it accepts GitHub `success`, `neutral` and `skipped` conclusions. The backend job has no path filters or job-level skip condition, so changes to `main` receive the complete check. Do not also add a deploy-hook workflow: this service uses Render's native integration to deploy the checked commit.

### What CI checks

| Stage | Implementation |
| --- | --- |
| Events | Push to `main`, pull request targeting `main`, manual dispatch |
| Runtime | GitHub-hosted Ubuntu 24.04, Node 22.22.0 |
| Dependencies | `npm ci --include=dev --no-audit --no-fund`, using the committed lockfile |
| Static checks | `npm run lint` and `node --check` for tracked JavaScript/CJS/MJS files |
| Database | Disposable MongoDB 8.0 container, bound to runner loopback; the existing MongoDB driver initializes `hostelhiveCI`, waits for a primary and checks the same URI used by Jest |
| Existing tests | `npm test -- --ci`; Jest's current setup uses isolated database names, mocked/disabled providers and fixture credentials; live Stripe testing is disabled |
| Cleanup | The CI container and its temporary volumes are removed after the job; superseded runs are cancelled and jobs have a 20-minute deadline |

The runner never uses the production Atlas database. No new tests or application endpoints are introduced by this workflow. Production configuration is validated in the Render build with the actual Render environment, not with production secrets in CI. CI files and tests remain outside the existing npm package and Docker runtime allowlists; a native Render service still clones the Git repository and installs production dependencies only.

If the MongoDB startup step fails, expand both **Start isolated transaction-capable MongoDB** and **Show MongoDB diagnostics on failure**. The workflow prints driver connection errors, detects an exited container, and retains its state and full startup logs. Image download success alone does not mean the database started. These failures concern the disposable CI database; do not add production Atlas credentials to GitHub to work around them.

## 4. Enter Render environment settings

Set these privately in the service's **Environment** section. Replace every illustrative value with your own.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `22.22.0` (the existing development Node version; selects Node 22 explicitly) |
| `HOST` | `0.0.0.0` |
| `BREVO_API_KEY` | Your Brevo API key |
| `EMAIL_FROM` | `HostelHive <your-verified-sender@your-domain>` or the verified email address alone |
| `EMAIL_API_TIMEOUT_MS` | `15000` |
| `MONGO_URI` | Your Atlas URI, including `/hostelhive` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Different strong random secrets, each at least 32 bytes |
| `CLIENT_WEB_ORIGIN` | Actual admin HTTPS origin, without trailing slash/path; comma-separate intended additional browser origins |
| `CLIENT_IP_HEADER` | `x-forwarded-for`, after verifying the deployment's forwarded header chain |
| `TRUST_PROXY` | Verified incoming proxy IP/CIDRs or hop arrangement; see below |
| `ALLOW_SIMULATED_UPLOADS` | `false` |
| `BILLING_TIMEZONE` | `Asia/Karachi` unless the intended billing timezone differs |
| `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` | Your ImageKit keys and HTTPS URL endpoint |

Render supplies `PORT`; let the server use it. Remove any copied alwaysdata-specific `IP` binding from Render's environment. `NODEJS_VERSION` is an alwaysdata setting; Render uses `NODE_VERSION`.

Email settings are `BREVO_API_KEY`, `EMAIL_FROM` and optional `EMAIL_API_TIMEOUT_MS` only. Use the same Brevo settings in your local `.env` for development. Import the current cleaned configuration when configuring Render.

### Proxy and rate-limit configuration

Do not reuse alwaysdata's `x-real-ip` configuration automatically. Verify the incoming Render proxy chain for your chosen public URL/custom proxy before enabling forwarded-header trust. Use the explicit upstream networks or verified hop count in `TRUST_PROXY`; do not use blanket `true` or `/0`. For example, `1` is appropriate only when the single trusted final hop and all accessible routes have been verified.

The platform's outbound ranges used for Atlas are unrelated to this incoming proxy trust setting. A false/mistaken trust setting can make everyone share a proxy quota or permit forged client IPs. This cannot be confirmed from a local checkout. Verify from different client networks before public use.

### Optional providers

- **Stripe:** supply the matching key group and hosted webhook signing secret. Use actual HTTPS admin callbacks ending `/admin/stripe/complete` and `/admin/stripe/refresh`. Register `https://YOUR_BACKEND/api/payments/webhook` with events listed in `.env.example`. Existing installed mobile return routes are `hostelhive://payments/success` and `hostelhive://payments/cancel`; provider acceptance and device return require checking. An actual HTTPS return page is required if the provider rejects custom-scheme redirects. The admin app does not provide student payment-success pages. Never infer payment settlement from a redirect.
- **Groq:** retain the existing chatbot/vision model settings and private key.
- **Blockchain:** use a valid HTTPS RPC and a dedicated test-wallet private key together; real writes require testnet gas. Missing configuration is not a successful chain verification.
- **Firebase:** provide the complete service-account group from the same Firebase project as Android. Literal escaped `\n` in the private key is supported. Never put that private key in the mobile app.

Leave an unused optional integration's whole credential group empty instead of supplying partial/example values. Email and upload storage are required for production workflows.

## 5. Deploy and check

1. Deploy the service and inspect build/startup logs. Configuration errors contain names of settings, not their secret values.
2. Open `https://YOUR_BACKEND/health` and `/ready`. Both should return HTTP 200. Readiness includes MongoDB, not Brevo/Stripe/other provider delivery.
3. Trigger one authorized signup, password reset or staff activation, then inspect Brevo's **Transactional > Email logs** and the recipient inbox. Confirm the received code works before its existing 90-second expiry. HTTP 201 with a message ID means Brevo accepted the request; it does not guarantee inbox delivery.
4. Check the configured proxy trust, upload and enabled payment/push/chatbot/cleaning/blockchain workflows before relying on them.
5. Set the web `VITE_API_BASE_URL` and mobile `EXPO_PUBLIC_API_URL` to `https://YOUR_BACKEND/api` in their deployment environments, then rebuild the clients. This backend change does not edit either client.

### Safe email diagnostics

The email integration logs categories such as `BREVO_HTTP_401`, `BREVO_HTTP_403`, `BREVO_HTTP_429`, `BREVO_NOT_CONFIGURED`, `BREVO_TIMEOUT` or `BREVO_ERROR`, without provider response bodies, recipients, OTPs or keys. Check Brevo's dashboard for details of rejected senders, disabled sending, rate/credit limits or blocked recipients. API callers keep the existing generic HTTP 503 message.

There is no automatic resend. A timeout can be ambiguous if the provider already accepted the message. Use the existing resend flow and its rate limits. The request timeout covers the response body too and defaults to 15 seconds (configurable 1-30 seconds).

## 6. Render Free behavior

Free web services block outbound SMTP ports 25, 465 and 587. Brevo HTTPS uses port 443 and avoids that restriction.

Render Free spins down after 15 minutes without incoming traffic and can take about one minute to wake. Brevo does not keep the backend awake. Registration, email requests, in-process invoice reconciliation and outbox workers run only while the backend runs. Jobs resume under the existing retry/lease/expiry rules on wake; time-sensitive cleaning jobs may expire. Use continuously running compute if exact timing is required.

Atlas stores application data and ImageKit stores uploads. Render's ephemeral filesystem must not be used as persistent application storage. Free capacity/usage limits still apply. A passing local check does not claim a deployed service, provider connectivity, deliverability or load capacity.

## Official references

- [Render Node/Express deployment](https://render.com/docs/deploy-node-express-app)
- [Render automatic deployments and CI integration](https://render.com/docs/deploys#integrating-with-ci)
- [GitHub checkout action](https://github.com/actions/checkout)
- [GitHub Node setup and npm caching](https://github.com/actions/setup-node)
- [MongoDB official Docker image](https://hub.docker.com/_/mongo)
- [Render port binding](https://render.com/docs/web-services#port-binding)
- [Render Node versions](https://render.com/docs/node-version)
- [Render Free restrictions](https://render.com/docs/free)
- [Render outbound IPs](https://render.com/docs/outbound-ip-addresses)
- [Render and MongoDB Atlas](https://render.com/docs/connect-to-mongodb-atlas)
- [Brevo transactional email API](https://developers.brevo.com/reference/send-transac-email)
- [Brevo API keys](https://help.brevo.com/hc/en-us/articles/40159485019794-Create-and-manage-your-API-keys)
