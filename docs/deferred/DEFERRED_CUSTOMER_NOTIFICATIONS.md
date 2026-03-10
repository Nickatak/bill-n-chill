# Customer Notifications

## SMS Support (Deferred)

### Context
Currently all customer-facing notifications (document sent emails for estimates, invoices, change orders) are email-only. SMS would be a differentiator — only Jobber has native SMS among construction SaaS competitors; Buildertrend, CoConstruct, JobTread, and Procore are all email-only.

### Scope
- SMS notifications when documents transition to sent/pending status
- Two-way SMS (Jobber model: text a link to the document portal)
- Follow-ups match original channel (if sent via SMS, reminders go via SMS)
- Phone number field already exists on Customer model (`phone`, optional)

### Blockers
- US A2P SMS requires 10DLC registration (brand + campaign approval)
- Carrier filtering, throughput caps, compliance automation
- Provider selection needed (Twilio, MessageBird, etc.)
- Cost model: per-message vs included in plan

### When to Revisit
Post-MVP. Email covers the majority use case. SMS becomes valuable once there's real user feedback requesting it.

---

## No-Email Customer Handling (MVP)

### Problem
When a document (estimate, invoice, change order) is transitioned to "sent" status and the customer has no email on file, the status change succeeds silently with no notification sent and no warning to the user. The user has no idea the customer was never notified.

### Current Behavior
- Customer `email` and `phone` are both optional (`blank=True`)
- Backend: `send_document_sent_email()` returns early if no email — no error, no log
- Frontend: Send button only checks RBAC permissions, not customer contact info
- Status transition succeeds regardless of email delivery

### Desired Behavior

**Frontend (pre-action warning):**
When the user selects a "sent" or "pending approval" status and the customer has no email on file, show a confirmation dialog before submitting:
> "This customer has no email on file. The status will update but no notification will be sent. Continue?"
Optionally include a link to the customer edit page.

**Backend (post-action response hint):**
Return `"email_sent": true/false` in the PATCH response for status transitions that trigger notifications. Frontend uses this to show a post-action toast:
> "Status updated. No email sent — customer has no email on file."

Both layers together: warn before, confirm after.

### Affected Endpoints
- `PATCH /api/v1/estimates/{id}/` (status → sent)
- `PATCH /api/v1/invoices/{id}/` (status → sent)
- `PATCH /api/v1/change-orders/{id}/` (status → pending_approval)

### Implementation Notes
- Frontend already has customer data in the editor state for all three document types
- Backend `send_document_sent_email()` could return a boolean indicating whether email was actually sent
- The confirmation dialog pattern already exists in the codebase (status change modals)
