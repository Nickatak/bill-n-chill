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

### Project List & Selection (`ProjectsConsole`)

- [x] Empty state when no projects exist (links to /customers)
- [x] Loads and displays project in the list
- [x] Auto-selects first project and shows overview
- [x] Renders multiple projects; cards for each
- [x] Clicking a different project card updates overview + pipeline links
- [x] Customer URL scope (`?customer=10`) filters to that customer's projects
- [x] Project URL scope (`?project=2`) pre-selects and expands filters for non-default status
- [x] Load failure / network error on initial project fetch (silently fails — empty list)
- [x] Switching projects clears stale financial data (summary resets to "--" before re-fetch)

### Search & Filters

- [x] Search input filters projects by name
- [x] Search filters by customer display name
- [x] Search filters by project ID
- [x] Toggling a status filter hides projects with that status
- [x] "Show all projects" reveals all statuses
- [x] "Reset filters" restores default (active + prospect)
- [x] Falls back to first visible project when filter hides selected
- [x] Search returning 0 visible projects (empty state within filtered view)

### Financial Snapshot

- [x] Financial summary section headers render (Contract Total, Invoiced, Paid, Outstanding, Remaining to Invoice)
- [x] Financial metrics display correct dollar amounts (computed from summary)
- [x] Remaining to Invoice = Contract Total - Invoiced (derived calculation)
- [ ] Financial summary shows "--" placeholders before data loads
- [ ] AP metrics display (ap_total, ap_paid, ap_outstanding — present in summary type but not asserted)

### Pipeline Status Badges

- [x] Estimate status count badges (D/S/A)
- [x] Change order status count badges (D/S/A)
- [x] Bill status count badges (R/D/A)
- [x] Invoice status count badges (D/S/P)
- [x] All pipeline links render with correct hrefs for selected project

### Project Editor (profile form)

- [x] Edit Project button opens form, Close Edit hides it
- [x] Form hydrates with selected project name + status
- [x] Saves via PATCH and shows success message
- [x] Shows error on PATCH API failure (server message surfaces)
- [x] Shows error on PATCH network failure
- [x] Status pills for active project: active (current), on_hold, completed, cancelled
- [x] Status pills for prospect project: prospect (current), active, cancelled (no on_hold/completed)
- [x] Terminal projects (completed/cancelled): Edit button not shown
- [x] Terminal projects show "no longer editable" hint text
- [x] Status change via pill + save actually sends new status in PATCH body
- [ ] Edit form scroll-into-view when opened off-screen (behavior exists, hard to test in jsdom)

### Action Toolbar

- [ ] "Invoice Deposit" link disabled when no approved estimate, enabled when approved estimate exists
- [ ] "Invoice from Estimate + COs" link disabled when no approved estimate, enabled when exists
- [ ] "Record Payment" button disabled when no payable invoices, enabled when payable invoices exist
- [ ] "Log Receipt" button always enabled
- [ ] Clicking "Record Payment" opens PaymentRecorder panel, clicking again closes it
- [ ] Clicking "Log Receipt" opens QuickReceipt panel, clicking again closes it
- [ ] Toolbar panel shows prompt text ("Select an action...") when no panel active
- [ ] Switching between toolbar panels (payment → receipt) swaps content

### Quick Entry Tabs (`QuickEntryTabs`)

- [x] Renders payment tab by default
- [x] Switches to receipt tab on click
- [x] Switches back to payment tab from receipt
- [ ] Tab aria-pressed reflects active state (tested but worth manual visual check)

### Project Activity Timeline (`ProjectActivityConsole`)

- [x] Auto-loads and displays timeline items on mount
- [x] Shows loading state while fetching
- [x] Shows error message on API failure
- [x] Shows network error on fetch rejection
- [x] Renders empty state when timeline has no items
- [x] Renders timeline item links with correct href
- [x] Renders event type badges (Estimate, Payment, etc.)
- [x] Renders category filter pills (All, Workflow, Financial)
- [x] Reloads timeline when category pill is clicked (sends category param)
- [x] Shows detail text when present

### Project Helpers (pure utils)

- [x] `parseMoneyValue`: decimal strings, currency formatting, negatives, null/undefined/NaN/Infinity
- [x] `formatCustomerName`: display name present, empty, missing
- [x] `projectStatusLabel`: snake_case to readable labels
- [x] `allowedProfileStatuses`: correct FSM transitions for all 5 statuses
- [x] Constants: status values, default filters, terminal states have no transitions

### Remaining Gaps (manual QA needed)

1. **Action toolbar enable/disable logic** — `Invoice Deposit` and `Invoice from Estimate + COs` disabled without approved estimates, enabled with; `Record Payment` disabled without payable invoices, enabled with
2. **Toolbar panel toggle** — clicking Record Payment / Log Receipt opens respective panel, clicking again closes, switching between them swaps content
3. **Financial summary "--" placeholders** — before data loads, all metrics show "--"
4. **Edit form scroll-into-view** — form scrolls into viewport when opened off-screen (jsdom limitation)
5. **AP metrics display** — ap_total, ap_paid, ap_outstanding present in summary type but not yet rendered/asserted

## Accounting (`/accounting`)

### Tab Shell (`AccountingConsole`)

- [x] Renders invoices tab by default
- [x] Switches to bills tab on click
- [x] Switches to receipts tab on click
- [x] Switches back to invoices from another tab
- [x] Shows auth notice when no token ("Sign in to view accounting data.")

### Payment Recorder (`PaymentRecorder` — shared component)

- [x] Renders heading and direction-specific copy (inbound vs outbound)
- [x] Shows empty state when no payments exist
- [x] Loads and displays payments from API
- [x] Shows detail card with target info for selected payment
- [x] Creates new payment via POST with required target
- [x] Saves edited payment via PATCH
- [x] Switches to create mode with "Record New Payment" button
- [x] Shows quick status actions for non-terminal payments (pending → settled/void)
- [x] Executes quick status transition via PATCH
- [x] Hides quick status actions for void (terminal) payments
- [x] Shows read-only notice for viewers without create/edit
- [x] Shows required target selector on create when targets available
- [x] Shows guidance message when no allocation targets exist
- [x] Disables submit button when no target is selected
- [x] Hides heading when `hideHeader` is true
- [x] Hides payment list in `createOnly` mode (shows only create form)
- [x] Shows network error when create fetch rejects
- [x] Shows API error on create failure

### Payment Filters (`usePaymentFilters` hook)

- [x] Filters to inbound payments only
- [x] Defaults to pending + settled status filters
- [x] Applies status filters to inbound payments
- [x] Returns empty array when no status filters are active
- [x] Toggles status filter on/off
- [x] Computes status totals from inbound payments
- [x] Searches across multiple fields (customer name, reference number)
- [x] Search is case-insensitive
- [x] Combines status filters and search
- [x] Whitespace-only search treated as empty
- [x] Exposes normalized search needle

### Invoices Tab (`InvoicesTab`) — zero coverage

- [ ] Fetches and displays org-wide invoices on mount
- [ ] Renders invoice cards with status, total, balance due
- [ ] Shows nested payment allocations under each invoice
- [ ] Inline payment recording on invoice click
- [ ] Search filters invoices
- [ ] Pagination controls work
- [ ] Empty state when no invoices exist

### Bills Tab (`BillsTab`) — zero coverage

- [ ] Fetches and displays org-wide vendor bills on mount
- [ ] Renders bill cards with status, amount
- [ ] Shows nested payment allocations under each bill
- [ ] Inline payment recording on bill click
- [ ] Search filters bills
- [ ] Pagination controls work
- [ ] Empty state when no bills exist
- [ ] Missing reference warning (methods expecting reference #)

### Receipts Tab (`ReceiptsTab`) — zero coverage

- [ ] Fetches and displays org-wide receipts on mount
- [ ] Renders receipt cards with store, amount, balance due
- [ ] Shows nested payment allocations under each receipt
- [ ] Inline payment recording on receipt click
- [ ] Search filters receipts
- [ ] Pagination controls work
- [ ] Empty state when no receipts exist

### Recommended New Tests

The three sub-tabs (InvoicesTab, BillsTab, ReceiptsTab) are the major gap — each is a self-contained component with its own fetch, render, inline payment forms, search, and pagination. These are complex and testing them properly requires mocking multiple API endpoints per tab. Recommend tackling one at a time.

## Organization (`/ops/organization`)

## Cost Codes (`/cost-codes`)

## Vendors (`/vendors`)

## Onboarding (`/onboarding`)

## Estimates (project sub-route)

## Change Orders (project sub-route)

## Invoices (project sub-route)

## Vendor Bills (project sub-route)
