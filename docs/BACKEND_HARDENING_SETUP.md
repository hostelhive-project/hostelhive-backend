# Backend hardening: setup and rollout

This guide accompanies `../../HOSTELHIVE_BACKEND_FIX_REPORT.md`. Source fixes are implemented; configuration and existing provider data require the steps below. No existing application database or ImageKit files were migrated by the implementation work.

**Render + Brevo hosting:** see [the deployment guide](RENDER_DEPLOYMENT.md). Email uses Brevo HTTPS in local development and deployment with `BREVO_API_KEY` and a verified `EMAIL_FROM`. The request deadline defaults to 15 seconds (`EMAIL_API_TIMEOUT_MS`); the existing 90-second OTP expiry and auth contracts are preserved. No live provider delivery is implied by passing configuration validation.

## 1. Use a transaction-capable database

**Subsequent fresh-start reset, 6 November 2026:** at the user's request, both project databases on ports 27018 and 27017 were emptied, the migration backup was deleted, and no new backup was made. The replica configuration and collection indexes remain active. Migration counts below are historical.

**Local setup completed on 6 November 2026:** this workspace now uses `hostelhiveDev` on `127.0.0.1:27018`. The original standalone service remains on port 27017. All 994 documents in 20 collections were copied and verified, and 58 indexes were compared. See [Local MongoDB setup](LOCAL_MONGODB_SETUP.md) for startup, backup location, and verification details. The standalone observation below describes the original audit state.

The configured local server inspected during this task reported standalone MongoDB. Atomic booking, occupancy, settlement, offline payment and staff assignment changes require a replica set or a transaction-capable Atlas deployment. Unsupported operations deliberately return HTTP 503 instead of falling back to partial writes.

Before switching a database, back up the existing deployment and verify its restore procedure. Do not delete its data folder, run `rs.initiate()` against an arbitrary running server, or replace its URI without moving the required data. A separate empty server will not contain existing users or bookings.

### Separate local development replica set on Windows

The installed binary found on this machine is `C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe`. Use a **new** folder and an unused port. The example leaves the current MongoDB service alone:

```powershell
# From hostelhive-backend. Use an empty folder dedicated to this new instance.
$replicaData = Join-Path $env:LOCALAPPDATA 'HostelHive\mongo-rs-development'
if (Test-Path -LiteralPath $replicaData) { throw 'Choose a new empty replica-data folder.' }
New-Item -ItemType Directory -Path $replicaData -Force | Out-Null
Start-Process -FilePath 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe' -WindowStyle Hidden -ArgumentList @(
  '--dbpath', ('"' + $replicaData + '"'), '--port', '27018',
  '--bind_ip', '127.0.0.1', '--replSet', 'hostelhiveDev',
  '--logpath', ('"' + (Join-Path $replicaData 'mongod.log') + '"')
)
```

Initialize **only that new server**, once, from the backend directory:

```powershell
@'
const { MongoClient } = require('mongoose').mongo;
(async () => {
  const client = await MongoClient.connect('mongodb://127.0.0.1:27018/?directConnection=true');
  try {
    await client.db('admin').command({ replSetInitiate: {
      _id: 'hostelhiveDev', members: [{ _id: 0, host: '127.0.0.1:27018' }]
    } });
  } finally { await client.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@ | node
```

Wait until the new server elects a primary. Restore the intended application data into it using your backup/restore procedure. Then set this value in your **local** backend `.env` and restart the backend:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27018/hostelhive?replicaSet=hostelhiveDev
```

An authenticated Atlas replica set is another option. A single local member supports development transactions but does not provide production redundancy. This example is loopback-only and must not be exposed as a public unauthenticated database.

## 2. Check existing records and indexes before rollout

The implementation does not discard or rewrite conflicting history automatically.

- `Hostel.ownerAdminId` is now unique. Resolve existing duplicate owners before building that index. The API also checks ownership inside a transaction.
- Inspect duplicate active bookings per student. New requests serialize on the student record, but already-existing Pending/Approved/CheckedIn duplicates need an administrator's decision; no arbitrary booking was cancelled.
- Check existing orphaned bookings/invoices/work records. Deletion guards prevent new routine deletion of referenced rooms/hostels; they cannot restore records deleted previously.
- Build model indexes before admitting production traffic. New collections include `AuthSession`, `OutboxEvent`, `JobLease`, `PaymentAdjustment`, `UploadedFile`, `BillingState` and `RateLimitBucket`. Important unique indexes include owner, invoice cycle, payment reference, notification delivery key and audit idempotency key. Review index creation failures; do not blindly run `syncIndexes()` and drop other indexes.
- Existing manually locked rooms remain protected on release through legacy lock inference. New admin lock changes explicitly persist `manuallyLocked`.

## 3. Migrate old identity-document files separately

**New CNIC uploads:** students only; ImageKit private storage; server-owned `UploadedFile` metadata; ownership validation on booking submission; signed URLs valid for 900 seconds in authorized booking responses. Refresh the booking to obtain a new URL after expiry. Missing configured storage returns an error rather than a fabricated upload.

**Existing CNIC uploads:** old public URLs are not made private merely by signing a URL in a response. Existing cached/public copies may remain accessible. This migration was not executed against ImageKit.

1. Inventory `Booking.cnicFrontUrl` and `cnicBackUrl` against ImageKit file IDs and the corresponding student. Do not export documents into a public report.
2. Confirm each file's actual provider privacy setting. Files on other hosts or outside the configured `/cnic/` path are withheld by the new serializer and need explicit migration/re-upload.
3. Re-upload legacy documents as private files under `/cnic/<studentId>/` if their privacy cannot be changed safely through the provider. The installed SDK's `FileDetailsOptions` does not declare an `isPrivateFile` update option; do not assume an unsupported update changes privacy.
4. Create matching owner/file metadata and update booking references to their canonical private URLs. Verify both authorized signed delivery and rejected unsigned delivery.
5. After the replacement is verified and retention requirements are checked, remove/restrict old public files and purge their CDN caches. Old downloaded copies cannot be revoked by this API.

`ALLOW_SIMULATED_UPLOADS=true` permits explicitly labelled **public** development simulations only. It never permits simulated CNIC uploads or production simulations. File validation checks PNG/JPEG/WebP signatures and normalizes extensions; it is not antivirus scanning or a complete image decoder.

## 4. Authentication behavior

- Re-registering an unverified Student/Admin email replaces credentials and OTP together. Only the newest challenge activates that registration.
- Refresh tokens rotate once and are backed by hashed `AuthSession` records. Old refresh tokens without the new session identity require a new sign-in.
- Password reset/change and logout invalidate previously issued access tokens through `sessionVersion` and revoke refresh sessions. Logout currently signs that account out on **all devices**. Password change also requires signing in again; clients must handle the following 401.
- Existing access tokens without a version are accepted only while the account remains at version zero. They become invalid on the first revocation event.
- Account limits are normalized-email/user-ID buckets backed by MongoDB. Since the 7 November hosting hardening, general/auth IP quotas also persist in MongoDB in production; development/test IP quotas use memory. Configure trusted-proxy/network controls deliberately; alwaysdata's X-Real-IP needs explicit header selection and a trusted socket peer. Do not enable blanket `trust proxy`. See [alwaysdata deployment](ALWAYSDATA_DEPLOYMENT.md).

## 5. Stripe delivery and reconciliation

Subscribe the **platform destination-charge webhook** to:

```text
checkout.session.completed
checkout.session.expired
payment_intent.payment_failed
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
account.updated
```

For local development, forward those events with Stripe CLI and keep that listener running:

```powershell
stripe listen --events checkout.session.completed,checkout.session.expired,payment_intent.payment_failed,charge.refunded,charge.dispute.created,charge.dispute.updated,charge.dispute.closed,account.updated --forward-to http://localhost:5000/api/payments/webhook
```

Set the signing secret from your listener privately and restart the backend if it changed. Hosted deployments use a reachable registered webhook endpoint instead of the local listener. Browser success redirects do not settle payments.

- Settlement verifies recorded checkout identity and the snapshotted charged amount/currency before atomically marking Payment/Invoice paid and queuing side effects.
- Stripe failures are associated by PaymentIntent/metadata, not by pretending an intent ID is a Checkout Session ID. A declined card leaves its open checkout resumable.
- Refund/dispute events enqueue durable jobs. Workers fetch current Stripe objects to tolerate event reordering. Cumulative amounts are converted using the original charged amount; immutable adjustment deltas update collected-rent reporting without counting a reversal twice.
- A dispute is shown separately while pending; a lost dispute reduces collected rent. This ledger is not a real-time Stripe available-balance statement, and it does not automatically move money back from a connected account.
- A fully reversed paid payment no longer produces an ordinary paid receipt. `Paid` retains historical settlement meaning; `refundedAmount`, `disputeStatus` and related Payment fields describe reversals. Clients were not redesigned in this backend task, so dedicated reversal badges/screens are not added.
- Historical events not delivered to this API need controlled Stripe replay/reconciliation. Old paid records without original charge/exchange metadata may require operator review. No historical refund was invented.

## 6. Durable audit and notification workers

Start with `npm run dev` or `npm start` so `server.js` starts both workers. Importing `src/app.js` alone does not start them.

- Outbox runs at startup and every 5 seconds, with job leases, per-claim ownership and capped retry backoff. Critical complaints enqueue an anchor at creation; payment settlement enqueues atomically. Reconciliation also picks up missing historical references.
- Audit records persist the payload snapshot, canonical hash version, reserved nonce and signed transaction before broadcasting. Retries reuse those signed bytes rather than issuing a new transaction each time.
- Use a wallet dedicated to this application; unrelated senders using its nonce can block queued transactions. A stalled/reverted transaction, depleted gas balance or missing credentials requires operator attention. Inspect `OutboxEvent.lastError`, attempts and next retry time; no automatic gas top-up or nonce replacement is implemented.
- Database source comparison, snapshot comparison and RPC transaction/receipt verification are returned separately. `Simulated`, `Pending`, `Unavailable` and `Mismatch` never mean a verified real-chain proof. Legacy records retain their original hash format. Existing simulated references are not automatically replaced with real transactions.
- Configure both blockchain variables for production. Missing credentials cannot silently produce a production simulated anchor. Keep the original configured network available when verifying old records.
- Inbox notifications deduplicate by delivery key. External push delivery is at least once and can repeat if the process stops after sending but before acknowledging its outbox job.

## 7. Billing and offline money records

- Billing timezone defaults to `Asia/Karachi`, configurable through `BILLING_TIMEZONE`. A check-in triggers the first invoice; startup/hourly reconciliation retries missed cycles.
- `BillingState` document `monthly` records the first catch-up month. Initial rollout starts with the current month to avoid creating unreviewed historical dues. Widening that month changes billing history and needs an explicit administrative decision.
- Catch-up uses known check-in/checkout dates. Undated legacy checkouts are skipped for manual review. Monthly rent is not prorated; this task preserves the existing monthly charging policy.
- Unpaid/partially paid past-due invoices become `Overdue` during reads and scheduled reconciliation.
- Zero snapshotted rent remains zero and requires no payment. It contributes no cash collection.
- Offline mark-paid records a Payment with actor, method and actual recorded time, plus audit/notification jobs in one transaction. Optional body: `{ "paymentMethod": "Cash" }`; BankTransfer/JazzCash/EasyPaisa are also accepted. An empty body keeps Cash as the default. Active online checkout blocks offline settlement.
- Old paid invoices without a Payment are labelled legacy offline receipts, without inventing the original payment timestamp or collector. Decide on any historical ledger migration from real evidence.

## 8. Checks performed and safe reruns

See the fix report for the final test counts. Automated checks use a separate temporary **replica set**, never the configured application database. Jest creates random `hostelhive_test_*` databases for the ordinary suites; the existing catalog and navigation suites retain their own guarded `hostelhive_room_catalog_test_*` and `hostelhive_ui_navigation_test_*` names. `connectDB()` refuses the ordinary application database in test mode. Email, push, Groq and chain sends are disabled; live Stripe is opt-in and skipped by default.

To rerun against your development replica set while keeping test databases isolated:

```powershell
$env:MONGO_URI='mongodb://127.0.0.1:27018/?replicaSet=hostelhiveDev'
npm.cmd run lint
npm.cmd test
```

Legacy suites may leave fixture-only documents in their generated test databases. Remove only confirmed disposable `hostelhive_test_*` databases after the run. Do not run collection-wide cleanup in the application database.

Live Stripe delivery, real testnet broadcasts, email/push delivery, ImageKit privacy/cache migration and frontend receipt/re-authentication rendering were not exercised by these offline checks.
