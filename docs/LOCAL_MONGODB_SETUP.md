# Local MongoDB replica set

Configured on 6 November 2026 for this Windows development machine.

**Latest state — user-requested fresh start, 6 November 2026:** all documents were removed from both `hostelhive` databases on ports 27018 and 27017. Collections and indexes remain for fresh manual testing. The migration backup, saved environment backup, and stopped temporary integration database files were deleted; no replacement backup was created. The migration counts below describe the earlier successful setup, not the current data contents. Register new accounts to begin testing.

## Active connection

```dotenv
MONGO_URI=mongodb://127.0.0.1:27018/hostelhive?replicaSet=hostelhiveDev
```

- Replica set: `hostelhiveDev`, one writable member.
- MongoDB binary: `C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe`.
- Database directory: `%LOCALAPPDATA%\HostelHive\mongo-rs-development`.
- MongoDB log: `%LOCALAPPDATA%\HostelHive\mongo-rs-development.log`.
- Binds only to `127.0.0.1`; this is a local development instance.
- MongoDB Compass should use the active connection above. The previous `localhost:27017` connection points to the preserved original data, which will no longer receive application updates.

## Normal startup

From `hostelhive-backend`:

```powershell
npm run dev
```

The `predev` hook starts the existing local replica if stopped, waits for a writable primary, and then starts the backend. `npm start` has the same database startup hook. To start only MongoDB:

```powershell
npm run db:start
```

These hooks use machine-specific `.local-mongo.json`, which is ignored by Git. They do not create a fresh replica or copy data at startup. On machines without this local settings file, normal start hooks leave database management to the configured MongoDB connection. A changed/remote `MONGO_URI` is not replaced by the helper. Directly running `node server.js` bypasses npm hooks; run `npm run db:start` first if needed.

The replica is a separate user process, rather than an additional Windows service. After a Windows restart, the npm hook starts it again. Its disk data persists across restarts.

## Original instance and backup history

The original MongoDB Windows service, configuration, and data directory were left in place on port `27017`. Its application documents were subsequently cleared at the user's request along with the active replica's documents. The backend was stopped during the original copy and during the reset.

Former backup folder (deleted at the user's request):

```text
%LOCALAPPDATA%\HostelHive\backups\standalone-2026-11-06T12-14-43-074Z-f72347eb
```

This folder previously contained raw BSON, collection metadata, and the prior backend `.env`. Those files have been deleted. No database backup is retained by this setup.

All **994 documents across 20 collections** were restored and matched byte-for-byte BSON SHA-256 digests, retaining existing IDs, password hashes, and BSON types. Collection options and indexes were copied; **58 indexes** were compared successfully. TTL indexes may subsequently remove expired records as normal.

Both instances were cleared. Continue using port 27018 for new data; changing back to port 27017 will not recover the removed records.

## Configuration verification performed

- Replica elected a writable primary named `hostelhiveDev`.
- Committing a transaction succeeded.
- Aborting a transaction left no committed document.
- Probes used a generated `hostelhive_setup_check_*` database, which was removed afterward; business records were not modified by the probes.
- The replica was shut down and successfully restarted with `npm run db:start`.
- Environment comparison confirmed that only `MONGO_URI` changed in `.env`.
- Backend restarted, logged its connection to `127.0.0.1/hostelhive`, and returned HTTP 200 with `status: ok` from `/health` on port 5000.

No project test suites were run as part of database setup. No Atlas account, paid service, or dependency was added.

## Setup scripts

- The completed one-time migration script was removed during cleanup. Daily startup does not copy data or create backups.
- `scripts/start-local-mongo.cjs`: idempotent startup and identity checks for the existing local replica. Never initializes or migrates another database.

For another machine, use the manual replica initialization instructions in [Backend hardening setup](BACKEND_HARDENING_SETUP.md), or configure Atlas. Do not copy this machine's absolute-path settings file to another computer.
