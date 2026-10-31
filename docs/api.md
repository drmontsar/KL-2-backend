# KliniK API

This document lists the API endpoints and describes how each role uses them.

## Base

The server runs on port 3001 by default. Set the `PORT` environment variable to use a different port.

- Base URL: `http://localhost:3001`
- OpenAPI spec: `GET /openapi.json`
- Interactive docs: `GET /docs`

Start the server with `bun run server`.

## Operations

`GET /health` reports whether the process is running. `GET /ready` returns ready only when PostgreSQL is reachable and every local migration has been applied; otherwise it returns 503. Both endpoints are public and do not expose database credentials.

## Authentication

Call `POST /auth/request` with `phone`, then call `POST /auth/verify` with `phone` and `otp`. Only pre-registered, active staff can verify. Send the returned token on protected routes as `Authorization: Bearer <token>`. Call `DELETE /auth/session` to revoke it.

Development and test accept any non-empty OTP for a registered phone. No real OTP provider exists. Production returns HTTP 503 from `/auth/request` and `/auth/verify`. Logs exclude the phone, OTP, and session token.

## Flow

### Doctor

1. Register the patient. Use `POST /patients`. Include allergies in the request body.
2. Start an admission for the patient. Use `POST /admissions`.
3. Add diagnoses. Use `POST /admissions/{id}/diagnoses`.
4. Create orders for medication, investigations, or nursing actions. Use `POST /admissions/{id}/orders`.
5. Confirm each order. Use `POST /orders/{id}/confirm`. This creates a task for the nurse.
6. Assign the admission to a nurse. Use `POST /admissions/{id}/assign`.
7. Discharge the patient at the end of the visit. Use `POST /admissions/{id}/discharge`.
8. Resolve a diagnosis when it is no longer active. Use `POST /diagnoses/{id}/resolve`.

### Nurse

1. Get assigned admissions. Use `GET /admissions` while signed in as the nurse.
2. Write notes on an assigned admission. Use `POST /admissions/{id}/notes`.
3. View pending tasks. Use `GET /admissions/{id}/tasks?status=pending`.
4. Complete a task. Use `POST /tasks/{id}/complete`.

---

## Endpoints

### Users

| Method | Path | Action |
|--------|------|--------|
| GET | `/users` | List active staff |
| POST | `/users` | Create a staff user (admin only) |
| GET | `/users/{id}` | Get yourself or, for admins, any staff user |
| POST | `/users/{id}/disable` | Disable a staff user (admin only) |

**Roles:** `doctor`, `nurse`, `admin`

Staff creation requires a non-empty name and a phone number. A duplicate phone returns HTTP 409. Only the `administrator` job role has user-management permission.

---

### Dashboard summaries

- `GET /dashboard/ward-summary?unit_id={unitId}` returns counters for active admissions the signed-in clinician can access in the unit. Administrators see the full unit. A clinician must have unit membership or access to an active admission in that unit; otherwise the endpoint returns 403.
- `GET /admissions/{id}/header-summary` returns patient name, UHID, age, sex and allergies; bed; latest NEWS2; treating consultant and specialty; assigned doctor/nurse; payer; claim usage and limit; and actionable counts. Missing NEWS2, consultant, payer, or claim values are `null`. Monetary values are decimal strings.

Counter definitions:

- `news_critical`: latest NEWS2 ≥ 7. `news_warning`: latest NEWS2 5–6 or a single-red-parameter escalation below 7.
- `pending_orders`: confirmed orders not yet acknowledged; `stat_orders` is the STAT subset. Draft, acknowledged, completed, and discontinued orders are excluded.
- `active_shifts`: open **patient movements** (`requested`, `reserved`, `in_transit`), not staff shifts.
- `unsigned_handovers`: active patients assigned to the current doctor without a signed I-PASS item in an open session. For administrators this includes all scoped assigned patients.
- `tpa_queries`: claims in `query_raised`. Claim details and TPA counts are hidden from nurses to match the claims API; `claim_data_visible: false` indicates that zero counts or a null claim are redacted, not necessarily absent.
- `master_warnings`: unacknowledged warning alerts plus pending STAT orders. `master_cautions`: unacknowledged caution alerts plus visible TPA queries and unsigned handovers. These are counts, not separate acknowledgement records for TPA queries or handovers.

### Hospital structure and beds

| Method | Path | Action |
|--------|------|--------|
| GET | `/facilities` | List facilities |
| GET | `/departments?facility_id={id}` | List departments |
| GET | `/units?facility_id={id}` | List clinical units |
| GET | `/wards?unit_id={id}` | List wards |
| GET | `/rooms?ward_id={id}` | List rooms |
| GET | `/beds?ward_id={id}&occupancy={state}` | List beds with derived occupancy |
| PATCH | `/beds/{id}` | Change a free bed's operational state (admin only) |
| GET | `/wards/{id}/census` | Get a role-scoped ward census |

Bed occupancy is derived from active admissions. Supported occupancy filters are `available`, `occupied`, `cleaning`, and `out_of_service`. The database prevents two active admissions from occupying the same managed bed.

---

### Nursing care

- `GET/POST /admissions/{id}/nursing-assessments`: signed assessments, Morse/Braden/MUST scores, and generated care plans.
- `GET/POST /admissions/{id}/nursing-tasks` and `POST /nursing-tasks/{id}/complete`: recurring tasks and completion history. Completion requires `{ "expected_due_at": "<due_at from the task response>" }`. A retry of the same occurrence returns HTTP 409.
- `GET/POST /admissions/{id}/care-plan` and `PATCH /nursing-care-plan/{id}`: generated recommendations and manually managed care-plan items with revision checks.
- `POST /admissions/{id}/weights` and `GET/POST /admissions/{id}/fluid-entries`: measured weight, intake/output, balance, and a two-hour urine-output indicator. The indicator reports `insufficient_data` when a recent weight or either hourly urine measurement is missing. Recording a weight or urine output that establishes low output creates a persistent alert and notifies the assigned doctor; staff must explicitly resolve the alert.
- `POST /admissions/{id}/sbar-calls`, `GET /sbar-calls`, and `/sbar-calls/{id}/acknowledge` or `/close`: nurse-to-doctor SBAR calls.

### Medication administration

A confirmed medication order must contain `drug`, `dose`, and `route` in its payload. A doctor can create its schedule at `POST /orders/{id}/medication-schedule`, record a reasoned allergy review at `/medication-schedules/{id}/allergy-review`, and create due doses at `/medication-schedules/{id}/doses`. The MAR is available at `GET /admissions/{id}/mar`.

Nurses can give or hold scheduled doses at `/medication-doses/{id}/give` and `/hold`; `/missed` records a due dose as missed with a reason. Giving requires the scanned UHID, matching drug/dose/route, explicit time/allergy checks, an active order, and a current clinician allergy review. PRN orders must include `prn_indication`, `prn_min_interval_minutes`, and `prn_max_doses_24h` in both the prescription and schedule. Nurses prepare a PRN dose at `/medication-schedules/{id}/prn-doses` and provide `administration_reason` when giving it. The backend serializes administration and enforces the prescriber's per-schedule minimum interval and 24-hour maximum. Exact matches against recorded drug, generic, or class allergies are blocked. Held doses notify the assigned doctor. Infusion start, rate-change, and stop events are at `GET/POST /medication-schedules/{id}/infusions`.

**Clinical limitation:** `GET /medication-catalog` exposes a small, explicitly synthetic catalogue and synthetic cross-reactivity groups for demos only. It is not a validated medication catalogue or clinical cross-reactivity database. Clinician review and these checks do not establish that a medication is safe. PRN limits apply per schedule, not across separate prescriptions or equivalent ingredients. Do not use this implementation clinically until a validated medication catalogue, cross-reactivity data, cross-order limits, and clinical rules are approved.

### OPD prototype

`POST /opd/check-ins` queues an existing patient by `patient_id` or atomically registers and queues a new patient using `patient` details (including date of birth). `GET /opd/queue` and `GET /opd/visits/{id}` expose visits; `PATCH /opd/visits/{id}/triage` and `/draft` record vitals and notes. Synthetic diagnosis/investigation catalogues are at `GET /opd/diagnoses` and `/opd/investigations`; add selections with `/opd/visits/{id}/diagnoses` and `/investigations`. Add or remove demo prescriptions under `/opd/visits/{id}/prescriptions`; a synthetic allergy conflict requires a recorded override reason. `POST /opd/visits/{id}/close` signs the visit, calculates synthetic INR charges, and creates demo pharmacy/collection dispatches for selected prescriptions/investigations. `GET /opd/dispatches` and `POST /opd/dispatches/{id}/complete` operate these manual demo queues; they do not communicate with external systems. A signed visit with `follow_up: "admit"` can be handed to intake using `POST /opd/visits/{id}/admission-request` with a destination unit and diagnosis. Real ICD-10, paediatric dosing, and external pharmacy/lab integration remain unavailable.

### Forms prototype

`GET/POST /forms/templates` lists or creates synthetic templates. `POST /forms/instances` creates a patient form and snapshots known fields; retrieve patient forms at `/forms/patients/{id}/instances`, version history at `/forms/instances/{id}/versions`, and version/signatures at `/forms/versions/{id}`. Drafts can be saved, signatures captured, finalized, and copied to a new version with signatures cleared. The built-in templates and signatures are **demo-only and not legal consent or clinical documents**. Consultant signature requests, correction routing, and document rendering/storage remain unavailable.

### Claims and deposits

`GET/POST /claims` lists or creates manual demo claims for an admission's coverage. `GET /claims/{id}` returns claim, query, and event history. `POST /claims/{id}/actions` uses `expected_revision` and supports pre-authorisation, questions/replies, approval, enhancement requests, and cost updates. Monetary values are decimal strings with an explicit currency. `POST /claims/deposits` records a manual demo deposit and rejects duplicate admission/reference pairs.

These actions do not contact an insurer or process payments. Discharge billing requires an approved staged discharge plan and completion of the summary, pending-results, medication-reconciliation, and nursing tasks.

### Admission intake and patient movement

`POST /admission-requests` records emergency, OPD, elective, or external requests for an existing patient; `GET /admission-requests` lists requests in scope. Accept or decline using `/admission-requests/{id}/accept` or `/decline`. Acceptance requires an available managed bed, consultant, and duty doctor, and creates a first-hours checklist. `POST /admissions/{id}/take-nursing-assignment` lets a nurse assigned to the unit take an unassigned bed. The checklist is at `/admissions/{id}/admission-checklist`.

`POST /patient-movements` requests a permanent or temporary move. Permanent moves require `/patient-movements/{id}/reserve` by bed desk/admin; `/depart`, `/arrive`, `/return`, and `/cancel` perform state transitions. Reservations block other bed assignments, temporary moves retain the source bed, and NEWS2 ≥ 5 requires a nurse or doctor escort. A current NEWS2 assessment is required before movement.

### Staged discharge

`POST /discharge-plans` creates a home, referral, or LAMA plan. The treating consultant approves it at `/discharge-plans/{id}/approve`; a clinician signs the summary at `/summary`, and assigned staff complete checklist tasks at `/discharge-plans/tasks/{id}/complete`. `POST /discharge-plans/{id}/complete` checks approval, checklist, NEWS2, forms, insurance, and active movement before marking the patient discharged and the bed for cleaning. `GET /discharge-plans/{id}` returns the plan and tasks.

Routine home, referral, and LAMA discharges must use the staged workflow; the legacy `/admissions/{id}/discharge` endpoint returns 409 for those exit types. Explicit `died` and `transfer_team` exits remain available as exceptional legacy workflows, and are blocked while a staged plan or movement is open. Forms and claims are demo-only and not legally or clinically validated.

### Shift handovers

Doctor I-PASS sessions use `POST /ipass`, `GET /ipass`, and `GET /ipass/{id}`. The outgoing doctor edits and signs each item at `/ipass/items/{id}`, `/sign`, then sends the session with `/ipass/{id}/send`. Participants can post and retrieve `/ipass/items/{id}/questions`; the receiver accepts each item at `/ipass/items/{id}/accept`, with read-back required for watcher/unstable patients. A sent item can be refreshed by the outgoing doctor, and pending items can be cancelled without undoing accepted transfers.

Nurse bedside handovers use the equivalent `/nurse-handover` session endpoints. Snapshots include observations, assessment, orders, medicines, infusion events, tasks, and fluid balance. Receiving nurses must submit the complete bedside checklist to `/nurse-handover/items/{id}/accept`; discrepancies can be recorded. Questions and cancellation are supported.

**Limitation:** stale detection does not yet cover every type of chart change, and nurse snapshots are not automatically refreshed. These handover workflows require further concurrency and clinical-safety validation.

### Consultant rounds

`GET /consultant-rounds/worklist` returns the consultant's assigned patients, prioritised by whether they have been seen today and their NEWS2 score. `GET /consultant-rounds/{id}/context` returns observations, notes, and orders for an assigned admission. `POST /consultant-rounds` signs a SOAP note and optional orders in one transaction; orders retain their round provenance. Assessment and plan are required.

### Consultant care transfer

`POST /consultant-care-transfers` requests a treating-consultant change using `admission_id`, `to_consultant_id`, `reason`, `discussed_with_current: true`, and `patient_family_informed: true`. The current consultant releases the request using `POST /consultant-care-transfers/{id}/release`; the receiving consultant then uses `/accept` or `/decline` (with a reason). The requester or current consultant can `/withdraw` a pending request. `GET /consultant-care-transfers` lists requests involving the current clinician. Acceptance changes the treating-consultant assignment, not the duty doctor or bed, and notifies billing staff for patients with coverage.

### Cross-referrals

`GET /cross-referrals` lists referrals visible to the current doctor. `POST /cross-referrals` sends a referral with an admission, consultant, specialty, urgency, question, and findings. The referred consultant may mark it seen and submit an opinion via `/cross-referrals/{id}/seen` and `/cross-referrals/{id}/opinion`. The opinion is signed into the patient notes; a doctor can create a draft order with provenance via `/cross-referrals/{id}/orders`. Use `/acknowledge`, `/close`, or `/withdraw` for the corresponding transitions. Referred consultants have admission access while the referral is open.

### Patients

| Method | Path | Action |
|--------|------|--------|
| GET | `/patients` | List patients in the signed-in user's scope |
| POST | `/patients` | Register a patient (doctor/admin only) |
| GET | `/patients/{id}` | Get one patient |
| PATCH | `/patients/{id}` | Update a patient |
| GET | `/patients/{id}/admissions` | List the patient's admissions visible to the current staff member |
| GET | `/patients/{id}/diagnoses` | List diagnoses for a patient |

Allergies are stored on the patient record as a JSON array. Send them in the `POST /patients` or `PATCH /patients/{id}` body under the `allergies` field.

```json
"allergies": [
  { "allergen": "Penicillin", "reaction": "rash", "severity": "mild" }
]
```

---

### Admissions

An admission is one hospital stay for a patient. Send `bed_id` when assigning a managed bed; the backend derives `ward` and `bed` and returns `409` if the bed is unavailable. Legacy ward/bed labels must resolve to exactly one managed bed. Changing a managed bed marks the vacated bed for cleaning.

| Method | Path | Action |
|--------|------|--------|
| GET | `/admissions` | List active admissions |
| POST | `/admissions` | Start an admission |
| GET | `/admissions/{id}` | Get one admission |
| PATCH | `/admissions/{id}` | Update admission details; bed changes use `/bed-assignments` |
| POST | `/admissions/{id}/assign` | Assign the admission to a nurse |
| POST | `/admissions/{id}/discharge` | Discharge the patient |
| POST | `/admissions/{id}/diagnoses` | Add a diagnosis to the admission |
| GET | `/admissions/{id}/notes` | List notes on the admission |
| POST | `/admissions/{id}/notes` | Write a note |
| GET | `/admissions/{id}/orders` | List orders |
| POST | `/admissions/{id}/orders` | Create an order |
| GET | `/admissions/{id}/tasks` | List tasks |
| POST | `/admissions/{id}/bed-assignments` | Administratively assign an available bed (admin only; sends `bed_id` and `expected_revision`) |
| GET | `/admissions/{id}/bed-history` | List bed assignment history |
| GET | `/admissions/{id}/observations` | List observation sets and NEWS2 trend |
| POST | `/admissions/{id}/observations` | Record a complete observation set and calculate NEWS2 |
| GET | `/admissions/{id}/alerts` | List clinical alerts |
| POST | `/admissions/{id}/alerts/{alertId}/acknowledge` | Acknowledge an active clinical alert |

### Observations and NEWS2

`POST /admissions/{id}/observations` requires respiratory rate, SpO₂, supplemental-oxygen status, temperature, systolic blood pressure, heart rate, and consciousness. The authenticated user is recorded as the author. The backend calculates NEWS2 using NEWS2 2017 Scale 1 and returns the total, component scores, escalation level, and rule version.

A caution or warning is created for every result above low escalation. Filter alerts with `?status=active` or `?status=acknowledged`. The older `/vitals` endpoints remain available for partial measurements but do not calculate NEWS2. Both endpoints reject inactive admissions. `PATCH /admissions/{id}/observation-schedule` requires a current NEWS2 observation and cannot set an interval longer than the configured escalation frequency or postpone an earlier due time. The scoring and frequency policy remain subject to hospital clinical validation.

**Query filters for `GET /admissions`:**

| Parameter | Effect |
|-----------|--------|
| `ward` | Show only admissions in this ward |
| `scope=mine` | Show admissions assigned to the signed-in doctor; nurse lists are always restricted to the signed-in nurse |
| `scope=open` | Show unclaimed admissions in a unit with current membership and an active shift |

`POST /admissions/{id}/claim` applies the same unit and active-shift restrictions. A doctor cannot acquire access through an arbitrary admission ID. Clinical content changes also advance the admission revision. Retrieve the latest revision before a revision-sensitive update.

---

### Notes

The backend derives `created_by`, `confirmed_by`, `completed_by`, `requested_by`, and similar actor fields from the authenticated session; clients must not supply them.

Order sets are available at `GET /order-sets`. Administrators can create templates at `POST /order-sets`; doctors can create draft orders from selected template items at `POST /order-sets/{id}/apply` using `admission_id` and `item_ids`. The generated orders retain the originating item ID. Supply an `Idempotency-Key` header (1–128 characters); retries using the same key and request return the original orders, while reuse with a different request returns 409.

Order creation accepts optional `priority` (`routine`, `urgent`, or `stat`; defaults to `routine`). Confirming an order atomically creates its task and audit entry; a repeated confirmation returns 404. Orders created with `requires_approval: true` remain unconfirmable until a consultant records a decision using `POST /orders/{id}/approval/approved` or `/approval/rejected` with a reason. Automatic mandatory approval policies are not yet implemented. Nurses can acknowledge confirmed orders. Doctors can complete orders once pending tasks are resolved or discontinue them with a reason; discontinuation cancels pending tasks.

`GET /worklists/me` returns scoped due observations, pending tasks, draft orders, and active alerts, ordered by priority. It does not yet include every artifact worklist or reliable notification replay. Notifications can be acknowledged with `POST /notifications/{id}/acknowledge` and closed with `POST /notifications/{id}/close`.

`GET /events` requires a Bearer token and streams that user's notifications as Server-Sent Events. It sends a `ping` heartbeat every 25 seconds. Bun's idle timeout is disabled only for this streaming request; ordinary HTTP requests retain their normal timeout. Disconnecting releases the PostgreSQL listener. Any reverse proxy must allow idle intervals longer than the heartbeat interval.

A note starts as a draft. Both draft-update routes require `draft_body` and `expected_revision`. Use the revision from the latest note response. A stale revision returns HTTP 409. The alternate route is `PATCH /admissions/{id}/notes/{noteId}`.

Confirmation creates an immutable version. Concurrent confirmations receive distinct version numbers. Add an amendment to correct a confirmed version. A note edit invalidates a handover snapshot that contains the older clinical state.

| Method | Path | Action |
|--------|------|--------|
| PATCH | `/notes/{id}/draft` | Update the draft body |
| POST | `/notes/{id}/confirm` | Confirm the note and create a version |
| GET | `/notes/{id}/versions` | List all versions |
| POST | `/notes/{id}/versions/{versionId}/amendments` | Add an amendment to a confirmed version |

---

### Orders and Tasks

The doctor creates an order in `draft` state. Confirmation changes its status to `confirmed` and creates one task for the nurse. These writes share one transaction. Creation and confirmation require an active admission. Historical access does not authorize new orders after discharge.

| Method | Path | Action |
|--------|------|--------|
| POST | `/orders/{id}/confirm` | Confirm the order and create its task |
| POST | `/orders/{id}/cancel` | Cancel a draft order |
| POST | `/tasks/{id}/complete` | Mark the task as done |
| POST | `/tasks/{id}/cancel` | Cancel a pending task |

**Order kinds:** `medication`, `investigation`, `nursing`

The `payload` field is a free-form JSON object. Its structure depends on the order kind. Example for a medication order:

```json
{
  "kind": "medication",
  "payload": { "drug": "Paracetamol", "dose": "500mg", "frequency": "TID" }
}
```

**Task status values:** `pending`, `done`, `cancelled`

---

### Diagnoses

| Method | Path | Action |
|--------|------|--------|
| POST | `/diagnoses/{id}/resolve` | Mark a diagnosis as resolved |

To list diagnoses, use `GET /patients/{id}/diagnoses`. Pass `?status=active` or `?status=resolved` to filter.
