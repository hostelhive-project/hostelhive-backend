# HostelHive — Backend Understanding Document
**Prepared from:** SRS (Phase I, v1.2) + SDS (Phase II, v2.2) + UML Class Diagram + ERD + 5 Sequence Diagrams + 30 UI wireframes/screens
**Stack (per SDS):** React (web) / React Native (mobile) → Node.js/Express REST API → MongoDB (Mongoose) → Payment Gateway, AI Chatbot, Blockchain Ledger as external integrations. JWT + bcrypt for auth. Deployment target: Docker on AWS ECS/Fargate, MongoDB Atlas.

> This is a understanding/planning document, not code. Every section below states what the source documents say, and — where they disagree with each other or with the actual UI — what I'd build instead and why. Flagged items are marked **⚠ CONFLICT** or **➕ MISSING**.

---

## PART 1 — System Understanding

HostelHive digitizes hostel operations for four actor types that all sit on **one `users` collection** distinguished by a `role` field:

| Role | Who they are | What SRS/SDS/screens say they do |
|---|---|---|
| **Student** | Someone searching for a hostel, not yet living anywhere | Search/filter hostels, view details & reviews, submit a booking request |
| **Resident** | A student whose booking has been approved and checked in | Pay rent, view payment history, submit complaints, receive notifications, chat with AI assistant |
| **Admin** | Hostel operations staff (scoped to one hostel branch) | Register hostel/rooms, allocate rooms, approve/reject bookings, manage complaints, assign cleaning tasks, view dashboard reports |
| **CleaningStaff** | Maintenance/cleaning crew | Receive assigned tasks, update status, upload before/after proof photos |

**Key architectural fact from the SDS:** this is a **layered (N-tier) + client-server hybrid**, not microservices. One Express API serves both the React Native app and the React web dashboard. There is a single MongoDB behind it — Mongo is explicitly chosen for its flat, un-nested document model to avoid SQL-style joins at scale (NFR-09, Design Quality §10).

**Student vs. Resident — a design decision the diagrams get wrong (see Part 6, Conflict #1):** the SRS and screens describe "Resident" as a *life-cycle stage* of a Student (a student *becomes* a resident once their booking is approved and they check in) — not a role someone deliberately signs up as. But the ERD/class diagram hard-code `role: Enum[Student, Resident, Admin, CleaningStaff]` as if it's chosen at registration. I address this below.

---

## PART 2 — Feature Breakdown (by module, with source cross-checks)

### 2.1 Authentication & RBAC
- Registration → bcrypt hash → Mongo insert → 201 (SDS Flow 1, Fig 3 confirms).
- Login → credential check → signed JWT `{userId, role}` → 200 (Fig 3 "Flow A").
- RBAC middleware decodes JWT on every request, checks role against route rules, rejects with 403 before business logic runs (Fig 3 "Flow B"). This matches the SRS's `<<include>>` UC-02 dependency on nearly every other use case in the Use Case Diagram — login gates everything, which is correct and consistent across all documents.
- **➕ MISSING (all documents):** no password-reset/forgot-password flow, no refresh-token / token-expiry handling, no email verification, no logout token invalidation (the `/api/auth/logout` endpoint in Table 10 returns a message but there's no server-side token blacklist — with stateless JWT this is a real gap for a production system).

### 2.2 User Management
- SRS UC-03 / US-03: view & update profile, applies to all roles.
- **⚠ Screens contradict the schema.** The Student Registration wireframe (§7.3.3) collects **Full Name, Student ID (reg#), Mobile number, Email, Password**. The `users` collection (Table 3) only has `name`, `email`, `passwordHash`, `role`, `isActive`. `Student ID` and `Mobile` are captured in the UI but have nowhere to live in the schema. Same gap on the Staff Registration and Admin Registration screens (which visually differ but weren't schema'd separately at all).
- **➕ MISSING:** no `/api/users/:id` GET/PUT endpoints anywhere in Table 10, despite this being one of the eight core use cases (UC-03) and having its own epic-level priority (Medium, PB-03). This is a real hole, not a nuance — profile management literally has no API surface in the current design.

### 2.3 Hostel Management
- CRUD on hostels (`/api/hostels`) is in Table 10 and matches EP-02/PB-04-06.
- **➕ MISSING:** `facilities: Array<String>` exists, but there's no `images: Array<String>` field despite every hostel-search/detail screen showing photos, and no `rating`/`reviewCount` despite the SRS explicitly promising "reviews" as a stakeholder expectation (Table 2: "Accurate hostel information... and reviews") and US-05's acceptance criteria mentioning comparison. **A `Review` entity is referenced in requirements and UI copy but does not exist in the ERD, class diagram, or schema tables at all.**
- **➕ MISSING:** no `adminId`/`ownerId` on the Hostel document. With RBAC being purely role-based (any user with role=Admin can hit any `/api/hostels/:id` route), and NFR-09 explicitly requiring the system to "support multiple hostels," there is currently no way to stop one hostel's Admin from editing another hostel's data. This is both a data-model gap and a security gap.

### 2.4 Room Management & Booking
- Room schema (capacity, occupiedCount, isLocked, uiColorTag) is solid and directly supports the concurrency requirement in TC-ROOM-01 (double-booking prevention via `isLocked` mutex).
- **⚠ CONFLICT — this is the most important one in the whole package.** See Part 6, Conflict #1: the "Room Booking & Blockchain Payment" sequence diagram (Fig 4) shows a student's booking request going *straight through* to payment and blockchain write in one call — no admin step. But:
  - The Booking class/schema explicitly has a `status` enum of `Pending → Approved → CheckedIn → Cancelled`.
  - The Admin Operations sequence (Fig 6) shows a *separate* `/api/v1/admin/allocate` flow where an admin approves a booking and only *then* is `occupiedCount` incremented.
  - The API table has explicit `/api/bookings/:id/approve` and `/api/bookings/:id/reject` endpoints.
  - The SRS treats Room Allocation (UC-07, EP-03) as an admin-only use case, separate from Room Booking (UC-06, student-only).

  Fig 4 is the outlier and should not be followed literally — it collapses two distinct, separately-modeled workflows into one. I build the **Pending → Approved → Payment → CheckedIn** pipeline, not Fig 4's shortcut.

### 2.5 Rent & Payment Management
- **⚠ CONFLICT — ERD cardinality is wrong.** The ER diagram labels the Booking→Payment relationship "bills (**Exactly 1**)." But:
  - The Payment Receipt screen shows a "Recent Activity" list of *multiple past transactions* per resident.
  - The Rent Payments screen shows **recurring monthly charges** ("Current Rent: Rs. 15,000" + "Mess Fee: Rs. 4,500" = "Outstanding: Rs. 19,500"), i.e. rent is billed every month for the life of a booking, not once.
  - US-09's acceptance criteria says "payment records displayed correctly" (plural).

  A one-time-lease-fee interpretation (1 Booking : Exactly 1 Payment) cannot represent monthly rent. The correct cardinality is **Booking (1) — Payment (0..\*)**: one booking generates many payment records over its lifetime. The `bookingId` FK on the Payments collection (Table 7) already supports a one-to-many relationship at the storage level — only the ERD's "Exactly 1" label and the class diagram's implied single-payment-per-booking flow (Fig 4) are wrong.
- **➕ MISSING:** there is no entity representing a **monthly rent invoice / due-charge** (what the UI calls "Current Rent" + "Mess Fee" = "Outstanding") that exists *before* a payment is made against it. Right now `Payments.paymentStatus` includes `Unpaid`, implying a Payment document is created ahead of time and then paid — but nothing in the design says who creates it, on what schedule, or how "Mess Fee" (a distinct line item in the UI) is represented. This needs an `Invoice`/`RentDue` collection with a monthly cron/scheduled job, and Payments should reference an Invoice, not a Booking directly.
- **➕ MISSING:** `paymentMethod` field (JazzCash / EasyPaisa / Bank Transfer are all shown as selectable options on the Rent Payments screen) doesn't exist in the Payments schema at all.

### 2.6 Complaint Management
- Clean and consistent across SRS, class diagram, ERD, and Fig 7 (Submitted → InReview → Resolved, severityTier drives escalation). No conflicts found here.
- One nuance: the SDS Sprint 8 log entry says blockchain records cover "financial receipts and **severe building complaints**," and the class diagram's `Complaint` class has no `syncToBlockchain()` method (only `Payment` does) — the design intent (from the sprint log / abstract) and the class diagram disagree on whether critical complaints get blockchain-logged. I treat this as a real requirement (Critical-severity complaints get a blockchain hash too) since it's stated in two independent places (Abstract + Sprint 8 evolution notes) and only *absent*, not contradicted, in the class diagram.

### 2.7 Cleaning & Task Management
- Consistent across all docs: `CleaningTask` has `taskType`, `status`, before/after image URIs, staff notes. Fig 5 confirms the start/complete PATCH flow, and TC-TASK-01 confirms `afterImageUri` is a hard validation requirement on completion.
- No major conflicts. Minor gap: no explicit recurrence/schedule model (SRS mentions "cleaning schedules" as a problem area in EP-06, but tasks are one-off documents with a single `scheduledTime`, not a recurring rule).

### 2.8 Notifications & Communication
- **➕ MISSING — entirely.** This is a full epic (EP-07), a High-priority backlog item (PB-14), a functional requirement (UC-14), an NFR (NFR-15), and it appears explicitly in two sequence diagrams (Fig 6 "Push Notification via FCM," Fig 7 implied by admin status changes) — yet there is **no `Notifications` collection anywhere in the ERD, class diagram, or Table 10 API list.** The SDS names the delivery mechanism (Firebase Cloud Messaging) in the External API Integration sub-module description, but never models the notification as a stored, queryable entity. Users can't have a notification inbox/history without one.

### 2.9 AI Hostel Assistant (Chatbot)
- EP-09, US-15, and a dedicated "Support Assistant Screen" wireframe all exist. The architecture diagram shows an "AI Chatbot LLM Service" as an external integration point.
- **➕ MISSING:** no `/api/chatbot` (or similar) endpoint in Table 10, and no `ChatMessage`/`ChatSession` collection anywhere — meaning there's no way to store conversation history, which the Support Assistant screen visually implies (a scrollable chat thread).

### 2.10 Blockchain Records
- Modeled only as a side effect of `Payment.syncToBlockchain()` (writes `transactionReference`). There is no dedicated `BlockchainRecord`/`Ledger` collection to independently verify or audit records, and no read endpoint to fetch a verifiable ledger entry (only `/api/payments/:id/verify`, which checks payment status, not blockchain proof).

---

## PART 3 — Backend Architecture

```
hostelhive-backend/
├── src/
│   ├── config/            # env, db connection, firebase, payment gateway keys
│   │   ├── db.js
│   │   ├── firebase.js
│   │   └── env.js
│   ├── models/             # Mongoose schemas (one file per collection, see Part 4)
│   │   ├── User.js
│   │   ├── Hostel.js
│   │   ├── Room.js
│   │   ├── Booking.js
│   │   ├── Invoice.js       # ➕ new
│   │   ├── Payment.js
│   │   ├── Complaint.js
│   │   ├── CleaningTask.js
│   │   ├── Notification.js  # ➕ new
│   │   ├── ChatMessage.js   # ➕ new
│   │   ├── Review.js        # ➕ new
│   │   └── BlockchainRecord.js # ➕ new
│   ├── controllers/        # thin HTTP handlers — parse req, call service, format res
│   ├── services/           # business logic (bcrypt hashing, booking lock logic,
│   │                        #   invoice generation cron, blockchain hashing, etc.)
│   ├── repositories/       # Mongoose query layer, isolates controllers from ODM specifics
│   ├── routes/             # one router file per resource, mounted under /api
│   │   ├── auth.routes.js
│   │   ├── user.routes.js
│   │   ├── hostel.routes.js
│   │   ├── room.routes.js
│   │   ├── booking.routes.js
│   │   ├── payment.routes.js
│   │   ├── complaint.routes.js
│   │   ├── task.routes.js
│   │   ├── notification.routes.js
│   │   ├── chatbot.routes.js
│   │   └── admin.routes.js   # dashboard/report aggregations
│   ├── middleware/
│   │   ├── auth.middleware.js       # JWT decode
│   │   ├── rbac.middleware.js       # role check
│   │   ├── hostelScope.middleware.js # ➕ ensures Admin only touches their own hostel
│   │   ├── errorHandler.js
│   │   └── requestLogger.js
│   ├── validators/         # Joi/Zod schemas per route, mirrors SDS "Input validation sub-module"
│   ├── integrations/        # payment gateway client, AI chatbot client, blockchain client, FCM client
│   ├── jobs/                # scheduled tasks — monthly invoice generation, SLA escalation for complaints
│   ├── utils/               # bcrypt wrapper, jwt wrapper, response formatter, logger
│   └── app.js
├── tests/
├── .env.example
└── server.js
```

This maps directly onto the SDS's own module decomposition (Authentication Module → Registration/Login/RBAC sub-modules; Data Processing Module → Input validation/Hostel-room/Payment/Complaint/Notification sub-modules; API Layer → router/handler/middleware/external-integration sub-modules) — I'm not inventing a new architecture, just giving the SDS's prose description a concrete folder layout, plus the additions flagged in Part 2/6.

---

## PART 4 — Database Design (Final MongoDB Collections)

Corrections from the ERD are marked **➕/⚠**. Everything else matches Tables 3–9 as documented.

### `users`
| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId (PK) | |
| `name` | String | required |
| `email` | String | unique, indexed |
| `passwordHash` | String | bcrypt |
| `role` | Enum[Student, Admin, CleaningStaff] | **⚠ "Resident" removed as a role** — see Conflict #2, Part 6. Residency is derived, not chosen. |
| `phone` | String | **➕ from Student Registration wireframe** |
| `regNumber` | String | **➕ from wireframe** (student ID / staff ID / CNIC for admin, optional per role) |
| `profileImageUrl` | String | **➕** (My Profile / Staff Profile screens show avatars) |
| `hostelId` | ObjectId, FK → hostels | **➕ required if role=Admin or CleaningStaff** — scopes them to one branch |
| `isActive` | Boolean | default true |
| `createdAt`/`updatedAt` | Date | timestamps |

Indexes: unique on `email`; compound `{role: 1, hostelId: 1}` for admin/staff scoping queries.

### `hostels`
Same as Table 4, **plus**: `images: Array<String>`, `ratingAvg: Double` (denormalized, updated on new review), `reviewCount: Integer`, `ownerAdminId: ObjectId FK → users`.

### `rooms` — unchanged from Table 5 (schema is solid).
Index: `{hostelId: 1, isLocked: 1}` for fast availability search.

### `bookings`
Same as Table 6, **plus**: `emergencyContact: String`, `cnicFrontUrl`/`cnicBackUrl: String`, `termsAcceptedAt: Date` (all from the Booking Screen wireframe, currently unmodeled).
Index: `{roomId: 1, status: 1}` to support the `isLocked` conflict check.

### `invoices` — **➕ new collection, not in original ERD**
Represents a monthly billing cycle (the "Current Rent + Mess Fee = Outstanding" the UI shows).
| Field | Type |
|---|---|
| `_id` | ObjectId PK |
| `bookingId` | ObjectId FK → bookings |
| `billingMonth` | String (`"2026-09"`) |
| `rentAmount` | Double |
| `messFeeAmount` | Double |
| `totalDue` | Double |
| `status` | Enum[Unpaid, PartiallyPaid, Paid, Overdue] |
| `dueDate` | Date |

### `payments`
Same as Table 7, **corrected**: `invoiceId: ObjectId FK → invoices` (replaces direct `bookingId` reference — a payment settles an invoice, an invoice belongs to a booking), **plus** `paymentMethod: Enum[JazzCash, EasyPaisa, BankTransfer]` (from Rent Payments screen).
Relationship corrected: **Booking (1) — Invoice (1..\*) — Payment (0..\*)**, not the ERD's "Booking bills Exactly 1 Payment."

### `complaints` — unchanged from Table 8, plus `blockchainRef: String` (nullable, populated only when `severityTier = "Critical"`, per the Sprint 8 log's stated intent).

### `cleaning_tasks` — unchanged from Table 9 (already well-modeled).

### `notifications` — **➕ new collection**
| Field | Type |
|---|---|
| `_id` | ObjectId PK |
| `userId` | ObjectId FK → users |
| `type` | Enum[RentDue, ComplaintUpdate, BookingUpdate, TaskAssigned, Announcement] |
| `title`/`body` | String |
| `isRead` | Boolean, default false |
| `relatedEntityId` | ObjectId (polymorphic — booking/complaint/task id) |
| `createdAt` | Date |

### `chat_messages` — **➕ new collection**
| Field | Type |
|---|---|
| `_id` | ObjectId PK |
| `userId` | ObjectId FK → users |
| `sessionId` | String (groups a conversation) |
| `sender` | Enum[User, Bot] |
| `message` | String |
| `createdAt` | Date |

### `reviews` — **➕ new collection**
| Field | Type |
|---|---|
| `_id` | ObjectId PK |
| `hostelId` | ObjectId FK → hostels |
| `residentId` | ObjectId FK → users |
| `rating` | Integer (1–5) |
| `comment` | String |
| `createdAt` | Date |

### `blockchain_records` — **➕ new collection** (independent audit trail, not just a field on Payment)
| Field | Type |
|---|---|
| `_id` | ObjectId PK |
| `sourceType` | Enum[Payment, Complaint] |
| `sourceId` | ObjectId |
| `hash` | String |
| `blockRef` | String |
| `writtenAt` | Date |

---

## PART 5 — API Design (additions to Table 10, same conventions)

Everything in the original Table 10 (auth, hostels, rooms, bookings, payments, cleaning-tasks, complaints) stands as-is, **except**:
- `POST /api/payments` now takes `invoiceId` instead of `bookingId`.
- `/api/bookings` flow is authoritative: student `POST /api/bookings` (status: Pending) → admin `PATCH /api/bookings/:id/approve` (allocates room, sets Approved) → resident pays outstanding invoice → `PATCH /api/bookings/:id/checkin`.

**New endpoints:**

| Endpoint | Method | Role | Purpose |
|---|---|---|---|
| `/api/users/:id` | GET / PUT | self, Admin | profile view/update (currently missing entirely) |
| `/api/auth/refresh` | POST | any | token refresh |
| `/api/auth/forgot-password`, `/reset-password` | POST | any | password recovery |
| `/api/hostels/:id/reviews` | GET / POST | Student/Resident | review CRUD |
| `/api/invoices?bookingId=` | GET | Resident, Admin | list dues |
| `/api/invoices/generate` | POST (internal/cron) | System | monthly invoice job |
| `/api/notifications` | GET | self | inbox |
| `/api/notifications/:id/read` | PATCH | self | mark read |
| `/api/chatbot/message` | POST | any authenticated | send query, get AI response, persists to `chat_messages` |
| `/api/chatbot/history` | GET | self | past session |
| `/api/admin/dashboard` | GET | Admin | aggregated stats (rent collected, occupancy %, open complaints, staff clocked-in) — needed to power the Admin Dashboard screen |
| `/api/blockchain/:sourceType/:sourceId/verify` | GET | Resident, Admin | independent ledger lookup |

RBAC rule for all Admin-scoped routes: middleware must additionally check `req.user.hostelId === resource.hostelId` (see `hostelScope.middleware.js` in Part 3) — this doesn't exist today and is a real gap once multiple hostels are onboarded.

---

## PART 6 — Missing Things / Conflicts Summary (consolidated)

**Conflicts (documents disagree with each other):**
1. **Booking→Payment shortcut (Fig 4) vs. Approval workflow (Fig 6, class diagram status enum, API table).** Resolution: keep the Pending→Approved→Pay→CheckedIn pipeline; treat Fig 4 as an oversimplified happy-path illustration, not the literal implementation.
2. **`role: Resident` as a registration choice vs. "Resident = a Student whose booking was approved."** The SRS narrative, stakeholder table, and screen flow all describe residency as a *status*, not a signup choice (nobody registers as "Resident" — the Student Registration screen is the only registration screen for that user type). Resolution: drop `Resident` from the role enum; derive current residency from an active `CheckedIn` booking. This also simplifies RBAC (2 route-guard cases instead of a 4th role that behaves identically to Student for auth purposes).
3. **ERD "Booking bills Exactly 1 Payment" vs. recurring monthly rent shown in UI.** Resolution: Booking → many Invoices (monthly) → many Payments, as detailed in Part 4.
4. **Complaint blockchain-logging** mentioned in Abstract/Sprint log but absent from class diagram. Resolution: implement it (additive, doesn't contradict anything, just fills a stated intent).

**Missing entities:** `Invoice`, `Notification`, `ChatMessage`, `Review`, `BlockchainRecord` (dedicated collection).

**Missing fields:** `users.phone`, `users.regNumber`, `users.profileImageUrl`, `users.hostelId`; `hostels.images`, `hostels.ratingAvg`, `hostels.ownerAdminId`; `bookings.emergencyContact`, `bookings.cnicFrontUrl/cnicBackUrl`, `bookings.termsAcceptedAt`; `payments.paymentMethod`.

**Missing APIs:** user profile CRUD, password reset/token refresh, reviews, invoices, notifications, chatbot, admin dashboard aggregation, blockchain verification lookup. **(This directly answers your note — the Table 10 API list in the SDS is a demo/illustrative set, not the final API surface; it covers the six "happy path" resources but misses profile, notifications, chatbot, reviews, invoicing, and reporting, all of which are required by the SRS epics/NFRs and the wireframes.)**

**Security/scalability gaps:** no hostel-scoped RBAC (any Admin can touch any hostel's data — breaks NFR-09's multi-hostel goal); no rate limiting/refresh-token strategy mentioned anywhere; no soft-delete strategy for `DELETE /api/hostels/:id` cascading to rooms/bookings (Table 10 says it deletes "Hostel and associated rooms" but doesn't address in-flight bookings/payments referencing those rooms).

---

## PART 7 — Development Roadmap

1. Project setup (Express skeleton, MongoDB connection, env config, error-handling middleware, logger)
2. Authentication & RBAC (register/login/JWT/role+hostel-scope middleware)
3. Users (profile CRUD — currently missing, build early since most other modules depend on `req.user`)
4. Hostels (CRUD, images, reviews)
5. Rooms (CRUD, availability/lock logic)
6. Bookings (create → admin approve/reject → checkin pipeline)
7. Invoices (monthly generation job) → Payments (gateway integration, blockchain hash write)
8. Complaints (lifecycle + optional blockchain write for Critical severity)
9. Cleaning Tasks (assignment, start/complete with image upload)
10. Notifications (in-app inbox + FCM push integration)
11. Admin Dashboard (aggregation endpoints)
12. AI Chatbot integration
13. Blockchain ledger read/verify endpoints
14. Testing, hardening, deployment (Docker → ECS/Fargate per SDS §11)

---

**Note on the Figma link you shared:** I wasn't able to pull anything additional from it beyond what's already captured in the SDS's own 30 wireframes + 30 high-fidelity screens (Figma requires an authenticated session I don't have access to). If there are newer screens in Figma that post-date this PDF export, let me know and I'll fold in any differences before we start building.

Ready for your review — once you confirm or adjust the corrections in Part 6, I'll start on step 1 of the roadmap.
