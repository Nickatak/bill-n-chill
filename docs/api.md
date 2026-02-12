# API Standards

## Base Path

- `/api/v1/`

## Response Conventions

Success:

```json
{
  "data": {}
}
```

Error:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request",
    "fields": {}
  }
}
```

## Initial Endpoint Plan

- `GET /api/v1/health/`
  - Purpose: service liveness/readiness signal for local and deployment checks.

## Authentication (v1 baseline)

Buildr currently uses DRF token authentication for API access.

- `POST /api/v1/auth/login/`
  - Body:
    ```json
    {
      "email": "pm@example.com",
      "password": "secret123"
    }
    ```
  - Success response:
    ```json
    {
      "data": {
        "token": "TOKEN_VALUE",
        "user": {
          "id": 1,
          "email": "pm@example.com"
        }
      }
    }
    ```
- `GET /api/v1/auth/me/`
  - Header: `Authorization: Token TOKEN_VALUE`
  - Purpose: confirm token validity and current user identity.

## Lead Contact Intake (INT-01)

- `POST /api/v1/lead-contacts/quick-add/`
  - Auth required: `Authorization: Token TOKEN_VALUE`
  - Required fields:
    - `full_name`
    - `phone`
    - `project_address`
  - Optional fields:
    - `email`
    - `notes`
    - `source` (`field_manual`, `office_manual`, `import`, `web_form`, `referral`, `other`)
  - Success response includes created lead contact record under `data`.

## Duplicate Detection and Resolution (INT-02)

Quick Add now checks potential duplicates (phone/email).

If duplicates are detected and no resolution is provided:

- response status: `409`
- response body includes:
  - `error.code = "duplicate_detected"`
  - `data.duplicate_candidates[]`
  - `data.allowed_resolutions = ["use_existing", "merge_existing", "create_anyway"]`

Resolution fields accepted by `POST /api/v1/lead-contacts/quick-add/`:

- `duplicate_resolution`:
  - `use_existing`: return selected existing contact without creating a new one
  - `merge_existing`: update selected existing contact with incoming values
  - `create_anyway`: create new contact despite duplicates
- `duplicate_target_id`:
  - required for `use_existing` and `merge_existing`

## Lead Conversion (INT-03)

- `POST /api/v1/lead-contacts/{lead_id}/convert-to-project/`
  - Auth required: `Authorization: Token TOKEN_VALUE`
  - Request body:
    - `project_name` (optional; defaults to `<lead full name> Project`)
    - `project_status` (optional; default `prospect`)
      - allowed: `prospect`, `active`, `on_hold`, `completed`, `cancelled`
  - Behavior:
    - creates or reuses a matching `Customer`
    - creates a `Project` shell
    - marks lead as `project_created` and stores conversion links
  - Idempotency:
    - If lead is already converted, returns existing customer/project with `meta.conversion_status = "already_converted"`.

## Project Profile and Baseline (PRJ-01)

- `GET /api/v1/projects/`
  - Auth required
  - Returns current user project shells with customer context.

- `GET /api/v1/projects/{project_id}/`
  - Auth required
  - Returns one project profile record for current user.

- `PATCH /api/v1/projects/{project_id}/`
  - Auth required
  - Supports profile updates:
    - `name`
    - `status`
    - `contract_value_original`
    - `contract_value_current`
    - `start_date_planned`
    - `end_date_planned`
  - Purpose: maintain project shell and contract baseline fields after lead conversion.

## Cost Code Management (EST-01)

- `GET /api/v1/cost-codes/`
  - Auth required
  - Returns cost codes scoped to the current user.

- `POST /api/v1/cost-codes/`
  - Auth required
  - Creates a cost code with:
    - `code`
    - `name`
    - `is_active`

- `PATCH /api/v1/cost-codes/{cost_code_id}/`
  - Auth required
  - Updates `code`, `name`, and/or `is_active`.

## Estimate Authoring and Versioning (EST-02)

- `GET /api/v1/projects/{project_id}/estimates/`
  - Auth required
  - Returns estimate versions for the selected project.

- `POST /api/v1/projects/{project_id}/estimates/`
  - Auth required
  - Creates a new estimate version with:
    - `title`
    - `tax_percent`
    - `line_items[]` (cost code, description, quantity, unit, unit_cost, markup_percent)
  - Server computes line totals and estimate totals.

- `GET /api/v1/estimates/{estimate_id}/`
  - Auth required
  - Returns one estimate with line items.

- `PATCH /api/v1/estimates/{estimate_id}/`
  - Auth required
  - Supports updating estimate status/title/tax and replacing line items.

- `POST /api/v1/estimates/{estimate_id}/clone-version/`
  - Auth required
  - Creates a new draft version cloned from the selected estimate.

## Estimate Approval Lifecycle (EST-03)

- `PATCH /api/v1/estimates/{estimate_id}/`
  - Auth required
  - Supports status transitions with optional audit note:
    - `status`
    - `status_note`
  - Allowed transitions:
    - `draft -> sent | archived`
    - `sent -> draft | approved | rejected | archived`
    - `approved -> archived`
    - `rejected -> draft | archived`
    - `archived -> (no further transitions)`

- `GET /api/v1/estimates/{estimate_id}/status-events/`
  - Auth required
  - Returns audit trail entries for estimate status changes, including actor, timestamp, and note.

## Versioning Rules

- Non-breaking changes can stay in `v1`.
- Breaking changes require `v2` path introduction.
