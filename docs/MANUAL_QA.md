# Manual QA Checklist

Organized by domain. Check off as you go.

- [x] Logo broken. 
    This was an annoying permissions issue with Caddy (the reverse proxy) from the old build.  This has been resolved.
- [x] Invoice email sending isn't working.
    Added. Verified working.
- [x] Public estimate text isn't working.
    This actually IS working - but I think we want to arrange the order of the tabs on the document settings to reflect our workflow from left->right (Estimates, CO's, Invoices).  I also moved the help-email to the business/org settings page.
- [x] Rough Electrical/Finish Electrical cost codes.
    So, I did add those, I wasn't crazy.  The problem is that I decided to paginate 25 cost codes at a time, and there was a bug where the pagination display wasn't showing - so it looked like said cost codes didn't exist.

- [] Logo in documentCreator?
- Auto line loading for the invoice isn't working.
- [] Remove line items for bills.
    This is way deeper than it appears.  I made a mistake.  The problem is that I was originally designing for a forensic-financials style of data-accumulation.  The thing is that there is a sharp asymmetry between incoming and outgoing payments for our users.  Like, GC's are primarily interested in _collecting_ their money.  It's great if we provide a way to record and allocate expenditures, but realistically, the "core money loop" of this application actually ends at INCOMING payments. 




- [x] Probably want original estimate line items on both the editor/public for CO.
    Addressed, added a composite "contract summary" lineitems display for both CO's and invoices where it shows all approved estimate lineitems + approved CO lineitems.


- [x] Bug: When adding a new customer + project, the new customer is added to the viewer, BUT the new project (for the customer) is not.
- [x] Bug: I created a new customer + project (with an email instead of a phone number).  When I go to set the status to SENT on an estimate, I get the `WARNING: This customer has no email on file and will not receive an automated email.` message.  This shouldn't happen - since there is an email. Interestingly, it actually sends anyway.  This behavior is also present with re-send.  This issue is persists across all document types.
- [x] Visual bug:  When a logo is present on the public facing document, we probably want to remove the border/box around it (public-document-frame-module .logoBox)


---

## 1. Auth

### Login
- [x] Invalid credentials → "Invalid username/password combination."
- [x] Unverified email → "Please verify your email before signing in." + resend button
- [x] Empty email → "Email is required."
- [x] Empty password → "Password is required."
- [x] Valid credentials → token issued, redirects to /dashboard


### Register — Flow A (standard)
- [x] New email + password → "Check your email" screen
- [x] Verification email arrives (check Mailpit locally)
- [x] Click verification link → account activated, auto-login, redirects to /dashboard
- [x] Duplicate verified email → same "Check your email" response (anti-enumeration), sends password reset email
- [x] Duplicate unverified email → same response, re-sends verification (60s rate limit)
- [x] Empty email → "Email is required."
- [x] Empty password → "Password is required."
- [x] Short password (<8) → "Password must be at least 8 characters."
- [x] Old tokens give a Verification Failed message.

### Register — Flow B (new user invite)
- [x] Navigate to /register?token=XXX → invite verified, banner shows org name + role
- [x] Email pre-filled and read-only from invite
- [x] Register → account created, membership assigned, redirects to /dashboard (no email verification needed)
- [x] Expired invite (>24h) → error message
- [x] Already-consumed invite → error message

### Register — Flow C (existing user invite)
- [x] Existing user visits invite link → "Organization Switch" warning
- [x] Confirm password → membership moved to new org, old org access lost
- [x] Wrong password → error

### Email Verification
- [x] Valid token → account activated, auto-login
- [x] Consumed token → "no longer active" message
- [x] Expired token → "expired" message with resend option
- [x] Resend within 60s → rate limited

### Password Reset
- [x] Request reset for valid email → "Check your email" (always 200)
- [x] Request reset for non-existent email → same response (anti-enumeration)
- [x] Click reset link → form for new password
- [x] Submit matching passwords (8+ chars) → password updated, auto-login
- [x] Mismatched passwords → "Passwords do not match."
- [x] Short password → "Password must be at least 8 characters."
- [x] Empty fields → "Both password fields are required."
- [x] Expired token → error
- [x] Consumed token → error
- [x] Rate limit: 60s between reset requests

---

## 2. Customers

### Browse
- [x] Customer list loads with pagination (25/page)
- [x] Search filters by name/phone/email/address
- [x] Activity filter: Active (default) hides archived, All shows everything
- [x] Project filter: With Projects / All
- [x] Pagination controls work (Previous/Next, page count)

### Edit (modal)
- [x] Click customer name → edit modal opens with pre-filled fields
- [x] Change display name → Save → success message, list updates
- [x] Empty display name → "Display name is required."
- [x] Archive customer → prospect projects auto-cancelled
- [x] Cannot archive customer with active/on-hold projects
- [x] Close button and backdrop click both close modal

### Create Project (modal)
- [x] Click "Add New Project" → project creator opens, pre-filled name + address
- [x] Submit → project created, redirects to project workspace
- [x] Empty project name → "Project name is required."
- [x] Empty site address → "Site address is required."

### Quick Add
- [x] Fill name + phone → Save Customer Only → success, form clears
- [x] Fill name + phone + project fields → Save Customer + Start Project → success
- [x] Empty submission → field-level errors (name, phone)
- [x] Customer+project with empty project fields → project-specific errors
- [x] Duplicate detected (phone/email match) → resolution panel appears
- [x] "Use existing" resolution → reuses customer, creates project
- [x] "Create anyway" → creates new customer

---

## 3. Projects

- [x] Project list loads, shows all org projects
- [x] Click project → navigates to project workspace
- [x] Project detail shows contract values (original, current, accepted total)
- [x] Status transitions work: prospect → active, active → on_hold → active, active → completed
- [x] Invalid transitions blocked
- [x] Financial summary endpoint returns correct AR/AP metrics

---

## 4. Estimates

### Internal
- [ ] Create estimate for project → line items with cost codes
- [ ] Save draft → persists line items and totals
- [ ] Edit existing estimate → changes save
- [ ] Clone to new version → new estimate created with incremented version
- [ ] Duplicate estimate → full copy
- [ ] Status: Draft → Sent (generates public link, sends email if customer has email)
- [ ] No-email warning: Sent selected + customer has no email → inline red warning shown
- [ ] Status: Sent → Approved (internal approval)

### Public Preview
- [ ] Public link loads estimate detail without auth
- [ ] OTP requested → email sent to customer
- [ ] Valid OTP + consent → approve/reject decision submitted
- [ ] Approval → estimate approved, project auto-activates (if prospect)
- [ ] Rejection → estimate rejected
- [ ] Invalid/expired OTP → error

---

## 5. Change Orders

### Internal
- [ ] Create CO linked to origin estimate
- [ ] Line items show amount delta (original vs new)
- [ ] Save draft → persists
- [ ] Clone revision → new revision created
- [ ] Status: Draft → Pending Approval (generates public link, sends email)
- [ ] No-email warning shown when applicable
- [ ] Status: Pending → Approved (internal) → project contract_value_current incremented

### Public Preview
- [ ] Public link loads CO detail without auth
- [ ] OTP + consent → approve/reject
- [ ] Approval → CO approved, contract value updated atomically
- [ ] Rejection → CO rejected

---

## 6. Invoices

### Internal
- [ ] Create invoice for project → line items
- [ ] Save draft → persists
- [ ] Status: Draft → Sent (generates public link, sends email)
- [ ] No-email warning shown when applicable
- [ ] Invoice number auto-generated (sequential per org)
- [ ] Tax calculation applies to subtotal
- [ ] Balance due tracks payments correctly

### Public Preview
- [ ] Public link loads invoice without auth
- [ ] OTP + consent → customer can dispute
- [ ] Dispute → invoice status changes to disputed

### Payments (Inbound)
- [ ] Record inbound payment on invoices page
- [ ] Allocate payment to one or more invoices
- [ ] Cannot allocate more than payment amount
- [ ] Invoice balance updates atomically on allocation
- [ ] Invoice auto-transitions to PAID when balance reaches zero
- [ ] Partial allocation leaves unallocated balance

---

## 7. Vendor Bills

- [ ] Create vendor bill (planned or received) → line items
- [ ] Status transitions: planned → received → approved → scheduled → paid
- [ ] Bill number unique per vendor+project
- [ ] Due date must be >= issue date
- [ ] Void status available for corrections
- [ ] Balance due tracks outbound payments

### Payments (Outbound)
- [ ] Record outbound payment on bills page
- [ ] Allocate to vendor bills
- [ ] Direction enforcement: outbound payments only allocate to bills
- [ ] Bill balance updates on allocation

---

## 8. Cost Codes

- [ ] List org cost codes
- [ ] Create cost code (code + name)
- [ ] Code is immutable after creation
- [ ] Duplicate code → error
- [ ] Edit name/description → saves
- [ ] CSV import → bulk create, existing codes skipped

---

## 9. Vendors

- [ ] List org vendors with search
- [ ] Create vendor (name required)
- [ ] Duplicate detection by name+email → resolution panel
- [ ] Edit vendor → saves
- [ ] Disable/re-enable vendor
- [ ] CSV import → bulk create

---

## 10. Organization

### My Business Tab
- [ ] Load org profile (name, phone, website, license, tax ID, billing address)
- [ ] Edit and save → success message
- [ ] Logo upload (PNG/JPG/WebP, <2MB) → replaces previous
- [ ] Wrong file type → error
- [ ] File too large → error

### My Team Tab
- [ ] List all org members with role + status
- [ ] Change member role (dropdown) → saves, audit record created
- [ ] Deactivate member → saves
- [ ] Cannot edit own role/status
- [ ] Cannot remove/downgrade last active owner
- [ ] Invite new member → email sent with invite link

### Document Settings Tab
- [ ] Load invoice/estimate/CO terms and conditions
- [ ] Edit and save

---

## 11. Dashboard & Reporting

- [ ] Dashboard loads portfolio metrics (project count, AR/AP outstanding)
- [ ] Attention feed shows items needing action (overdue invoices, pending approvals)
- [ ] Change order impact summary renders
- [ ] Project breakdown shows per-project metrics

---

## 12. Onboarding

- [ ] Fresh org user sees /onboarding in toolbar dropdown
- [ ] Two tabs: "Individual Contractors" (4 steps) / "Remodelers/GCs" (6 steps)
- [ ] Auto-detects completed steps (customer created, project exists, etc.)
- [ ] Progress bar updates as steps complete
- [ ] Optional steps excluded from progress calculation
- [ ] Guide arrows point from steps to nav targets on hover
- [ ] Tab choice persists across page loads (localStorage)
- [ ] "Complete onboarding" marks org as onboarded

---

## 13. RBAC (cross-cutting)

Test with each role. Key denials to verify:

| Action | owner | pm | worker | bookkeeping | viewer |
|--------|-------|----|--------|-------------|--------|
| Edit org identity | yes | no | no | no | no |
| Invite users | yes | yes | no | no | no |
| Approve estimates | yes | yes | no | no | no |
| Send invoices | yes | yes | yes | no | no |
| Pay vendor bills | yes | yes | no | yes | no |
| Create customers | yes | yes | yes | yes | no |
| View anything | yes | yes | yes | yes | yes |

- [ ] Viewer cannot create/edit/approve/send anything
- [ ] Worker cannot approve or pay
- [ ] Bookkeeping cannot send estimates/COs
- [ ] PM cannot edit org identity (name, logo)
- [ ] Owner can do everything

---

## 14. Public Signing (OTP)

- [ ] Public document page loads without auth
- [ ] Click approve/reject → OTP form appears
- [ ] OTP email sent to customer (check Mailpit)
- [ ] Valid OTP + consent accepted → decision processed
- [ ] Invalid OTP → error
- [ ] Expired OTP → error
- [ ] OTP rate limited (60s between requests)
- [ ] Missing customer email → appropriate error

---

## 15. Cross-Cutting

### Org Scope Isolation
- [ ] User A's customers not visible to user B (different org)
- [ ] User A's projects not accessible by user B
- [ ] Public tokens are document-specific, not org-specific

### Print
- [ ] Print button works on estimates, invoices, COs, vendor bills
- [ ] Toolbar hidden in print
- [ ] Line items render correctly in print

### Navigation
- [ ] All nav links route correctly (Dashboard, Customers, Projects, Invoices, Bills)
- [ ] Org dropdown: Organization, Cost Codes, Vendors, Get Started
- [ ] Breadcrumbs show correct context on project-scoped pages
- [ ] Logout clears session, redirects to /login

### Email Delivery
- [ ] Registration verification email sends and contains correct link
- [ ] Password reset email sends and contains correct link
- [ ] Invite email sends and contains correct link
- [ ] Document sent emails fire on estimate/invoice/CO status change to sent/pending
- [ ] Emails include org name, document details, public link
