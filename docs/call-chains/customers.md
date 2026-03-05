# Customers Call Chains

> **Line anchors are pinned manually.** Update after refactors that move function definitions.

End-to-end function call order for each customer action. All backend view functions live in [`customers.py`](../../backend/core/views/shared_operations/customers.py) unless noted.

## Key Source Files

| Layer | File | Purpose |
|-------|------|---------|
| Backend | [`views/shared_operations/customers.py`](../../backend/core/views/shared_operations/customers.py) | All customer endpoints + view helpers |
| Backend | [`serializers/customers.py`](../../backend/core/serializers/customers.py) | Validation serializers |
| Backend | [`models/shared_operations/customers.py`](../../backend/core/models/shared_operations/customers.py) | `Customer` model |
| Backend | [`models/financial_auditing/customer_record.py`](../../backend/core/models/financial_auditing/customer_record.py) | `CustomerRecord` immutable audit |
| Backend | [`models/financial_auditing/lead_contact_record.py`](../../backend/core/models/financial_auditing/lead_contact_record.py) | `LeadContactRecord` immutable audit |
| Frontend | [`features/customers/components/customers-console.tsx`](../../frontend/src/features/customers/components/customers-console.tsx) | Customer list, edit, project create, quick-add |
| Frontend | [`features/customers/hooks/use-quick-add-business-workflow.ts`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts) | Quick-add submission orchestration |
| Frontend | [`features/customers/api.ts`](../../frontend/src/features/customers/api.ts) | API helpers |

## List Customers

`FRONTEND` — [`CustomersConsole`](../../frontend/src/features/customers/components/customers-console.tsx#L41)

- [`loadCustomers(searchQuery)`](../../frontend/src/features/customers/components/customers-console.tsx#L104)
  - [`buildAuthHeaders(token)`](../../frontend/src/features/session/auth-headers.ts#L39)
  - `fetch GET /customers/?q=…`

---

`BACKEND` — [`customers_list_view`](../../backend/core/views/shared_operations/customers.py#L37)

*── org scoping ──*

- [`_organization_user_ids(request.user)`](../../backend/core/user_helpers.py#L99)
- `Customer.objects.filter(created_by_id__in=…).annotate(project_count, active_project_count)`

*── search filter ──*

- `rows.filter(Q(display_name | phone | email | billing_address))`

*── serialization ──*

- [`CustomerManageSerializer(rows, many=True)`](../../backend/core/serializers/customers.py#L77)

---

`HTTP 200` → `FRONTEND`

- `setRows(items)` — populate customer list

## Edit Customer

`FRONTEND` — [`CustomersConsole`](../../frontend/src/features/customers/components/customers-console.tsx#L41)

- [`openEditor(id)`](../../frontend/src/features/customers/components/customers-console.tsx#L185)
  - [`hydrate(row)`](../../frontend/src/features/customers/components/customers-console.tsx#L95) — populate form fields
- [`handleSave(event)`](../../frontend/src/features/customers/components/customers-console.tsx#L229)
  - [`canDo(capabilities, "customers", "create")`](../../frontend/src/features/session/rbac.ts#L12) — RBAC check
  - [`buildAuthHeaders(token, { contentType })`](../../frontend/src/features/session/auth-headers.ts#L39)
  - `fetch PATCH /customers/{id}/  { display_name, phone, email, billing_address, is_archived }`

---

`BACKEND` — [`customer_detail_view`](../../backend/core/views/shared_operations/customers.py#L73) (PATCH branch)

*── org scoping ──*

- [`_organization_user_ids(request.user)`](../../backend/core/user_helpers.py#L99)
- `Customer.objects.filter(id=…, created_by_id__in=…).first()`

*── capability gate ──*

- [`_capability_gate(request.user, "customers", "edit")`](../../backend/core/rbac.py#L18)

*── persist ──*

- `transaction.atomic():`
  - [`CustomerManageSerializer(customer, data=…, partial=True).save()`](../../backend/core/serializers/customers.py#L77)
  - *── archive cascade ──*
  - if `is_archived` changed `false → true`: `customer.projects.filter(status=PROSPECT).update(status=CANCELLED)`
  - *── audit record ──*
  - [`CustomerRecord.record(…, UPDATED)`](../../backend/core/models/financial_auditing/customer_record.py#L70)
    - [`customer.build_snapshot()`](../../backend/core/models/shared_operations/customers.py#L61)
    - [`CustomerRecord.objects.create(…)`](../../backend/core/models/financial_auditing/customer_record.py#L8)

---

`HTTP 200` → `FRONTEND`

- `setRows(…)` — update local list with refreshed customer
- `setIsEditorOpen(false)` — close modal

## Create Project from Customer

`FRONTEND` — [`CustomersConsole`](../../frontend/src/features/customers/components/customers-console.tsx#L41)

- [`openProjectCreator(customer)`](../../frontend/src/features/customers/components/customers-console.tsx#L201)
  - pre-fill `projectName`, `projectSiteAddress` from customer
- [`handleCreateProject(event)`](../../frontend/src/features/customers/components/customers-console.tsx#L273)
  - [`canDo(capabilities, "projects", "create")`](../../frontend/src/features/session/rbac.ts#L12) — RBAC check
  - [`buildAuthHeaders(token, { contentType })`](../../frontend/src/features/session/auth-headers.ts#L39)
  - `fetch POST /customers/{id}/projects/  { name, site_address, status, initial_contract_value }`

---

`BACKEND` — [`customer_project_create_view`](../../backend/core/views/shared_operations/customers.py#L190)

*── org scoping ──*

- [`_organization_user_ids(request.user)`](../../backend/core/user_helpers.py#L99)
- `Customer.objects.filter(id=…, created_by_id__in=…).first()`

*── capability gate ──*

- [`_capability_gate(request.user, "projects", "create")`](../../backend/core/rbac.py#L18)

*── validation ──*

- [`CustomerProjectCreateSerializer(data=…).is_valid()`](../../backend/core/serializers/customers.py#L140)
- defaults: `name` → `"<customer> Project"`, `site_address` → customer billing address, `initial_contract_value` → `0`
- if `site_address` is empty after defaults: `HTTP 400`

*── persist ──*

- `transaction.atomic():`
  - `Project.objects.create(…)` — always created as `PROSPECT` first
  - if `requested_status == ACTIVE`: `project.status = ACTIVE; project.save()`
  - *── audit record ──*
  - [`CustomerRecord.record(…, UPDATED)`](../../backend/core/models/financial_auditing/customer_record.py#L70)
    - [`customer.build_snapshot()`](../../backend/core/models/shared_operations/customers.py#L61)
    - [`CustomerRecord.objects.create(…)`](../../backend/core/models/financial_auditing/customer_record.py#L8)

---

`HTTP 201` → `FRONTEND`

- `router.push(/projects/{id})` — navigate to new project workspace

## Quick Add Customer Intake

`FRONTEND` — [`QuickAddConsole`](../../frontend/src/features/customers/components/quick-add-console.tsx#L19)

- [`useQuickAddController({ token })`](../../frontend/src/features/customers/hooks/use-quick-add-controller.ts#L41)
  - [`useQuickAddBusinessWorkflow(…)`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts#L62)

*── submission ──*

- [`handleQuickAdd(event)`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts#L238)
  - [`validateLeadFields(payload, { intent, projectName })`](../../frontend/src/features/customers/hooks/quick-add-validation.ts)
  - [`submitQuickAdd(payload, submission)`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts#L125)
    - [`postQuickAddCustomerIntake({ baseUrl, token, body })`](../../frontend/src/features/customers/api.ts#L25)
      - [`buildAuthHeaders(token, { contentType })`](../../frontend/src/features/session/auth-headers.ts#L39)
      - `fetch POST /customers/quick-add/  { full_name, phone, email, … }`

---

`BACKEND` — [`quick_add_customer_intake_view`](../../backend/core/views/shared_operations/customers.py#L300)

*── capability gate ──*

- [`_capability_gate(request.user, "customers", "create")`](../../backend/core/rbac.py#L18)

*── validation ──*

- [`CustomerIntakeQuickAddSerializer(data=…).is_valid()`](../../backend/core/serializers/customers.py#L27)
- project field validation (if `create_project=true`)

*── duplicate detection ──*

- [`_find_duplicate_customers(user, phone=…, email=…)`](../../backend/core/views/shared_operations/customers_helpers.py#L10)
  - [`_organization_user_ids(user)`](../../backend/core/user_helpers.py#L99)
  - direct match by phone/email
  - [`_normalized_phone()`](../../backend/core/views/helpers.py#L114) secondary pass
- if duplicates found and no resolution: `HTTP 409` with [`_build_customer_duplicate_candidate(…)`](../../backend/core/views/shared_operations/customers_helpers.py#L34)

*── persist (no duplicates, or resolution=use_existing) ──*

- `transaction.atomic():`
  - *── customer ──*
  - `Customer.objects.create(…)` (or use selected existing customer)
  - [`CustomerRecord.record(…, CREATED)`](../../backend/core/models/financial_auditing/customer_record.py#L70)
    - [`customer.build_snapshot()`](../../backend/core/models/shared_operations/customers.py#L61)
    - [`CustomerRecord.objects.create(…)`](../../backend/core/models/financial_auditing/customer_record.py#L8)
  - *── intake record ──*
  - [`LeadContactRecord.record(…, CREATED)`](../../backend/core/models/financial_auditing/lead_contact_record.py#L90)
    - [`_build_intake_payload(…)`](../../backend/core/views/shared_operations/customers_helpers.py#L46)
    - [`LeadContactRecord.objects.create(…)`](../../backend/core/models/financial_auditing/lead_contact_record.py#L16)
  - *── project (if create_project=true) ──*
  - `Project.objects.create(…)`
  - if `requested_status == ACTIVE`: `project.status = ACTIVE; project.save()`
  - [`LeadContactRecord.record(…, CONVERTED)`](../../backend/core/models/financial_auditing/lead_contact_record.py#L90)
    - [`_build_intake_payload(…, converted_customer_id, converted_project_id)`](../../backend/core/views/shared_operations/customers_helpers.py#L46)
    - [`LeadContactRecord.objects.create(…)`](../../backend/core/models/financial_auditing/lead_contact_record.py#L16)

---

`HTTP 201` → `FRONTEND`

- [`submitQuickAdd`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts#L125) success path:
  - update confirmation state (`lastConvertedCustomerId`, `lastConvertedProjectId`)
  - reset form fields for next entry
  - `setLeadMessage("Customer + project created.")`

*── duplicate resolution (if HTTP 409) ──*

`HTTP 409` → `FRONTEND`

- `setDuplicateCandidates(candidates)` — show duplicate resolution UI
- [`resolveDuplicate(resolution, targetId)`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts#L302)
  - replays [`submitQuickAdd(…, { duplicate_resolution, duplicate_target_id })`](../../frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts#L125)
  - `fetch POST /customers/quick-add/` (same endpoint, with resolution params)
