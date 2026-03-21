# QA Freeze Checklist

Page-by-page integration test coverage and manual QA pass.
Once a page clears both (tests written + manual pass), it's frozen.

---

## Customers (`/customers`)

### Quick Add (`QuickAddConsole`)

- [x] Form renders with intro text, full name, and phone fields
- [x] Validation errors on empty submission (name + phone required)
- [x] Phone-only validation when name is provided but phone is empty
- [x] Project field validation on customer+project submit with empty project name/address
- [x] Success message on customer-only submission ("Customer created.")
- [x] Success message on customer+project submission ("Customer + project created.")
- [x] Form fields clear after successful submission
- [x] Error message on API failure (server error surfaces in UI)
- [x] Error message on network failure ("unexpected UI error")
- [x] `onCustomerCreated` callback fires after success
- [x] POST body does not include `is_archived` (backend defaults to false)
- [x] Optional fields sent correctly when filled (ballpark, notes, project status)
- [x] Optional fields default correctly when left empty (null, "", "prospect")
- [x] Status pill toggles between Prospect/Active and sends correct value to API

### Duplicate Resolution (`DuplicateResolutionPanel`)

- [x] Duplicate panel appears on 409 with candidate cards and match highlighting
- [x] `use_existing` resolves duplicate and shows success
- [x] `create_anyway` removed — not offered as a resolution option
- [x] "Find in list" scrolls to existing customer (customer-only flow)
- [x] Duplicate matching util: normalized comparison, field-match detection, date formatting

### Customer List (`CustomersList`)

- [x] Customer rows render with name, phone/email, billing address
- [x] Clicking customer name opens edit modal
- [x] Archived customers render with inactive styling class
- [x] Project accordion expands/collapses on toggle click
- [x] Project status summary pills shown per customer
- [x] Project status filter chips toggle visibility within accordion
- [x] "Add New Project" button calls project creator for that customer
- [x] Empty state: "No customers match the current filters." (filter mismatch)
- [x] Empty state: "No customers matched your search." (search, 0 results)
- [x] Empty state: "No customers yet..." (fresh database, no query)

### Browse & Filters (`CustomersConsole` + `CustomersFilters`)

- [x] Customer list loads from API on mount
- [x] Error message on customer load failure
- [x] Activity filter: "Active" (default) hides archived, "All" shows all
- [x] Project filter: "With Projects" hides customers without projects
- [x] Search input triggers debounced API call with query param
- [x] Pagination renders when multiple pages exist (Page X of Y, N customers)
- [ ] Pagination: Next/Previous navigate between pages *(pre-existing test failure)*

### Customer Editor (`CustomerEditorForm`)

- [x] Opens with correct fields hydrated from customer record
- [x] Saves via PATCH and closes modal on success
- [x] Close button dismisses modal
- [x] Validation: empty display name blocked ("Display name is required.")
- [x] Error on save API failure (server message surfaces)
- [x] Error on save network failure ("Could not reach customer detail endpoint.")
- [x] Archive checkbox disabled when customer has active/on-hold projects
- [x] Archive checkbox enabled when customer has no active/on-hold projects
- [x] Un-archiving allowed even when customer has active/on-hold projects
- [x] Prospect cancellation warning shown when archive toggled on

### Project Creator (`CustomerProjectCreateForm`)

- [x] Creates project and navigates to workspace on success
- [x] Validation: empty project name blocked
- [x] Validation: empty site address blocked
- [x] Error on project create API failure
- [x] Error on project create network failure

### Read-Only Mode (viewer/worker roles)

- [x] Save Customer button disabled when user lacks `customers:create`
- [x] "Your role is read-only" message on forced submit attempt
- [x] Create Project button disabled when user lacks `projects:create`

### Project Index (`useProjectsByCustomer`)

- [x] Groups projects by customer ID
- [x] Sorts projects within each group newest-first (by ID descending)
- [x] Returns empty map when API returns no projects
- [x] Does not fetch when auth token is empty
- [x] Silently handles fetch failure (best-effort, no crash)

### Known Issues

- [ ] **Pagination tests failing** — 2 pre-existing test failures (`shows pagination`, `clicking Next`). Needs investigation.

## Projects (`/projects`)

## Accounting (`/accounting`)

## Organization (`/ops/organization`)

## Cost Codes (`/cost-codes`)

## Vendors (`/vendors`)

## Onboarding (`/onboarding`)

## Estimates (project sub-route)

## Change Orders (project sub-route)

## Invoices (project sub-route)

## Vendor Bills (project sub-route)
