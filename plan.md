# KliniK Backend Implementation Plan

This plan converts the functionality in `/Users/tarun/Downloads/KliniK Hospital App.html` into a production backend. The artifact is the product reference; clinical rules must still be validated by hospital stakeholders before release.

## 1. Current baseline

The repository already provides a Bun/Hono/PostgreSQL API with OpenAPI schemas and migrations for:

- OTP-style sessions and doctor/nurse users
- Patients, allergies, admissions, diagnoses, notes, note versions, and amendments
- Orders and generated nursing tasks
- Vitals, contingencies, shift events, notifications, and audit records
- Nurse handoffs and doctor handover sessions
- Doctor roster/presence, analytics, and transfer-of-care requests

Before adding more domains, reconcile the implementation and documentation:

- `docs/api.md` still says authentication is not implemented, but all non-auth routes require a session.
- OTP verification is currently a development stub and accepts any value.
- CORS is unrestricted.
- Roles are limited to `doctor` and `nurse`; the artifact requires finer permissions.
- There is no automated test command or production-grade migration rollback/backup procedure.

## 2. Delivery principles

1. Keep PostgreSQL as the source of truth; do not reproduce the artifact's in-memory state or timer-based simulations.
2. Implement workflows as explicit state transitions, not unrestricted record updates.
3. Perform every state transition and its audit/notification writes in one database transaction.
4. Preserve signed clinical records. Corrections create amendments or new versions.
5. Enforce authorization and patient/unit scope in database queries, not only in the frontend.
6. Store timestamps in UTC and retain author, role, source, and reason for clinical changes.
7. Use idempotency keys for actions that can be retried, especially order signing, medication administration, transfers, and discharge.
8. Add optimistic concurrency/version fields to records edited by multiple staff members.
9. Treat NEWS2, dose calculations, allergy checks, and discharge gates as versioned clinical rules with tests.
10. Do not log OTPs, tokens, patient details, note bodies, or other sensitive health information.

## 3. Roles and authorization

Replace broad role checks with permissions and assignment scope.

### Required roles

- Duty doctor
- Consultant
- Staff nurse
- Pharmacist
- Billing/insurance staff
- Bed desk/admission staff
- Administrator

### Required scope

- Facility and unit membership
- Active shift and assigned units
- Treating-consultant relationship
- Assigned beds/patients
- Temporary coverage/delegation
- Emergency break-glass access with reason and audit event

### Initial permission groups

- Read/write clinical record
- Sign notes and orders
- Approve restricted orders
- Administer medication
- Manage beds and movements
- Manage forms and signatures
- Manage claims and billing checkpoints
- Approve discharge
- Manage staff and reference data

## 4. Phased roadmap

### Phase 0 — Stabilize the existing backend

- Update `README.md`, `docs/api.md`, and OpenAPI metadata to match current behavior.
- Add integration tests against an isolated PostgreSQL database for every existing route.
- Add common API error responses, request IDs, pagination, filtering, and consistent timestamps.
- Replace fake OTP verification with stored, expiring, single-use challenges and an SMS provider adapter.
- Hash any password credentials; rotate and expire sessions; add rate limits to authentication endpoints.
- Restrict CORS by environment.
- Enforce role and record-level access on every current query.
- Redact sensitive values from logs and define retention rules for sessions and audit records.
- Add health/readiness endpoints and migration checks.

**Exit criteria:** existing doctor/nurse flows pass integration tests; unauthorized cross-user and cross-unit access is rejected; API docs are accurate.

### Phase 1 — Hospital structure, staff shifts, and patient identity

Add:

- Facilities, departments, units, wards, rooms, beds, and bed status
- Staff specialties, unit membership, rosters, shifts, presence, and temporary coverage
- Patient identifiers: UHID, ABHA, phone, address, blood group, next of kin, payer, and policy
- Duplicate-patient detection and merge workflow with an audit trail
- Bed assignment history instead of overwriting a bed string
- Global patient search with role/unit filtering

Core APIs:

- `/facilities`, `/units`, `/beds`
- `/staff`, `/rosters`, `/shifts`, `/presence`
- `/patients/search`, `/patients/{id}/identifiers`, `/patients/{id}/contacts`
- `/admissions/{id}/bed-assignments`

**Exit criteria:** the backend can produce the role-scoped census, free/vacating bed view, staff roster, and patient search used by the artifact.

### Phase 2 — Clinical record and ward monitoring

Extend the current clinical model with:

- Structured observation sets: respiratory rate, SpO2, oxygen support, temperature, systolic BP, heart rate, consciousness/GCS, and recorded time
- Server-calculated NEWS2 score, component scores, rule version, trend, and escalation level
- Acknowledgable warning/caution alerts
- Typed note templates: initial assessment, progress, event, procedure, consultant round, nursing, and referral opinion
- Signed note snapshots, amendments, and hospital-day timeline
- Structured order categories, priority, approval rules, acknowledgement, completion, and discontinuation
- Clinical event feed for a patient/admission

Core APIs:

- `/admissions/{id}/observations`
- `/admissions/{id}/news2`
- `/admissions/{id}/alerts` and `/alerts/{id}/acknowledge`
- `/admissions/{id}/notes`
- `/admissions/{id}/timeline`
- `/admissions/{id}/orders` and explicit sign/approve/acknowledge/complete/discontinue actions

**Safety tests:** NEWS2 boundary values, oxygen scoring, missing observations, stale observations, concurrent acknowledgements, signed-note immutability, and order transition conflicts.

### Phase 3 — Worklists, notifications, and realtime updates

- Build server-side worklist queries for each role.
- Derive work items from clinical state instead of storing duplicate dashboard counters.
- Add due/overdue calculations for observations, medications, tasks, reviews, signatures, and handovers.
- Deliver realtime notifications with Server-Sent Events or WebSockets; keep database notifications as the durable inbox.
- Add read/acknowledged/closed notification states and user notification preferences.

Core APIs:

- `/worklists/me`
- `/dashboard/census`
- `/notifications` and `/notifications/stream`
- `/admissions/{id}/due-items`

**Exit criteria:** home dashboards and badges can be rendered entirely from backend responses without frontend simulations.

### Phase 4 — Handover and responsibility transfer

Complete both handover workflows.

#### Doctor-to-doctor

- I-PASS severity, summary, action list, contingency, questions, and receiver synthesis
- Draft/sign/send states
- Per-patient acknowledgement
- Mandatory read-back for unstable/watch patients
- Atomic responsibility transfer after acknowledgement
- Staleness detection when the chart changes after preparation
- Off-shift completion only after all required acknowledgements

#### Nurse-to-nurse

- SBAR snapshot
- Bedside safety checklist
- Questions and discrepancy reporting
- Per-patient acceptance and assignment transfer
- Off-shift completion gate

**Exit criteria:** a patient always has one accountable doctor/nurse assignment during handover; interrupted and repeated requests cannot duplicate transfers.

### Phase 5 — Admissions and movements

#### Admission intake

- Sources: emergency, OPD, elective, and external-hospital transfer
- Admission requests with accept/decline reason
- Consultant, unit, and bed allocation
- First-hours checklist and order sets
- Unit arrival and bedside-nurse assignment

#### Patient movement

- Permanent bed/unit moves with destination, reason, escort, equipment, reservation, departure, and arrival
- Temporary procedure-area moves while retaining the bed
- Porter requests
- NEWS2-based escort validation
- Cancellation and movement history

Keep these separate from transfer of clinical responsibility.

Core APIs:

- `/admission-requests`
- `/admissions/{id}/checklist`
- `/order-sets`
- `/movement-requests`
- `/temporary-movements`
- `/porter-requests`

### Phase 6 — OPD

- Patient self-check-in and token generation
- Waiting/seen queue and triage observations
- Consultation drafts and signed visit closure
- ICD-10 diagnosis search through managed reference data
- Prescription items and stock availability
- Investigation requests
- Follow-up plan or conversion to admission
- Charge calculation and routing to pharmacy/collection

Safety requirements:

- Structured allergy and interaction checking
- Logged override reason
- Paediatric weight-based dose calculation with formula/rule version
- Signed prescription immutability

Core APIs:

- `/opd/check-ins`, `/opd/queue`, `/opd/visits`
- `/reference/diagnoses`, `/reference/medications`
- `/opd/visits/{id}/prescriptions`
- `/opd/visits/{id}/close`

### Phase 7 — Referrals, consultant rounds, and transfer of care

- Cross-referral request with specialty, consultant, urgency, clinical question, and findings snapshot
- Prevent duplicate open referrals to the same specialty/consultant
- Seen/opinion/acknowledged/closed/withdrawn transitions
- Convert consultant recommendations into draft orders with provenance
- Consultant ward-round queue and signed SOAP notes
- Transfer-of-care request, current-consultant release, receiving-consultant accept/decline, and family-notified evidence

Core APIs:

- `/referrals`
- `/referrals/{id}/opinion`
- `/referrals/{id}/acknowledge`
- `/consultant/worklist`
- `/transfer-requests`

### Phase 8 — Forms and signatures

- Versioned form templates, sections, fields, validation, and role visibility
- Built-in consent, insurance, checklist, referral, LAMA/DAMA, certificate, and medico-legal templates
- Custom template builder
- Patient-record autofill with explicit source/version
- Draft instances and signature requests
- Doctor, consultant, patient/guardian, and witness signatures
- Finalized immutable document versions
- Return-for-correction and new-version workflows
- Rendered PDF/document storage with checksum and retention metadata

Core APIs:

- `/form-templates`
- `/admissions/{id}/forms`
- `/forms/{id}/signature-requests`
- `/forms/{id}/finalize`
- `/forms/{id}/versions`

Do not treat a typed name as a legally sufficient e-signature until legal/compliance requirements are approved.

### Phase 9 — Nursing workflows and medication administration

- Nurse bed assignments and nursing worklist
- Initial/reassessment forms for pain, lines/drains, Morse, Braden, and MUST
- Rule-generated care plans and recurring tasks
- Medication Administration Record (MAR)
- Wristband verification and five-rights confirmation
- Given/held/missed/PRN records and mandatory hold reason
- Infusion start, rate change, stop, and history
- Hourly intake/output and fluid-balance totals
- Low urine-output alert using recorded weight
- Nursing notes and SBAR calls to duty doctors

Core APIs:

- `/nursing/assignments`
- `/admissions/{id}/nursing-assessments`
- `/admissions/{id}/care-plan`
- `/admissions/{id}/mar`
- `/medication-administrations`
- `/infusions`
- `/admissions/{id}/intake-output`
- `/clinical-calls`

**Safety tests:** duplicate administration, wrong patient, allergy conflict, early/late dose window, concurrent holds, infusion transitions, risk-score boundaries, and low-output calculations.

### Phase 10 — Discharge

Implement a discharge plan and independent parallel task tracks:

- Types: home, referral, and LAMA/DAMA
- Consultant approval
- Planned date/time and condition at discharge
- Summary assembly, editing, signing, and consultant approval
- Pending-result ownership
- Medication reconciliation and pharmacy return
- Nursing discharge checklist and discharge observations
- Billing, insurance final approval, and patient payment checkpoints
- Patient-left confirmation, bed release, and housekeeping status

Safety gates:

- Block home discharge at NEWS2 >= 5 unless an approved policy defines an override.
- Require referral/LAMA documentation for those discharge types.
- Do not close billing while unmanaged results remain.
- Preserve the admission and all signed records after discharge.

Core APIs:

- `/admissions/{id}/discharge-plan`
- `/discharge-plans/{id}/tasks`
- `/discharge-plans/{id}/summary`
- `/discharge-plans/{id}/approve`
- `/discharge-plans/{id}/complete`

### Phase 11 — Claims, insurance, and billing checkpoints

- Patient payer and policy records
- Pre-authorization, query, response, approval, enhancement, final approval, and discharge-billed states
- Approved limit, estimate, and current utilization
- Supporting-document links and insurer communication history
- Self-pay deposits and OPD charge summaries
- ICU/level-of-care enhancement triggers

Core APIs:

- `/claims`
- `/claims/{id}/preauthorize`
- `/claims/{id}/queries`
- `/claims/{id}/enhancements`
- `/claims/{id}/approve`
- `/billing/admissions/{id}/status`

Financial values must use fixed-precision decimal columns and an explicit currency.

### Phase 12 — Production integrations and operations

- SMS OTP provider
- Pharmacy inventory and dispensing
- LIS/RIS/PACS investigation status and results
- Billing/ERP and insurer/TPA systems
- ABHA/health-identity integration, if required
- Object storage and malware scanning for documents
- FHIR/HL7 mapping where interoperability is required
- Backups, point-in-time recovery, restore drills, monitoring, alerting, and incident runbooks
- Data retention, consent, access-reporting, and breach-response policies

## 5. Suggested domain tables

Add tables incrementally with each phase rather than in one migration:

- `organization.facilities`, `units`, `beds`, `staff_units`, `rosters`, `shifts`
- `clinical.patient_identifiers`, `contacts`, `next_of_kin`, `coverage`
- `clinical.bed_assignments`, `admission_requests`, `admission_checklist_items`
- `clinical.observation_sets`, `news2_assessments`, `clinical_alerts`
- `clinical.order_approvals`, `order_acknowledgments`, `order_sets`
- `clinical.referrals`, `referral_opinions`
- `clinical.movement_requests`, `movement_events`, `porter_requests`
- `clinical.nursing_assessments`, `care_plan_items`, `intake_output`
- `clinical.medication_schedules`, `medication_administrations`, `infusion_events`
- `clinical.clinical_calls`
- `clinical.discharge_plans`, `discharge_tasks`, `discharge_summaries`
- `forms.templates`, `template_versions`, `instances`, `instance_versions`, `signatures`
- `opd.check_ins`, `visits`, `queue_events`, `prescriptions`, `investigation_requests`
- `finance.claims`, `claim_events`, `claim_queries`, `deposits`, `charge_summaries`

Use append-only event/history tables where the artifact displays a timeline. Avoid JSON for fields that must be filtered, validated, reported, or used in safety rules; JSON is acceptable for immutable snapshots and external payloads.

## 6. Cross-cutting acceptance criteria

Every phase is complete only when it includes:

- SQL migration and forward migration test
- Query/service implementation with transactions
- OpenAPI route and request/response validation
- Authorization tests, including denied cross-unit access
- Happy-path, validation, conflict, and retry/idempotency tests
- Audit event for clinical and administrative state changes
- Notification where another role must act
- Updated seed data and API documentation
- No patient-sensitive values in application logs
- Load checks for census, worklists, timelines, and search

## 7. Artifact-alignment implementation backlog

The following 16 workstreams capture the new backend capabilities required to align the current implementation with the artifact. They are implementation items, not presentation work.

**Implementation status:** Items 0–3 have initial implementation and baseline coverage. Items 4 and 5 have initial implementation but still require full review and regression coverage before they can be considered complete. Migration `012_news2_observations.sql` adds complete observation metadata, server-calculated NEWS2 Scale 1 scores, clinical alerts, alert acknowledgement, secured observation endpoints, and scoring tests. The API baseline now derives actor identity from sessions, scopes patient and admission access, protects notifications/events, restricts administrative actions and CORS, redacts sensitive logs, and has Docker-backed security integration tests. Migration `013_hospital_structure.sql` adds facilities, departments, units, wards, rooms, managed beds, legacy admission backfill, unique active occupancy, bed-state APIs, and role-scoped census APIs. Migration `014_staff_scope_and_shifts.sql` adds detailed job roles, permission checks, unit memberships, non-overlapping shifts, shift-unit scope, clinical staff assignments, temporary coverage, and audited break-glass access. Migration `015_patient_identity_and_bed_history.sql` adds UHIDs, structured identifiers and contacts, next of kin, coverage, duplicate detection support, scoped search, and bed-assignment history. Migration `016_observation_scheduling.sql` adds policy/manual schedules, due state, latest NEWS2 projections, and alert resolution/supersession. Realtime escalation remains part of Item 7.

1. **Hospital structure and access control**
   - Add facilities, departments, units, wards, rooms, beds, occupancy history, staff-unit memberships, shifts, scoped permissions, and audited break-glass access.
2. **Clinical observations and NEWS2**
   - Store complete observation sets and calculate versioned NEWS2 scores, trends, escalation levels, warnings, acknowledgements, and due times on the server.
3. **Structured order lifecycle**
   - Add typed categories, priorities, explicit workflow states, consultant approval, nurse/lab acknowledgement, order sets, provenance, and idempotent signing.
4. **Role-based worklists and realtime notifications**
   - Derive duty-doctor, consultant, nursing, admissions, and billing queues from current state and stream durable notifications with read/acknowledged/closed states.
5. **Complete doctor and nurse handover**
   - Implement I-PASS and SBAR, mandatory safety/read-back checks, questions, discrepancies, per-patient acceptance, stale-data detection, and atomic responsibility transfer.
6. **Admission and bed-management workflow**
   - Add admission requests, source-specific intake, accept/decline, bed reservation, unit arrival, bedside assignment, first-hours checklist, order sets, consent, and payer status.
7. **Patient movement**
   - Add permanent and temporary moves, destination acceptance, retained beds, porter requests, escorts/equipment, safety validation, and departure/arrival/return history.
8. **Consultant workflows**
   - Add consultant worklists, ward rounds, SOAP notes, round orders, transfer acceptance/release, assessment review, restricted approvals, discharge approval, and signatures.
9. **Cross-referrals**
   - Add specialty referrals, urgency, clinical questions, status transitions, duplicate prevention, opinions, acknowledgement, and recommendation-to-order conversion.
10. **Nursing clinical workflows**
    - Add nurse assignments, initial/reassessments, Morse/Braden/MUST/pain scores, lines and drains, generated care plans, recurring tasks, intake/output, SBAR calls, and nursing notes.
11. **Medication Administration Record**
    - Add medication schedules, administration states, wristband and five-rights checks, allergy checks, held-dose reasons, infusions, immutable history, and duplicate-dose prevention.
12. **OPD**
    - Add check-in, tokens, queues, triage, consultations, ICD-10 search, prescriptions, investigations, stock status, allergy overrides, paediatric dosing, follow-up, admission conversion, and charges.
13. **Forms and signatures**
    - Add versioned templates and instances, autofill, validation, signature requests, patient/witness signatures, correction flow, immutable final versions, document rendering/storage, and custom templates.
14. **Discharge workflow**
    - Replace direct closure with discharge plans, approval, discharge types, parallel medical/nursing/billing tasks, summaries, pending-result ownership, reconciliation, safety gates, and bed release.
15. **Claims, insurance, and billing checkpoints**
    - Add policies, pre-authorisation, queries, approval limits, utilisation, enhancements, final approval, discharge billing, deposits, documents, and communication history.
16. **Production readiness**
    - Add real OTP verification, rate limits, restricted CORS, session controls, integration/authorization/clinical-rule tests, idempotency, concurrency control, transactions, log redaction, backups, health checks, and retention policies.

### Sequential execution queue

Implement the artifact's remaining backend functionality in priority order. Leave the current dummy authentication unchanged; authentication hardening, gap audits, and production security strengthening are deferred by the user. Run applicable feature tests as implementation proceeds. The integration suite uses an isolated temporary PostgreSQL instance. Only manipulate the KL-2 backend database and server. Clinical and legal validation remains required before production.

Status definitions: `NOT_STARTED` means work has not begun; `IN_PROGRESS` means implementation or verification remains; `BLOCKED` means an external dependency or decision is unavailable; `COMPLETED` means the full listed implementation and applicable verification are complete. A checked item is not evidence of production readiness.

#### Priority order

- [ ] **0. Complete observations and NEWS2 foundation** — IN_PROGRESS: added boundary tests, validated observation inputs, active-admission serialization, deterministic equal-timestamp ordering, and concurrent-alert regression coverage. Hospital clinical-policy validation and any required Scale 2 behavior remain.
  - Delivered complete observation input, NEWS2 Scale 1 calculation, component scores, alerts, acknowledgement, access checks, audit writes, migration coverage, and API smoke tests.
  - Remaining observation scheduling and realtime delivery are intentionally assigned to Items 5 and 7.

- [ ] **1. Secure and test the existing API baseline** — BLOCKED/DEFERRED: user explicitly requested dummy authentication remain unchanged and security strengthening be done later.
  - Add reusable API/database integration-test setup.
  - Test every existing protected route for missing, invalid, and cross-user access.
  - Remove caller-supplied actor IDs, enforce admission scope consistently, restrict CORS, redact sensitive logs, and document the current development-only OTP limitation.
  - **Exit gate:** all current routes have happy-path and denied-access coverage; no protected patient data is available without the correct scope.

- [ ] **2. Hospital structure and bed topology** — IN_PROGRESS: hierarchy, reservation and occupancy protections, unknown-bed rejection, cleaning on bed changes, and concurrent-reservation regression coverage exist. Remaining migration and allocation edge cases need verification.
  - Add facilities, departments, units, wards, rooms, beds, bed states, and seed records.
  - Backfill existing admission ward/bed strings without breaking current clients, then expose scoped census and free/vacating-bed APIs.
  - **Exit gate:** bed occupancy cannot overlap; census and bed availability match seeded assignments.

- [ ] **3. Roles, permissions, shifts, and assignments** — IN_PROGRESS: role model and assignments exist; shared admission scope now covers census and patient access, primary assignments are synchronized, and unit-revocation/cross-unit regression cases pass. The complete role/unit matrix remains to be verified.
  - Add duty doctor, consultant, staff nurse, pharmacist, billing/insurance, bed-desk, and administrator capabilities.
  - Add staff-unit memberships, rosters, active shifts, temporary coverage, patient/bed assignments, and audited break-glass access.
  - **Exit gate:** role/unit matrix tests prove allowed access and reject every cross-unit operation.

- [ ] **4. Patient identity and admission foundation** — IN_PROGRESS: shared patient scope, unit-scoped search and duplicate detection, scoped admission history, demographic and coverage-date validation, serialized primary identity updates, and one ABHA per patient are implemented and regression-tested. Remaining identity and migration edge cases need review.
  - Add UHID/ABHA identifiers, contacts, address, blood group, next of kin, payer/policy records, duplicate detection, and bed-assignment history.
  - Add role-scoped global patient search.
  - **Exit gate:** identifiers are unique where required, duplicate candidates are surfaced, and search never leaks out-of-scope patients.

- [ ] **5. Finish observation scheduling and escalation** — IN_PROGRESS: schedules are serialized with observations, cannot exceed the current NEWS2 frequency, and cannot postpone an earlier due observation; regression tests cover high-risk overrides. Clinical-policy validation and full escalation coverage remain.
  - Add observation frequency, due/overdue calculation, latest-score projections, alert resolution/supersession, and validated escalation policy.
  - Add NEWS2 Scale 2 only if hospital clinical policy requires it.
  - **Exit gate:** boundary, stale-observation, escalation, acknowledgement, and concurrent-update tests pass.

- [ ] **6. Structured order lifecycle** — In progress: expanded order categories, priority, atomic create/confirmation audit, acknowledgement, completion, discontinuation, optional consultant approval, order-set templates and draft-order provenance, and conflict handling are implemented. Order-set application requires an idempotency key and retains original orders on retry. Policy-driven mandatory approval, remaining lifecycle, idempotency for other operations, and round/referral provenance remain. — IN_PROGRESS
  - Replace free-form order behavior with typed categories, priorities, explicit transitions, approval rules, acknowledgements, completion/discontinuation, order sets, provenance, idempotency, and optimistic concurrency.
  - Preserve compatibility for current order readers during migration.
  - **Exit gate:** invalid transitions and duplicate signing are rejected; round/referral provenance is retained.

- [ ] **7. Role worklists and realtime notifications** — In progress: `/worklists/me` derives scoped observation, task, draft-order, and alert items; notifications support read, acknowledgement, and closure with transactional delivery. Other role queues and reliable reconnect remain. — IN_PROGRESS
  - Derive doctor, consultant, nurse, admissions, and billing worklists from source records.
  - Add due/overdue items and durable SSE/WebSocket notification delivery with read/acknowledged/closed states.
  - **Exit gate:** reconnecting clients do not lose or duplicate notifications, and dashboard counts match source data.

- [ ] **8. Doctor I-PASS handover** — IN_PROGRESS: draft sessions, per-patient I-PASS entry/signing, sending, questions, mandatory read-back, acceptance, assignment transfer, stale checks for admission revisions and selected chart entries, refresh, and cancellation are implemented. Complete chart-wide stale detection and additional concurrency coverage remain.
  - Add severity, summary, action list, contingencies, questions, receiver synthesis, required read-back, stale-chart detection, per-patient acceptance, and atomic responsibility transfer.
  - **Exit gate:** unstable patients cannot be accepted without read-back, and every patient has one accountable doctor throughout transfer.

- [ ] **9. Nurse SBAR bedside handover** — IN_PROGRESS: chart-derived snapshots, notes, questions, mandatory bedside checklist, discrepancies, per-patient acceptance, assignment transfer, and cancellation are implemented. Snapshot refresh/stale detection and additional concurrency coverage remain.
  - Add chart-derived SBAR, bedside safety checklist, questions, discrepancies, per-patient acceptance, and atomic assignment transfer.
  - **Exit gate:** required bedside checks cannot be bypassed and interrupted/retried handovers do not duplicate assignments.

- [ ] **10. Admission intake and patient movement** — IN_PROGRESS: request/accept/decline intake with active-admission uniqueness, bed assignment, consultant/duty doctor, first-hours checklist and nurse pickup; temporary and permanent movement requests with escort checks, bed reservation, departure, return/arrival, and cleaning are implemented. Porter integration, reservation/arrival concurrency coverage, and the complete artifact admission/notification flows remain.
  - Add emergency/OPD/elective/external requests, acceptance/decline, reservation, arrival, first-hours checklist, order sets, and bedside assignment.
  - Add permanent and temporary movements, retained beds, destination acceptance, porter, escort/equipment rules, and movement history.
  - **Exit gate:** reservation races cannot double-book beds and NEWS2 escort rules are enforced.

- [x] **11. Consultant rounds, transfer of care, and cross-referrals** — COMPLETED: cross-referrals support send, duplicate prevention, consultant access/opinion, signed opinion notes, recommendation-to-draft-order provenance, acknowledgement, withdrawal, and closure. Consultant rounds include prioritised worklist, chart context, signed SOAP notes, and orders. Separate consultant-care transfers require discussion and family notification, current-consultant release, receiving-consultant acceptance or decline, support withdrawal, atomically update the treating-consultant assignment, and notify billing staff for insured patients. Consultant form signatures and discharge approvals remain dependent on Items 15 and 16.
  - Add consultant worklists and rounds, SOAP notes, round orders, transfer release/acceptance, referrals, opinions, duplicate prevention, acknowledgement, and recommendation-to-order conversion.
  - **Exit gate:** consultant responsibility changes atomically and referral/order provenance is auditable.

- [ ] **12. Nursing assessments and care delivery** — IN_PROGRESS: signed assessments, Morse/Braden/MUST scoring, generated and manually managed care plans, recurring tasks, intake/output, persistent low-urine alert escalation with doctor notification, and SBAR calls are implemented. Nursing handover is Item 9; comprehensive edge-case coverage and clinical policy validation remain.
  - Add nurse assignments, initial/reassessment records, Morse/Braden/MUST/pain scores, lines/drains, generated care plans, recurring tasks, intake/output, low-output alerts, notes, and SBAR calls.
  - **Exit gate:** score boundaries, recurring due times, low-output calculations, and doctor acknowledgement are tested.

- [ ] **13. Medication Administration Record and infusions** — IN_PROGRESS: order-linked schedules, clinician allergy review, wristband/medication verification, given/held/missed states, prescriber-specified PRN limits, notifications, infusion events, and a clearly labelled synthetic medication/cross-reactivity catalogue are implemented. Complete artifact coverage, combined limits across separate orders, and clinical validation remain. Synthetic data is demo-only and is not a validated clinical catalogue.
  - Add medication catalogue/schedules, due states, wristband and five-rights checks, allergy conflicts, held/missed/PRN reasons, infusion transitions, and immutable administration history.
  - **Exit gate:** wrong-patient, allergy, duplicate-dose, time-window, concurrent-hold, and invalid-infusion tests pass.

- [ ] **14. OPD** — IN_PROGRESS: existing/new-patient check-in, token queue, triage, drafts, synthetic diagnosis/investigation catalogues, prescription allergy overrides, signed closure, charge summary, admission-intake handoff, and synthetic pharmacy/collection dispatch queues are implemented. Paediatric dosing, true ICD-10 data, and real pharmacy/lab integration remain.
  - Add check-in, queue tokens, triage, consultation, ICD-10 diagnoses, prescriptions, investigations, stock status, allergy override audit, paediatric dosing, follow-up, admission conversion, and charge summaries.
  - **Exit gate:** queue order is deterministic, signed prescriptions are immutable, and dosing/allergy safety tests pass.

- [ ] **15. Forms, consent, and signatures** — IN_PROGRESS: synthetic template library, custom templates, patient autofill snapshots, draft values, demo signature capture, finalization, and new versions are implemented. Artifact-specific validated templates, signature requests, return-for-correction, rendered document storage, and legal sign-off remain.
  - Add versioned templates/instances, autofill provenance, required fields, signature requests, patient/witness signatures, correction flow, immutable final documents, rendering/storage, and custom templates.
  - **Exit gate:** finalized forms cannot be modified, new versions clear signatures, and legal signature policy has stakeholder approval.

- [ ] **16. Staged discharge** — IN_PROGRESS: discharge plans, consultant approval, signed summary, checklist and role gates, NEWS2/form/insurance checks, completion and bed cleaning are implemented. Routine home, referral, and LAMA discharges can no longer use the legacy direct endpoint; explicit death and inter-team transfers remain exceptional legacy exits. Structured result ownership, medication reconciliation, nursing detail, and broader concurrency coverage remain.
  - Replace direct admission closure with plans, types, consultant approval, parallel medical/nursing/billing tasks, summary, pending-result ownership, medication reconciliation, safety gates, patient departure, and bed release.
  - **Exit gate:** NEWS2, document, pending-result, payment, and LAMA/referral gates prevent unsafe completion.

- [ ] **17. Claims, insurance, and billing checkpoints** — IN_PROGRESS: manual/demo claim creation, pre-authorisation, insurer questions/replies, approvals, enhancement requests, cost tracking, deposits, audit history, revision checks, and fixed-precision money are implemented. Billing is linked to an approved discharge plan and completed clinical checklist; actual insurer integration, supporting documents, and broader final-approval coverage remain.
  - Add policies, pre-authorization, queries/replies, approval limits, utilization, enhancements, final approval, discharge billing, deposits, documents, and communication history using fixed-precision money.
  - **Exit gate:** claim transitions, limits, concurrent updates, and discharge dependencies are tested.

- [ ] **18. External integrations and production operations** — IN_PROGRESS: process health and database/migration readiness endpoints are implemented. Pharmacy, lab, billing, document storage, real integrations, restore drills, monitoring, and clinical/compliance sign-off remain; authentication hardening stays deferred per user instruction.
  - Add real OTP/SMS, pharmacy, LIS/RIS/PACS, billing/TPA, document storage/scanning, and required ABHA/FHIR/HL7 adapters.
  - Add rate limits, session rotation/revocation, backups, restore drills, monitoring, health/readiness checks, retention, incident runbooks, and compliance review.
  - **Exit gate:** sandbox contract tests, restore drill, security review, load checks, and operational sign-off pass.

## 8. Recommended release slices

1. **Inpatient doctor MVP:** Phases 0–3, using the current notes/orders/vitals foundation.
2. **Safe shift operation:** Phase 4.
3. **Admission and movement operations:** Phase 5.
4. **OPD and consultant workflows:** Phases 6–7.
5. **Forms and nursing/MAR:** Phases 8–9.
6. **Discharge and revenue cycle:** Phases 10–11.
7. **Production integrations:** Phase 12.

Do not implement themes, keyboard shortcuts, responsive layout, gauges, or other presentation behavior in the backend. Offline clinical editing should be a separate, explicitly designed synchronization project; silently replaying local browser state would create patient-safety and conflict risks.
