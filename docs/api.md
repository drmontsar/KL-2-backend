# KliniK API

This document lists the API endpoints and describes how each role uses them.

## Base

The server runs on port 3001 by default. Set the `PORT` environment variable to use a different port.

- Base URL: `http://localhost:3001`
- OpenAPI spec: `GET /openapi.json`
- Interactive docs: `GET /docs`

Start the server with `bun run server`.

## Authentication

Phase 1 has no authentication. Every request is accepted.

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

1. Get assigned admissions. Use `GET /admissions?assigned_to={nurse_id}`.
2. Update the bed or ward. Use `PATCH /admissions/{id}`.
3. Write notes on the admission. Use `POST /admissions/{id}/notes`.
4. View pending tasks. Use `GET /admissions/{id}/tasks?status=pending`.
5. Complete a task. Use `POST /tasks/{id}/complete`.

---

## Endpoints

### Users

| Method | Path | Action |
|--------|------|--------|
| GET | `/users` | List active staff |
| POST | `/users` | Create a staff user |
| GET | `/users/{id}` | Get one staff user |
| POST | `/users/{id}/disable` | Disable a staff user |

**Roles:** `doctor`, `nurse`, `admin`

---

### Patients

| Method | Path | Action |
|--------|------|--------|
| GET | `/patients` | List all patients |
| POST | `/patients` | Register a patient |
| GET | `/patients/{id}` | Get one patient |
| PATCH | `/patients/{id}` | Update a patient |
| GET | `/patients/{id}/admissions` | List all admissions for a patient |
| GET | `/patients/{id}/diagnoses` | List diagnoses for a patient |

Allergies are stored on the patient record as a JSON array. Send them in the `POST /patients` or `PATCH /patients/{id}` body under the `allergies` field.

```json
"allergies": [
  { "allergen": "Penicillin", "reaction": "rash", "severity": "mild" }
]
```

---

### Admissions

An admission is one hospital stay for a patient. It opens when the patient is admitted. It closes when the patient is discharged.

| Method | Path | Action |
|--------|------|--------|
| GET | `/admissions` | List active admissions |
| POST | `/admissions` | Start an admission |
| GET | `/admissions/{id}` | Get one admission |
| PATCH | `/admissions/{id}` | Update ward or bed |
| POST | `/admissions/{id}/assign` | Assign the admission to a nurse |
| POST | `/admissions/{id}/discharge` | Discharge the patient |
| POST | `/admissions/{id}/diagnoses` | Add a diagnosis to the admission |
| GET | `/admissions/{id}/notes` | List notes on the admission |
| POST | `/admissions/{id}/notes` | Write a note |
| GET | `/admissions/{id}/orders` | List orders |
| POST | `/admissions/{id}/orders` | Create an order |
| GET | `/admissions/{id}/tasks` | List tasks |

**Query filters for `GET /admissions`:**

| Parameter | Effect |
|-----------|--------|
| `ward` | Show only admissions in this ward |
| `assigned_to` | Show only admissions assigned to this nurse ID |

---

### Notes

A note starts as a draft. The doctor or nurse edits the draft body. Confirming the note locks the body into a version record. A confirmed version cannot be edited. Add an amendment to correct a confirmed version.

| Method | Path | Action |
|--------|------|--------|
| PATCH | `/notes/{id}/draft` | Update the draft body |
| POST | `/notes/{id}/confirm` | Confirm the note and create a version |
| GET | `/notes/{id}/versions` | List all versions |
| POST | `/notes/{id}/versions/{versionId}/amendments` | Add an amendment to a confirmed version |

---

### Orders and Tasks

The doctor creates an order in `draft` state. Confirming the order changes its status to `confirmed` and creates one task for the nurse. This happens in one database transaction.

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
