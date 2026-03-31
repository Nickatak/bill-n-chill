# Backend Structural Index

_Auto-generated from `backend/core/`. Do not edit manually._
_Regenerate: `python scripts/generate_ai_index.py`_

## Sections
- [Core](#core)
- [Management Commands](#management-commands)
- [Models — Accounts Payable](#models-accounts-payable)
- [Models — Accounts Receivable](#models-accounts-receivable)
- [Models — Cash Management](#models-cash-management)
- [Models — Change Orders](#models-change-orders)
- [Models — Quoting](#models-quoting)
- [Models — Financial Auditing](#models-financial-auditing)
- [Models — Core](#models-core)
- [Models — Shared Operations](#models-shared-operations)
- [Policies](#policies)
- [Serializers](#serializers)
- [Tests](#tests)
- [Utils](#utils)
- [Views — Accounts Payable](#views-accounts-payable)
- [Views — Accounts Receivable](#views-accounts-receivable)
- [Views — Shared](#views-shared)
- [Views — Cash Management](#views-cash-management)
- [Views — Change Orders](#views-change-orders)
- [Views — Quoting](#views-quoting)
- [Views — Shared Operations](#views-shared-operations)

## Models — Shared Operations

### `backend/core/models/shared_operations/accounting_sync_event.py`
_AccountingSyncEvent model — operational sync-attempt log for external accounting integrations._

**class AccountingSyncEvent(models.Model)**
> Operational sync-attempt log for external accounting integrations.
- _class_ `Provider(models.TextChoices)` — QUICKBOOKS_ONLINE
- _class_ `Direction(models.TextChoices)` — PUSH, PULL
- _class_ `Status(models.TextChoices)` — QUEUED, SUCCESS, FAILED
- _class_ `Meta` — ordering
- `__str__()`


### `backend/core/models/shared_operations/cost_code.py`
_CostCode model — reusable financial classification for quoting and billing line items._

**class CostCode(models.Model)**
> Reusable financial classification used across quoting/budgeting/billing line items.
- _class_ `CostCodeQuerySet(models.QuerySet)` — 
- _class_ `Meta` — ordering, unique_together
- `seed_defaults(organization, created_by)` `@classmethod` — Seed the default cost codes for an organization.
- `__str__()`
- `delete(using, keep_parents)` — Raise ValidationError — cost codes are non-deletable by policy.


### `backend/core/models/shared_operations/customers.py`
_Customer model — mutable client/owner record anchoring projects and invoices._

**class Customer(models.Model)**
> Client/owner account that owns one or more projects.
- _class_ `Meta` — ordering
- `clean()` — Prevent archiving a customer with active or on-hold projects.
- `save()` — Run full_clean before persisting to enforce domain constraints.
- `build_snapshot()` — Point-in-time snapshot for immutable audit records.
- `__str__()`


### `backend/core/models/shared_operations/document_access_session.py`
_Document access session — OTP-verified sessions for public document decisions._

**class DocumentAccessSession(models.Model)**
> Tracks OTP verification and session state for public document decisions.
- _class_ `DocumentType(models.TextChoices)` — QUOTE, CHANGE_ORDER, INVOICE
- _class_ `Meta` — ordering
- `save()` — Auto-generate OTP code, session token, and expiry on initial save.
- `_generate_unique_code()` — Generate a 6-digit code unique among unexpired sessions for this document.
- `is_expired()` `@property` — True if the OTP code's expiry time has passed.
- `is_verified()` `@property` — True if the OTP has been successfully verified.
- `is_session_valid()` `@property` — True if the session is verified and hasn't expired.
- `lookup_for_verification(public_token, code)` `@classmethod` — Find a session by public_token + code and validate it's verifiable.
- `_record_failed_attempt(public_token)` `@classmethod` — Increment failed_attempts on the latest unverified session for this token.
- `lookup_valid_session(public_token, session_token)` `@classmethod` — Find a verified session by public_token + session_token.
- `__str__()`


### `backend/core/models/shared_operations/email_verification.py`
_Email verification models — token-based email ownership proof and audit trail._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class EmailVerificationToken(models.Model)**
> Time-limited token for verifying email ownership during registration.
- _class_ `Meta` — ordering
- `save()` — Auto-generate token and expiry if not already set, then persist.
- `is_expired()` `@property` — True if the token's expiry time has passed.
- `is_consumed()` `@property` — True if the token has already been used.
- `is_valid()` `@property` — True if the token is neither expired nor consumed.
- `lookup_valid(token_str)` `@classmethod` — Fetch a verification token and validate it's still usable.
- `__str__()`

**class PasswordResetToken(models.Model)**
> Time-limited token for password reset requests.
- _class_ `Meta` — ordering
- `save()` — Auto-generate token and expiry if not already set, then persist.
- `is_expired()` `@property` — True if the token's expiry time has passed.
- `is_consumed()` `@property` — True if the token has already been used.
- `is_valid()` `@property` — True if the token is neither expired nor consumed.
- `lookup_valid(token_str)` `@classmethod` — Fetch a password reset token and validate it's still usable.
- `__str__()`

**class EmailRecord(ImmutableModelMixin)**
> Immutable audit log for all transactional emails sent by the system.
- _class_ `EmailType(models.TextChoices)` — VERIFICATION, PASSWORD_RESET, OTP, DOCUMENT_SENT, DOCUMENT_DECISION
- _class_ `Meta` — ordering
- `record(recipient_email, email_type, subject, body_text, sent_by_user, metadata)` `@classmethod` — Append an immutable email audit record.
- `__str__()`


### `backend/core/models/shared_operations/impersonation.py`
_Impersonation token model — superuser-only identity assumption for support._

**class ImpersonationToken(models.Model)**
> Token that lets a superuser make requests as another user.
- _class_ `Meta` — ordering
- `save()` — Auto-generate key and expiry if not already set.
- `is_expired()` `@property` — True if the token's expiry time has passed.
- `__str__()`


### `backend/core/models/shared_operations/organization.py`
_Organization model — top-level tenant container for multi-user workspaces._

**class Organization(models.Model)**
> Top-level company/workspace container.
- _class_ `Meta` — ordering
- `formatted_billing_address()` `@property` — Format structured address fields into a multi-line display string.
- `build_snapshot()` — Build an immutable point-in-time snapshot dict for audit records.
- `derive_name(user)` `@classmethod` — Derive a human-friendly default organization name from a user's email or username.
- `__str__()`


### `backend/core/models/shared_operations/organization_invite.py`
_OrganizationInvite model — time-limited token for inviting users to an organization._

**Depends on:**
- `from core.models.shared_operations.organization_membership import OrganizationMembership`

**class OrganizationInvite(models.Model)**
> Time-limited invite token for joining an organization.
- _class_ `Meta` — ordering
- `save()` — Auto-generate token and expiry if not already set, then persist.
- `is_expired()` `@property` — True if the invite's expiry time has passed.
- `is_consumed()` `@property` — True if the invite has already been used.
- `is_valid()` `@property` — True if the invite is neither expired nor consumed.
- `lookup_valid(token_str)` `@classmethod` — Fetch an invite by token and validate it's still usable.
- `__str__()`


### `backend/core/models/shared_operations/organization_membership.py`
_OrganizationMembership model — user-to-org binding with RBAC role and capability flags._

**class OrganizationMembership(models.Model)**
> Current user-to-organization membership.
- _class_ `Role(models.TextChoices)` — OWNER, PM, WORKER, BOOKKEEPING, VIEWER
- _class_ `Status(models.TextChoices)` — ACTIVE, DISABLED
- _class_ `Meta` — ordering
- `build_snapshot()` — Build an immutable point-in-time snapshot dict for audit records.
- `__str__()`


### `backend/core/models/shared_operations/project.py`
_Project model — primary execution container for delivery and financial workflows._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`

**class Project(StatusTransitionMixin, models.Model)**
> Primary execution container for delivery and financial workflows.
- _class_ `Status(models.TextChoices)` — PROSPECT, ACTIVE, ON_HOLD, COMPLETED, CANCELLED
- _class_ `Meta` — ordering, constraints
- `__str__()`
- `clean()` — Validate status transitions, uniqueness, and prevent activation under an archived customer.
- `save()` — Run full_clean before persisting to enforce domain constraints.


### `backend/core/models/shared_operations/push_subscription.py`
_PushSubscription model — stores Web Push API subscriptions per user/device._

**class PushSubscription(models.Model)**
> A Web Push subscription for delivering background notifications.
- _class_ `Meta` — ordering
- `save()` — Auto-compute endpoint_hash before saving.
- `to_webpush_dict()` — Return the subscription info dict expected by pywebpush.
- `__str__()`


### `backend/core/models/shared_operations/role_template.py`
_RoleTemplate model — preset or custom role definition with capability flags for RBAC._

**class RoleTemplate(models.Model)**
> Preset/custom role definition with capability flags.
- _class_ `Meta` — ordering
- `__str__()`


### `backend/core/models/shared_operations/signing_ceremony.py`
_Signing ceremony record — immutable audit artifact for public document decisions._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`
- `from core.models.shared_operations.document_access_session import DocumentAccessSession`

**class SigningCeremonyRecord(ImmutableModelMixin)**
> Immutable audit artifact created when a customer signs a public document.
- _class_ `Meta` — ordering
- `record(document_type, document_id, public_token, decision, signer_name, signer_email, email_verified, content_hash, ip_address, user_agent, consent_text_version, consent_text_snapshot, note, access_session, metadata)` `@classmethod` — Create an immutable signing ceremony audit record.
- `__str__()`


### `backend/core/models/shared_operations/vendor.py`
_Vendor model — org-scoped payee record for accounts payable._

**class Vendor(models.Model)**
> Org-scoped payee record used for AP bills and quick expenses.
- _class_ `Meta` — ordering
- `get_or_create_by_name(organization_id, name, created_by)` `@classmethod` — Find or create a Vendor by name within an org (case-insensitive).
- `__str__()`


## Models — Quoting

### `backend/core/models/quoting/quote.py`
_Quote model — mutable operational record for customer-facing project cost proposals._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`
- `from core.utils.tokens import generate_public_token`

**class Quote(StatusTransitionMixin, models.Model)**
> Customer-facing scope and price proposal for a project.
- _class_ `Status(models.TextChoices)` — DRAFT, SENT, APPROVED, REJECTED, VOID, ARCHIVED
- _class_ `Meta` — ordering, unique_together
- `__str__()`
- `public_slug()` `@property` — URL-safe slug derived from the quote title.
- `public_ref()` `@property` — Combined slug--token identifier for public sharing URLs.
- `clean()` — Validate status transitions before save.
- `save()` — Auto-generate public token if missing, then validate and persist.


### `backend/core/models/quoting/quote_line_item.py`
_QuoteLineItem model — individual priced scope row within an quote version._

**class QuoteLineItem(models.Model)**
> Customer-facing priced scope row inside an quote version.
- _class_ `Meta` — ordering
- `__str__()`


## Models — Change Orders

### `backend/core/models/change_orders/change_order.py`
_ChangeOrder model — post-baseline contract delta request for scope, time, and cost changes._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`
- `from core.utils.tokens import generate_public_token`

**class ChangeOrder(StatusTransitionMixin, models.Model)**
> Post-baseline contract delta request for scope/time/cost changes.
- _class_ `Status(models.TextChoices)` — DRAFT, SENT, APPROVED, REJECTED, VOID
- _class_ `Meta` — ordering, unique_together, constraints, indexes
- `__str__()`
- `public_slug()` `@property` — URL-safe slug derived from family key.
- `public_ref()` `@property` — Combined slug--token identifier for public sharing URLs.
- `clean()` — Validate approval fields, origin quote, and status transitions.
- `build_snapshot()` — Point-in-time snapshot for immutable audit records.
- `save()` — Auto-generate public token if missing, then validate and persist.


### `backend/core/models/change_orders/change_order_line.py`
_ChangeOrderLine model — line-level cost/schedule delta for a change order._

**class ChangeOrderLine(models.Model)**
> Line-level change-order delta.
- _class_ `Meta` — ordering
- `__str__()`


## Models — Accounts Receivable

### `backend/core/models/accounts_receivable/invoice.py`
_Invoice and InvoiceLine models — customer-facing AR billing artifacts._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`
- `from core.utils.tokens import generate_public_token`

**class Invoice(StatusTransitionMixin, models.Model)**
> Customer-facing AR invoice issued to the project customer.
- _class_ `Status(models.TextChoices)` — DRAFT, SENT, OUTSTANDING, CLOSED, VOID
- _class_ `Meta` — ordering, unique_together, constraints
- `__str__()`
- `public_slug()` `@property` — URL-safe slug derived from the invoice number.
- `public_ref()` `@property` — Combined slug--token identifier for public sharing URLs.
- `clean()` — Validate dates, balance, customer-project match, and status transitions.
- `save()` — Auto-generate public token, then validate and persist.

**class InvoiceLine(models.Model)**
> Individual billed scope line included on a customer invoice.
- _class_ `Meta` — ordering
- `__str__()`


## Models — Accounts Payable

### `backend/core/models/accounts_payable/vendor_bill.py`
_VendorBill and VendorBillLine models — AP bills from vendors._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`

**class VendorBill(StatusTransitionMixin, models.Model)**
> AP bill or quick expense — inbound payable document.
- _class_ `Status(models.TextChoices)` — OPEN, DISPUTED, CLOSED, VOID
- _class_ `Meta` — ordering, constraints
- `__str__()`
- `clean()` — Validate date constraints and status transitions.
- `build_snapshot()` — Point-in-time snapshot for immutable audit records.
- `save()` — Run full_clean before persisting to enforce domain constraints.

**class VendorBillLine(models.Model)**
> Individual line item on a vendor bill.
- _class_ `Meta` — ordering
- `__str__()`
- `save()` — Compute amount = quantity × unit_price before persisting.


## Models — Cash Management

### `backend/core/models/cash_management/payment.py`
_Payment model — cash movement records linked directly to AR/AP documents._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`

**class Payment(StatusTransitionMixin, models.Model)**
> Recorded money movement at the organization level (AR inbound or AP outbound).
- _class_ `Direction(models.TextChoices)` — INBOUND, OUTBOUND
- _class_ `Method(models.TextChoices)` — CHECK, ZELLE, ACH, CASH, WIRE, CARD, OTHER
- _class_ `Status(models.TextChoices)` — PENDING, SETTLED, VOID
- _class_ `TargetType(models.TextChoices)` — INVOICE, VENDOR_BILL
- _class_ `Meta` — ordering
- `target_id()` `@property` — Return the ID of the linked target document.
- `clean()` — Validate status transitions and target consistency.
- `save()` — Run full_clean before persisting to enforce domain constraints.
- `build_snapshot()` — Point-in-time snapshot for immutable audit records.
- `__str__()`


## Models — Financial Auditing

### `backend/core/models/financial_auditing/accounting_sync_record.py`
_AccountingSyncRecord model — immutable audit capture for accounting sync lifecycle events._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class AccountingSyncRecord(ImmutableModelMixin)**
> Immutable audit record for accounting synchronization lifecycle captures.
- _class_ `EventType(models.TextChoices)` — CREATED, STATUS_CHANGED, RETRIED, IMPORTED, SYNCED
- _class_ `CaptureSource(models.TextChoices)` — MANUAL_UI, MANUAL_API, JOB_RUNNER, WEBHOOK, SYSTEM
- _class_ `Meta` — ordering
- `__str__()`


### `backend/core/models/financial_auditing/change_order_snapshot.py`
_ChangeOrderSnapshot model — immutable point-in-time capture for change-order decisions._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class ChangeOrderSnapshot(ImmutableModelMixin)**
> Immutable financial-audit snapshot for decision outcomes on a change order.
- _class_ `DecisionStatus(models.TextChoices)` — APPROVED, REJECTED, VOID
- _class_ `Meta` — ordering
- `record(change_order, decision_status: str, previous_status: str, applied_financial_delta, decided_by, ip_address, user_agent)` `@classmethod` — Append an immutable snapshot row for a change-order decision event.
- `__str__()`


### `backend/core/models/financial_auditing/change_order_status_event.py`
_ChangeOrderStatusEvent model — immutable audit trail of change-order status transitions._

**class ChangeOrderStatusEvent(models.Model)**
> Audit trail of change-order status transitions.
- _class_ `Meta` — ordering
- `record(change_order, from_status, to_status, note, changed_by, ip_address, user_agent)` `@classmethod` — Append an immutable change-order status transition row.
- `__str__()`


### `backend/core/models/financial_auditing/customer_record.py`
_CustomerRecord model — immutable audit capture for customer lifecycle events._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class CustomerRecord(ImmutableModelMixin)**
> Immutable audit capture for customer lifecycle events.
- _class_ `EventType(models.TextChoices)` — CREATED, UPDATED, DELETED
- _class_ `CaptureSource(models.TextChoices)` — MANUAL_UI, MANUAL_API, IMPORT, SYSTEM
- _class_ `Meta` — ordering
- `record(customer, event_type: str, capture_source: str, recorded_by, source_reference: str, note: str, metadata: dict | None)` `@classmethod` — Append an immutable audit row for a customer mutation.
- `__str__()`


### `backend/core/models/financial_auditing/quote_status_event.py`
_QuoteStatusEvent model — immutable audit trail of quote status transitions._

**class QuoteStatusEvent(models.Model)**
> Audit trail of quote status transitions.
- _class_ `Meta` — ordering
- `record(quote, from_status, to_status, note, changed_by, ip_address, user_agent)` `@classmethod` — Append an immutable quote status transition row.
- `__str__()`


### `backend/core/models/financial_auditing/invoice_status_event.py`
_InvoiceStatusEvent model — immutable audit trail of invoice status transitions._

**class InvoiceStatusEvent(models.Model)**
> Audit trail of invoice status transitions.
- _class_ `Meta` — ordering
- `record(invoice, from_status, to_status, note, changed_by, ip_address, user_agent)` `@classmethod` — Append an immutable invoice status transition row.
- `__str__()`


### `backend/core/models/financial_auditing/lead_contact_record.py`
_LeadContactRecord model — immutable audit capture for customer-intake lifecycle events._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class LeadContactRecord(ImmutableModelMixin)**
> Immutable audit capture for customer-intake lifecycle and conversion events.
- _class_ `EventType(models.TextChoices)` — CREATED, UPDATED, STATUS_CHANGED, CONVERTED, DELETED
- _class_ `CaptureSource(models.TextChoices)` — MANUAL_UI, MANUAL_API, IMPORT, SYSTEM
- _class_ `Meta` — ordering
- `record(snapshot_json: dict, event_type: str, capture_source: str, recorded_by, intake_record_id: int | None, source_reference: str, note: str, metadata: dict | None)` `@classmethod` — Append an immutable audit row for a customer-intake event.
- `__str__()`


### `backend/core/models/financial_auditing/organization_membership_record.py`
_OrganizationMembershipRecord model — immutable audit capture for membership and role changes._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class OrganizationMembershipRecord(ImmutableModelMixin)**
> Immutable audit capture for membership lifecycle and role changes.
- _class_ `EventType(models.TextChoices)` — CREATED, STATUS_CHANGED, ROLE_CHANGED, ROLE_TEMPLATE_CHANGED, CAPABILITY_FLAGS_UPDATED
- _class_ `CaptureSource(models.TextChoices)` — AUTH_BOOTSTRAP, MANUAL_UI, MANUAL_API, SYSTEM
- _class_ `Meta` — ordering
- `record(membership, event_type: str, capture_source: str, recorded_by, from_status: str | None, to_status: str | None, from_role: str, to_role: str, source_reference: str, note: str, metadata: dict | None)` `@classmethod` — Append an immutable audit row for a membership mutation.
- `__str__()`


### `backend/core/models/financial_auditing/organization_record.py`
_OrganizationRecord model — immutable audit capture for organization lifecycle events._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class OrganizationRecord(ImmutableModelMixin)**
> Immutable audit capture for organization lifecycle events.
- _class_ `EventType(models.TextChoices)` — CREATED, UPDATED
- _class_ `CaptureSource(models.TextChoices)` — AUTH_BOOTSTRAP, MANUAL_UI, MANUAL_API, SYSTEM
- _class_ `Meta` — ordering
- `record(organization, event_type: str, capture_source: str, recorded_by, source_reference: str, note: str, metadata: dict | None)` `@classmethod` — Append an immutable audit row for an organization mutation.
- `__str__()`


### `backend/core/models/financial_auditing/payment_record.py`
_PaymentRecord model — immutable audit capture for payment lifecycle and provenance._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class PaymentRecord(ImmutableModelMixin)**
> Immutable audit record for payment lifecycle and provenance captures.
- _class_ `EventType(models.TextChoices)` — CREATED, UPDATED, STATUS_CHANGED, ALLOCATION_APPLIED
- _class_ `CaptureSource(models.TextChoices)` — MANUAL_UI, MANUAL_API, SYSTEM
- _class_ `Meta` — ordering
- `record(payment, event_type: str, capture_source: str, recorded_by, from_status: str | None, to_status: str | None, source_reference: str, note: str, metadata: dict | None)` `@classmethod` — Append an immutable audit row for a payment mutation.
- `__str__()`


### `backend/core/models/financial_auditing/vendor_bill_snapshot.py`
_VendorBillSnapshot model — immutable point-in-time capture for vendor-bill status transitions._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class VendorBillSnapshot(ImmutableModelMixin)**
> Immutable AP document lifecycle snapshot for vendor-bill status transitions.
- _class_ `CaptureStatus(models.TextChoices)` — OPEN, DISPUTED, CLOSED, VOID
- _class_ `Meta` — ordering
- `record(vendor_bill, capture_status: str, previous_status: str, acted_by, status_note)` `@classmethod` — Append an immutable snapshot row for a vendor-bill status transition.
- `__str__()`


## Models — Core

### `backend/core/models/mixins.py`
_Reusable model mixins for cross-cutting concerns._

**class ImmutableQuerySet(models.QuerySet)**
> QuerySet that prevents bulk deletion of immutable records.
- `delete()`

**class ImmutableModelMixin(models.Model)**
> Abstract base for append-only audit/capture models.
- _class_ `Meta` — abstract
- `save()`
- `delete(using, keep_parents)`

**class StatusTransitionMixin**
> Mixin for models with ``ALLOWED_STATUS_TRANSITIONS`` and a ``status`` field.
- `is_transition_allowed(current_status: str, next_status: str)` `@classmethod`
- `validate_status_transition(errors: dict)` — Append a status-transition error to *errors* if the transition is invalid.


## Serializers

### `backend/core/serializers/accounting.py`
_Accounting sync event serializers for external provider integration tracking._

**Depends on:**
- `from core.models import AccountingSyncEvent`

**class AccountingSyncEventSerializer(serializers.ModelSerializer)**
> Read-only accounting sync event with project name.
- _class_ `Meta` — model, fields, read_only_fields

**class AccountingSyncEventWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating accounting sync events.


### `backend/core/serializers/auth.py`
_Authentication serializers for login and registration._

**class LoginSerializer(serializers.Serializer)**
> Write serializer for email/password login.
- `validate(attrs)`

**class RegisterSerializer(serializers.Serializer)**
> Write serializer for new user registration.
- `validate_email(value: str)`


### `backend/core/serializers/change_orders.py`
_Change order serializers for read, write, and line item representations._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderLine, ChangeOrderStatusEvent`
- `from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display`

**class ChangeOrderLineSerializer(serializers.ModelSerializer)**
> Read-only change order line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class ChangeOrderSerializer(serializers.ModelSerializer)**
> Read-only change order with nested line items.
- _class_ `Meta` — model, fields, read_only_fields
- `get_line_total_delta(obj)` — Return the sum of all line item amount deltas as a decimal string.

**class ChangeOrderLineInputSerializer(serializers.Serializer)**
> Write serializer for a single change order line item in a create/update payload.

**class ChangeOrderWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating a change order with line items.

**class ChangeOrderStatusEventSerializer(serializers.ModelSerializer)**
> Read-only CO status event with computed action type and actor display.
- _class_ `Meta` — model, fields, read_only_fields
- `get_action_type(obj: ChangeOrderStatusEvent)` — Classify the event as create, transition, resend, notate, or unchanged.
- `get_changed_by_display(obj: ChangeOrderStatusEvent)` — Return a human-readable display name for the actor who changed the status.
- `get_changed_by_customer_id(obj: ChangeOrderStatusEvent)` — Return the customer ID if the actor acted via a public token.

- `_change_order_customer(obj: ChangeOrderStatusEvent)` — Navigate from a CO status event to the associated Customer.

### `backend/core/serializers/customers.py`
_Customer intake and management serializers for CRUD and quick-add flows._

**Depends on:**
- `from core.models import Customer, Project`

**class CustomerIntakeQuickAddSerializer(serializers.Serializer)**
> Write serializer for the quick-add customer intake flow.
- `validate(attrs)`

**class CustomerManageSerializer(serializers.ModelSerializer)**
> Read/write customer representation for the management console.
- _class_ `Meta` — model, fields, read_only_fields
- `validate(attrs)`

**class CustomerSerializer(serializers.ModelSerializer)**
> Lightweight read-only customer representation for nested/reference use.
- _class_ `Meta` — model, fields

**class CustomerProjectCreateSerializer(serializers.Serializer)**
> Write serializer for creating a project under an existing customer.

- `_is_valid_email(value: str)` — Return whether value passes Django email validation.
- `_is_valid_phone(value: str)` — Return whether value matches allowed phone number format (7-15 digits).

### `backend/core/serializers/quotes.py`
_Quote serializers for read, write, duplication, and status-event representations._

**Depends on:**
- `from core.models import Quote, QuoteLineItem, QuoteStatusEvent`
- `from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display`

**class QuoteLineItemSerializer(serializers.ModelSerializer)**
> Read-only quote line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class QuoteSerializer(serializers.ModelSerializer)**
> Read-only quote with nested line items.
- _class_ `Meta` — model, fields, read_only_fields

**class QuoteStatusEventSerializer(serializers.ModelSerializer)**
> Read-only quote status event with computed action type and actor display.
- _class_ `Meta` — model, fields, read_only_fields
- `get_action_type(obj: QuoteStatusEvent)` — Classify the event as create, transition, resend, notate, or unchanged.
- `get_changed_by_display(obj: QuoteStatusEvent)` — Return a human-readable display name for the actor who changed the status.
- `get_changed_by_customer_id(obj: QuoteStatusEvent)` — Return the customer ID if the actor acted via a public token.

**class QuoteLineItemInputSerializer(serializers.Serializer)**
> Write serializer for a single quote line item in a create/update payload.

**class QuoteWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating an quote with line items.
- `validate_title(value: str)`
- `validate_status(value: str)`

- `_quote_customer(obj)` — Return the customer associated with the status event's quote project.

### `backend/core/serializers/invoices.py`
_Invoice serializers for read, write, and status-event representations._

**Depends on:**
- `from core.models import Invoice, InvoiceLine, InvoiceStatusEvent, Payment`
- `from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display`

**class InvoiceLineSerializer(serializers.ModelSerializer)**
> Read-only invoice line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class InvoicePaymentSerializer(serializers.ModelSerializer)**
> Read-only payment summary for display on invoice detail.
- _class_ `Meta` — model, fields, read_only_fields

**class InvoiceSerializer(serializers.ModelSerializer)**
> Read-only invoice with nested line items and customer display name.
- _class_ `Meta` — model, fields, read_only_fields

**class InvoiceLineItemInputSerializer(serializers.Serializer)**
> Write serializer for a single invoice line item in a create/update payload.

**class InvoiceWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating an invoice with line items.

**class InvoiceStatusEventSerializer(serializers.ModelSerializer)**
> Read-only invoice status event with computed action type and actor display.
- _class_ `Meta` — model, fields, read_only_fields
- `get_action_type(obj: InvoiceStatusEvent)` — Classify the event as create, transition, resend, notate, or unchanged.
- `get_changed_by_display(obj: InvoiceStatusEvent)` — Return a human-readable display name for the actor who changed the status.
- `get_changed_by_customer_id(obj: InvoiceStatusEvent)` — Return the customer ID if the actor acted via a public token.

- `_invoice_customer(obj)` — Return the customer associated with the status event's invoice.

### `backend/core/serializers/mixins.py`
_Shared helpers for serializer method fields._

- `_is_public_decision(obj: Any)` — Return True if the event represents a customer action via a public link.
- `resolve_public_actor_display(obj: Any, actor_field: str, customer_fn: Callable[[Any], Any])` — Resolve a human-readable display name for the actor on an event.
- `resolve_public_actor_customer_id(obj: Any, customer_fn: Callable[[Any], Any])` — Return the customer PK when the event is a public decision, else None.

### `backend/core/serializers/organization_management.py`
_Organization profile, membership, and invite serializers._

**Depends on:**
- `from core.models import Organization, OrganizationInvite, OrganizationMembership`

**class OrganizationProfileSerializer(serializers.ModelSerializer)**
> Read-only organization profile with branding and document presets.
- _class_ `Meta` — model, fields, read_only_fields
- `get_logo_url(obj: Organization)` — Return the absolute URL for the uploaded logo, or empty string.

**class OrganizationMembershipSerializer(serializers.ModelSerializer)**
> Read-only membership representation with computed user display fields.
- _class_ `Meta` — model, fields, read_only_fields
- `get_user_full_name(obj: OrganizationMembership)` — Return the member's full name, falling back to username or email.
- `get_is_current_user(obj: OrganizationMembership)` — Return whether this membership belongs to the requesting user.

**class OrganizationProfileUpdateSerializer(serializers.Serializer)**
> Write serializer for partial updates to organization profile fields.
- `validate(attrs)`

**class OrganizationMembershipUpdateSerializer(serializers.Serializer)**
> Write serializer for updating a member's role or status.
- `validate(attrs)`

**class OrganizationInviteSerializer(serializers.ModelSerializer)**
> Read serializer for listing pending invites.
- _class_ `Meta` — model, fields, read_only_fields
- `get_role_template_name(obj: OrganizationInvite)`

**class OrganizationInviteCreateSerializer(serializers.Serializer)**
> Write serializer for creating an invite.


### `backend/core/serializers/payments.py`
_Payment serializers for read and write flows._

**Depends on:**
- `from core.models import Payment`

**class PaymentSerializer(serializers.ModelSerializer)**
> Read-only payment with target document info.
- _class_ `Meta` — model, fields, read_only_fields
- `get_customer_name(obj: Payment)` — Return customer display name or empty string.
- `get_project_name(obj: Payment)` — Return project name or empty string for unassigned payments.
- `get_target_id(obj: Payment)` — Return the linked document ID.

**class PaymentWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating a payment.


### `backend/core/serializers/projects.py`
_Project, cost code, financial summary, portfolio, and dashboard serializers._

**Depends on:**
- `from core.models import CostCode, Project`

**class ProjectSerializer(serializers.ModelSerializer)**
> Read-only project representation with customer display fields.
- _class_ `Meta` — model, fields

**class ProjectProfileSerializer(serializers.ModelSerializer)**
> Read/write project profile for editing name, address, status, and contract values.
- _class_ `Meta` — model, fields, read_only_fields

**class CostCodeSerializer(serializers.ModelSerializer)**
> Read/write cost code representation.
- _class_ `Meta` — model, fields
- `validate(attrs)`

**class ProjectFinancialSummarySerializer(serializers.Serializer)**
> Read-only financial summary for a single project with AR/AP breakdowns.

**class PortfolioProjectSnapshotSerializer(serializers.Serializer)**
> Read-only per-project snapshot within a portfolio summary.

**class PortfolioSnapshotSerializer(serializers.Serializer)**
> Read-only cross-project portfolio summary with aggregate AR/AP totals.

**class ChangeImpactProjectSerializer(serializers.Serializer)**
> Read-only per-project change order impact breakdown.

**class ChangeImpactSummarySerializer(serializers.Serializer)**
> Read-only cross-project change order impact summary.

**class AttentionFeedItemSerializer(serializers.Serializer)**
> Read-only single attention feed item (overdue, upcoming, or action-needed).

**class AttentionFeedSerializer(serializers.Serializer)**
> Read-only attention feed with prioritized action items across projects.

**class QuickJumpItemSerializer(serializers.Serializer)**
> Read-only single quick-jump search result entry.

**class QuickJumpSearchSerializer(serializers.Serializer)**
> Read-only quick-jump search response with matched items.

**class ProjectTimelineItemSerializer(serializers.Serializer)**
> Read-only single project timeline event (financial or workflow).

**class ProjectTimelineSerializer(serializers.Serializer)**
> Read-only project timeline response with chronological event items.


### `backend/core/serializers/vendor_bills.py`
_Vendor bill serializers for read, write, and line item representations._

**Depends on:**
- `from core.models import Payment, VendorBill, VendorBillLine, VendorBillSnapshot`

**class VendorBillPaymentSerializer(serializers.ModelSerializer)**
> Read-only payment summary for display on vendor bill detail.
- _class_ `Meta` — model, fields, read_only_fields

**class VendorBillLineSerializer(serializers.ModelSerializer)**
> Read-only vendor bill line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class VendorBillSerializer(serializers.ModelSerializer)**
> Read-only vendor bill with nested line items, vendor/project names, and derived payment status.
- _class_ `Meta` — model, fields, read_only_fields
- `get_vendor_name(obj)` — Return vendor name, falling back to empty string for expenses.
- `get_payment_status(obj)` — Derive payment status from payment coverage.

**class VendorBillSnapshotSerializer(serializers.ModelSerializer)**
> Read-only vendor bill snapshot with computed action type and actor display.
- _class_ `Meta` — model, fields, read_only_fields
- `get_action_type(obj: VendorBillSnapshot)` — Classify the snapshot as transition, notate, or unchanged.
- `get_acted_by_display(obj: VendorBillSnapshot)` — Return a human-readable display name for the actor.

**class VendorBillLineInputSerializer(serializers.Serializer)**
> Write serializer for a single vendor bill line item (description, quantity × unit_price).

**class VendorBillWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating a vendor bill with line items.


### `backend/core/serializers/vendors.py`
_Vendor serializers for read and write representations._

**Depends on:**
- `from core.models import Vendor`

**class VendorSerializer(serializers.ModelSerializer)**
> Read-only vendor representation.
- _class_ `Meta` — model, fields, read_only_fields

**class VendorWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating a vendor.
- `validate_tax_id_last4(value)`


## Policies

### `backend/core/policies/_base.py`
_Shared base builder for policy contract dicts._

- `_build_base_policy_contract(model_class: type, policy_version: str, default_create_status: str, extra_transitions: dict[str, list[str]] | None, extra_fields: dict[str, Any] | None)` — Build the standard policy contract dict shared across all workflow domains.

### `backend/core/policies/change_orders.py`
_Change-order policy contracts shared with UI consumers._

**Depends on:**
- `from core.models import ChangeOrder`

- `_status_order()`
- `get_change_order_policy_contract()` — Return the canonical change-order workflow policy for UI consumers.

### `backend/core/policies/quotes.py`
_Quote policy contracts shared with UI consumers._

**Depends on:**
- `from core.models import Quote`
- `from core.policies._base import _build_base_policy_contract`

- `get_quote_policy_contract()` — Return canonical quote workflow policy for UI consumers.

### `backend/core/policies/invoices.py`
_Invoice policy contracts shared with UI consumers._

**Depends on:**
- `from core.models import Invoice`
- `from core.policies._base import _build_base_policy_contract`

- `get_invoice_policy_contract()` — Return canonical invoice workflow policy for UI consumers.

### `backend/core/policies/payments.py`
_Payment policy contracts shared with UI consumers._

**Depends on:**
- `from core.models import Payment`
- `from core.policies._base import _build_base_policy_contract`

- `get_payment_policy_contract()` — Return canonical payment workflow policy for UI consumers.

### `backend/core/policies/vendor_bills.py`
_Vendor-bill policy contracts shared with UI consumers._

**Depends on:**
- `from core.models import VendorBill`
- `from core.policies._base import _build_base_policy_contract`

- `get_vendor_bill_policy_contract()` — Return canonical vendor-bill workflow policy for UI consumers.

## Views — Shared

### `backend/core/views/auth.py`
_Authentication and registration views with invite-flow support._

**Depends on:**
- `from core.models import EmailVerificationToken, ImpersonationToken, OrganizationInvite, OrganizationMembership, OrganizationMembershipRecord, PasswordResetToken`
- `from core.serializers import LoginSerializer, RegisterSerializer`
- `from core.user_helpers import _ensure_org_membership`
- `from core.views.auth_helpers import _RESET_ERROR_MAP, _VERIFY_ERROR_MAP, _build_auth_response_payload, _lookup_valid_invite, _send_duplicate_registration_email, _send_rate_limited_token_email`

- `health_view(_request)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Health probe endpoint used by infra and local readiness checks.
- `login_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Authenticate credentials and return token + role/org context.
- `register_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Register a new user account, with optional invite-based fast-track.
- `me_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the current user's profile with resolved role and org context.
- `check_invite_by_email_view()` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Check if a pending invite exists for the given email.
- `verify_invite_view(token)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Verify an invite token and return context for the registration page.
- `accept_invite_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Accept an invite as an existing user (Flow C).
- `verify_email_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Consume an email verification token and authenticate the user.
- `resend_verification_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Resend a verification email (or password reset if already verified).
- `forgot_password_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Request a password reset email (or verification if not yet verified).
- `reset_password_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Consume a password reset token and set a new password.
- `impersonate_start_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Start an impersonation session for a target user (superuser-only).
- `impersonate_exit_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — End the current impersonation session.
- `impersonate_users_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List users available for impersonation (superuser-only).

### `backend/core/views/auth_helpers.py`
_Shared helpers for authentication and registration views._

**Depends on:**
- `from core.models import EmailVerificationToken, OrganizationInvite, OrganizationMembership, PasswordResetToken`
- `from core.user_helpers import _resolve_user_capabilities`

- `_build_auth_response_payload(user: AbstractUser, membership: OrganizationMembership)` — Build the standard auth response payload dict.
- `_lookup_valid_invite(token_str: str)` — Look up a valid invite token, returning (invite, error_response).
- `_send_rate_limited_token_email(user: AbstractUser, token_model: type[models.Model], task_name: str)` — Create a token and queue an async email, respecting a 60-second rate limit.
- `_send_duplicate_registration_email(user: AbstractUser)` — Send a contextual email when someone tries to register with an existing email.

### `backend/core/views/helpers.py`
_Cross-domain shared helpers and re-exports for the view layer._

**Depends on:**
- `from core.models import CostCode, Quote, Organization, OrganizationMembership, Project`
- `from core.rbac import _capability_gate`
- `from core.user_helpers import _ensure_org_membership`

- `_validate_project_for_user(project_id: int, user: AbstractUser)` — Look up a project by ID, scoped to the user's organization.
- `_validate_quote_for_user(quote_id: int, user: AbstractUser, prefetch_lines: bool)` — Look up an quote by ID, authorized via its project's org scope.
- `_promote_prospect_to_active(project: Project)` — Silently promote a prospect project to active.
- `_resolve_organization_for_public_actor(actor_user: AbstractUser)` — Resolve the primary organization for a public-facing actor user.
- `_serialize_public_organization_context(organization: Organization | None)` — Serialize organization branding fields for public-facing document contexts.
- `_serialize_public_project_context(project: Project)` — Serialize project and customer fields for public-facing document contexts.
- `_paginate_queryset(queryset: QuerySet, query_params: dict[str, Any], default_page_size: int, max_page_size: int)` — Apply page/page_size pagination to a queryset.
- `_parse_request_bool(raw_value: Any, default: bool)` — Coerce a loosely-typed request value to a boolean.
- `_normalized_phone(value: str)` — Strip a phone string to digits only (for duplicate-detection comparisons).
- `_build_public_decision_note(action_label: str, note: str, decider_name: str, decider_email: str)` — Build a human-readable note for a public-link decision (approve/reject/dispute).
- `_org_scope_filter(user: AbstractUser)` — Build a Q filter scoped to the given user's organization.
- `_resolve_cost_codes_for_user(user: AbstractUser, line_items_data: list[dict[str, Any]], cost_code_key: str)` — Resolve and validate cost code IDs from line item data for the user's org scope.
- `_check_project_accepts_document(project: Project, document_type: str)` — Guard against creating new documents on terminal-status projects.
- `_not_found_response(message: str)` — Return a standard 404 error response.

### `backend/core/views/public_signing.py`
_Public document signing — OTP request and verification views._

**Depends on:**
- `from core.models import DocumentAccessSession`
- `from core.models.shared_operations.document_access_session import SESSION_EXPIRY_MINUTES`
- `from core.utils.signing import mask_email`
- `from core.views.public_signing_helpers import _DOCUMENT_TYPE_LABELS, _VERIFY_ERROR_MAP, _resolve_document_and_email, _resolve_document_title`

- `public_request_otp_view(document_type, public_token)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Request a 6-digit OTP code for public document identity verification.
- `public_verify_otp_view(document_type, public_token)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Verify a 6-digit OTP code and activate a 1-hour signing session.

### `backend/core/views/public_signing_helpers.py`
_Shared helpers for public document signing views._

**Depends on:**
- `from core.models import ChangeOrder, DocumentAccessSession, Quote, Invoice`
- `from core.utils.signing import CEREMONY_CONSENT_TEXT, CEREMONY_CONSENT_TEXT_VERSION`

- `_resolve_document_and_email(document_type: str, public_token: str)` — Look up a document by type + public_token and extract the customer email.
- `_resolve_document_title(document_type: str, document: models.Model)` — Extract a human-readable title from a document for OTP email context.
- `validate_ceremony_on_decision(public_token: str, customer_email: str)` — Gate-check called by each ``public_*_decision_view`` before executing
- `get_ceremony_context()` — Return the current consent text and its SHA-256 version hash.

### `backend/core/views/push.py`
_Push subscription management endpoints._

**Depends on:**
- `from core.models.shared_operations.push_subscription import PushSubscription`

- `push_subscribe_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Register or update a push subscription for the current user.
- `push_unsubscribe_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Remove a push subscription for the current user.
- `push_status_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Check if the current user has any active push subscriptions.

## Views — Shared Operations

### `backend/core/views/shared_operations/accounting.py`
_Shared operational accounting sync endpoints._

**Depends on:**
- `from core.models import AccountingSyncEvent, AccountingSyncRecord`
- `from core.serializers import AccountingSyncEventSerializer, AccountingSyncEventWriteSerializer`
- `from core.views.helpers import _capability_gate, _ensure_org_membership, _validate_project_for_user`
- `from core.views.shared_operations.accounting_helpers import _record_accounting_sync_record`

- `project_accounting_sync_events_view(project_id)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project accounting sync events or enqueue a new sync event.
- `accounting_sync_event_retry_view(sync_event_id)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Retry a failed accounting sync event by resetting it to ``queued``.

### `backend/core/views/shared_operations/accounting_helpers.py`
_Domain-specific helpers for accounting sync views._

**Depends on:**
- `from core.models import AccountingSyncEvent, AccountingSyncRecord`

- `_build_accounting_sync_snapshot(sync_event: AccountingSyncEvent)` — Serialize an accounting sync event into an immutable snapshot dict.
- `_record_accounting_sync_record(sync_event: AccountingSyncEvent, event_type: str, capture_source: str, recorded_by: AbstractUser, from_status: str | None, to_status: str | None, source_reference: str, note: str, metadata: dict[str, Any] | None)` — Create an immutable ``AccountingSyncRecord`` with a point-in-time snapshot.

### `backend/core/views/shared_operations/cost_codes.py`
_Shared operational cost-code endpoints._

**Depends on:**
- `from core.models import CostCode`
- `from core.serializers import CostCodeSerializer`
- `from core.views.helpers import _ensure_org_membership, _capability_gate`
- `from core.views.shared_operations.cost_codes_helpers import _org_scope_filter, _duplicate_code_error_response`

- `cost_codes_list_create_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List organization-scoped cost codes or create a new one.
- `cost_code_detail_view(cost_code_id)` `@api_view(['PATCH'])` `@permission_classes([IsAuthenticated])` — Update mutable cost-code fields (name, is_active).

### `backend/core/views/shared_operations/cost_codes_helpers.py`
_Domain-specific helpers for cost-code views._

**Depends on:**
- `from core.views.helpers import _org_scope_filter`

- `_duplicate_code_error_response()` — Return a 400 response for a duplicate cost code within an organization.

### `backend/core/views/shared_operations/customers.py`
_Shared customer-intake endpoints._

**Depends on:**
- `from core.models import Customer, CustomerRecord, LeadContactRecord, Project`
- `from core.serializers import CustomerIntakeQuickAddSerializer, CustomerProjectCreateSerializer, CustomerManageSerializer, CustomerSerializer, ProjectSerializer`
- `from core.views.helpers import _capability_gate, _ensure_org_membership, _paginate_queryset, _parse_request_bool`
- `from core.views.shared_operations.customers_helpers import ALLOWED_PROJECT_CREATE_STATUSES, _build_customer_duplicate_candidate, _build_intake_payload, _find_duplicate_customers, build_intake_snapshot`

- `customers_list_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List organization-scoped customers with optional free-text search and pagination.
- `customer_detail_view(customer_id)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a customer with immutable record capture on writes.
- `customer_project_create_view(customer_id)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Create a new project directly from a customer context.
- `quick_add_customer_intake_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Create a customer via quick-add intake with duplicate detection and optional project.

### `backend/core/views/shared_operations/customers_helpers.py`
_Domain-specific helpers for customer intake views._

**Depends on:**
- `from core.models import Customer, Project`
- `from core.views.helpers import _ensure_org_membership, _normalized_phone`

- `_find_duplicate_customers(user: AbstractUser, phone: str, email: str)` — Find existing customers matching by phone or email for duplicate detection.
- `_build_customer_duplicate_candidate(customer: Customer)` — Serialize a customer into a lightweight duplicate-candidate dict.
- `_build_intake_payload(payload: dict[str, Any], intake_record_id: int | None, created_at: datetime | None, converted_customer_id: int | None, converted_project_id: int | None, converted_at: datetime | None)` — Build the ``customer_intake`` sub-dict for a ``LeadContactRecord`` snapshot.
- `build_intake_snapshot(payload: dict[str, Any], intake_record_id: int | None, converted_customer_id: int | None, converted_project_id: int | None, converted_at: datetime | None)` — Build the ``snapshot_json`` dict for a ``LeadContactRecord``.

### `backend/core/views/shared_operations/organization_invites.py`
_Organization invite management endpoints (create, list, revoke)._

**Depends on:**
- `from core.models import OrganizationInvite, RoleTemplate`
- `from core.serializers.organization_management import OrganizationInviteCreateSerializer, OrganizationInviteSerializer`
- `from core.views.helpers import _capability_gate, _ensure_org_membership`

- `organization_invites_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List pending invites or create a new one for the caller's organization.
- `organization_invite_detail_view(invite_id)` `@api_view(['DELETE'])` `@permission_classes([IsAuthenticated])` — Revoke (delete) a pending organization invite.

### `backend/core/views/shared_operations/organization_management.py`
_Organization profile and RBAC membership management endpoints._

**Depends on:**
- `from core.models import OrganizationMembership, OrganizationMembershipRecord, OrganizationRecord`
- `from core.serializers.organization_management import OrganizationMembershipSerializer, OrganizationMembershipUpdateSerializer, OrganizationProfileSerializer, OrganizationProfileUpdateSerializer`
- `from core.views.helpers import _capability_gate, _ensure_org_membership`
- `from core.views.shared_operations.organization_management_helpers import LOGO_ALLOWED_CONTENT_TYPES, LOGO_MAX_SIZE_BYTES, _is_last_active_owner, _organization_membership_queryset, _organization_role_policy`

- `organization_profile_view()` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update the organization profile for the caller's org.
- `complete_onboarding_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Mark the caller's organization onboarding as completed.
- `organization_logo_upload_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Upload or replace the organization logo image.
- `organization_memberships_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List memberships for the caller's organization.
- `organization_membership_detail_view(membership_id)` `@api_view(['PATCH'])` `@permission_classes([IsAuthenticated])` — Update a membership's role or status (requires ``users.edit_role``).

### `backend/core/views/shared_operations/organization_management_helpers.py`
_Domain-specific helpers for organization management views._

**Depends on:**
- `from core.models import OrganizationMembership`
- `from core.user_helpers import _resolve_user_capabilities, _resolve_user_role`

- `_organization_role_policy(user: AbstractUser)` — Build the role policy dict describing the user's effective permissions.
- `_organization_membership_queryset(organization_id: int)` — Return the ordered membership queryset for an organization.
- `_is_last_active_owner(membership: OrganizationMembership, next_role: str, next_status: str)` — Return True if changing this membership would leave the org with no active owner.

### `backend/core/views/shared_operations/projects.py`
_Project CRUD and detail endpoints._

**Depends on:**
- `from core.models import ChangeOrder, Quote, Project`
- `from core.serializers import ChangeOrderSerializer, QuoteLineItemSerializer, ProjectFinancialSummarySerializer, ProjectProfileSerializer, ProjectSerializer`
- `from core.views.helpers import _capability_gate, _ensure_org_membership`
- `from core.views.shared_operations.projects_helpers import _build_project_financial_summary_data, _prefetch_project_qs, _project_accepted_contract_totals_map`

- `projects_list_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List all projects for the caller's organization.
- `project_detail_view(project_id)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a project profile.
- `project_financial_summary_view(project_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return normalized AR/AP/CO financial summary with traceability for one project.
- `project_accounting_export_view(project_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Export project accounting summary as JSON or CSV.
- `project_contract_breakdown_view(project_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the active quote and approved change orders for a project.
- `project_audit_events_view(project_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Audit events endpoint — removed.

### `backend/core/views/shared_operations/projects_helpers.py`
_Domain-specific helpers for project views._

**Depends on:**
- `from core.models import ChangeOrder, Quote, Invoice, Payment, Project, VendorBill`

- `_prefetch_project_qs(queryset: QuerySet)` — Apply standard select/prefetch for project serialization.
- `_parse_optional_date(value: str)` — Parse an ISO date string into a ``date`` object.
- `_date_filter_from_query()` — Extract and validate ``date_from``/``date_to`` query params.
- `_project_accepted_contract_totals_map(project_ids: list[int])` — Return a dict mapping project IDs to their accepted contract total.
- `_build_project_financial_summary_data(project: Project, user: AbstractUser)` — Build a complete financial summary dict for a single project.

### `backend/core/views/shared_operations/reporting.py`
_Cross-project reporting and dashboard endpoints._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderSnapshot, Quote, QuoteStatusEvent, Invoice, InvoiceStatusEvent, Payment, PaymentRecord, Project, VendorBill, VendorBillSnapshot`
- `from core.serializers import AttentionFeedSerializer, ChangeImpactSummarySerializer, PortfolioSnapshotSerializer, ProjectTimelineSerializer, QuickJumpSearchSerializer`
- `from core.views.helpers import _ensure_org_membership`
- `from core.views.shared_operations.projects_helpers import _build_project_financial_summary_data, _date_filter_from_query`
- `from core.views.shared_operations.reporting_helpers import DUE_SOON_WINDOW_DAYS, QUICK_JUMP_RESULT_LIMIT, SEVERITY_RANK, VALID_TIMELINE_CATEGORIES`

- `portfolio_snapshot_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return portfolio-level financial snapshot across all projects.
- `change_impact_summary_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return approved change-order impact totals grouped by project.
- `attention_feed_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return prioritized operational attention items requiring action.
- `quick_jump_search_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Search key entities by text query for fast navigation jump points.
- `project_timeline_events_view(project_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return merged project timeline events filtered by category.

### `backend/core/views/shared_operations/vendors.py`
_Shared operational vendor endpoints._

**Depends on:**
- `from core.models import Vendor`
- `from core.serializers import VendorSerializer, VendorWriteSerializer`
- `from core.views.helpers import _ensure_org_membership, _paginate_queryset, _capability_gate`
- `from core.views.shared_operations.vendors_helpers import _find_duplicate_vendors, _org_scope_filter`

- `vendors_list_create_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List scoped vendors or create a new vendor with duplicate detection.
- `vendor_detail_view(vendor_id)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a single vendor profile.

### `backend/core/views/shared_operations/vendors_helpers.py`
_Domain-specific helpers for vendor views._

**Depends on:**
- `from core.models import Vendor`
- `from core.views.helpers import _org_scope_filter`

- `_find_duplicate_vendors(user: AbstractUser, name: str, exclude_vendor_id: int | None)` — Find org-scoped vendors matching by name for duplicate detection.

## Views — Quoting

### `backend/core/views/quoting/quotes.py`
_Quote authoring and public sharing endpoints._

**Depends on:**
- `from core.models import Quote, QuoteStatusEvent, SigningCeremonyRecord`
- `from core.policies import get_quote_policy_contract`
- `from core.serializers import QuoteSerializer, QuoteStatusEventSerializer, QuoteWriteSerializer`
- `from core.utils.request import get_client_ip`
- `from core.utils.signing import compute_document_content_hash`
- `from core.views.quoting.quotes_helpers import QUOTE_DECISION_TO_STATUS, _apply_quote_lines_and_totals, _archive_quote_family, _quote_stored_signature, _handle_quote_document_save, _handle_quote_status_note, _handle_quote_status_transition, _line_items_signature, _next_quote_family_version, _prefetch_quote_qs`
- `from core.views.helpers import _build_public_decision_note, _capability_gate, _check_project_accepts_document, _ensure_org_membership, _promote_prospect_to_active, _resolve_organization_for_public_actor, _serialize_public_organization_context, _serialize_public_project_context, _validate_quote_for_user, _validate_project_for_user`
- `from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision`

- `public_quote_detail_view(public_token)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Return public quote detail for customer share links.
- `public_quote_decision_view(public_token)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Apply a customer approve/reject decision through a public quote link.
- `quote_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the canonical quote workflow policy contract.
- `project_quotes_view(project_id)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project quotes or create a new quote version.
- `quote_detail_view(quote_id)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a single quote with draft-locking enforcement.
- `quote_status_events_view(quote_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the immutable status-transition audit trail for an quote.

### `backend/core/views/quoting/quotes_helpers.py`
_Domain-specific helpers for quote views._

**Depends on:**
- `from core.models import Quote, QuoteLineItem, QuoteStatusEvent, Project`
- `from core.serializers import QuoteSerializer`
- `from core.user_helpers import _ensure_org_membership`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _promote_prospect_to_active, _resolve_cost_codes_for_user`

- `_prefetch_quote_qs(queryset: QuerySet)` — Apply standard select/prefetch for quote serialization.
- `_line_items_signature(line_items_data: list[dict])` — Build a normalized signature from raw line-item input dicts.
- `_quote_stored_signature(quote: Quote)` — Build a normalized signature from an existing quote's line items.
- `_archive_quote_family(project: Project, user: AbstractUser, title: str, exclude_ids: list[int], note: str)` — Archive all same-title quotes in a family except the excluded IDs.
- `_next_quote_family_version(project: Project, title: str)` — Return the next version number for an quote family identified by title.
- `_sync_project_contract_baseline_if_unset(quote: Quote)` — Set the project's contract values from the quote if both are still zero.
- `_calculate_line_totals(line_items_data: list[dict])` — Compute per-line totals with markup and return normalized items.
- `_apply_quote_lines_and_totals(quote: Quote, line_items_data: list[dict], tax_percent: Decimal, user: AbstractUser)` — Replace an quote's line items and recompute all totals.
- `_handle_quote_document_save(quote: Quote, data: dict[str, Any])` — Apply field updates, line items, and totals to an quote (save concern).
- `_handle_quote_status_transition(quote: Quote, data: dict[str, Any], previous_status: str, next_status: str, is_resend: bool)` — Handle an quote status transition with identity freeze, audit, and email.
- `_handle_quote_status_note(quote: Quote, data: dict[str, Any])` — Append an audit note to the quote timeline without changing status.

## Views — Change Orders

### `backend/core/views/change_orders/change_orders.py`
_Change-order creation, revision, and lifecycle endpoints._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderSnapshot, ChangeOrderStatusEvent, Quote, Project, SigningCeremonyRecord`
- `from core.policies import get_change_order_policy_contract`
- `from core.serializers import ChangeOrderSerializer, ChangeOrderStatusEventSerializer, ChangeOrderWriteSerializer, QuoteLineItemSerializer`
- `from core.serializers import ChangeOrderSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.utils.request import get_client_ip`
- `from core.utils.signing import compute_document_content_hash`
- `from core.views.change_orders.change_orders_helpers import CO_DECISION_TO_STATUS, _handle_co_document_save, _handle_co_status_note, _handle_co_status_transition, _next_change_order_family_key, _prefetch_change_order_qs, _sync_change_order_lines, _validate_change_order_lines`
- `from core.views.helpers import _build_public_decision_note, _capability_gate, _check_project_accepts_document, _ensure_org_membership, _resolve_organization_for_public_actor, _serialize_public_organization_context, _serialize_public_project_context, _validate_project_for_user`
- `from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision`

- `public_change_order_detail_view(public_token)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Return public change-order detail for customer share links.
- `public_change_order_decision_view(public_token)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Apply a customer approve/reject decision through a public change-order link.
- `change_order_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the canonical change-order workflow policy contract.
- `project_change_orders_view(project_id)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project change orders or create a new family revision-1 draft.
- `change_order_detail_view(change_order_id)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a change order with revision and status enforcement.
- `change_order_status_events_view(change_order_id)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the immutable status-transition audit trail for a change order.

### `backend/core/views/change_orders/change_orders_helpers.py`
_Domain-specific helpers for change-order views._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderLine, ChangeOrderSnapshot, ChangeOrderStatusEvent, CostCode, Quote, OrganizationMembership, Project`
- `from core.serializers import ChangeOrderSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`

- `_prefetch_change_order_qs(queryset: QuerySet)` — Apply standard select/prefetch for change order serialization.
- `_validate_change_order_lines(line_items: list[dict], organization_id: int)` — Validate change-order line items and resolve cost codes.
- `_sync_change_order_lines(change_order: ChangeOrder, line_items: list[dict], cost_code_map: dict[int, CostCode])` — Replace all line items on a change order with the provided set.
- `_next_change_order_family_key(project: Project)` — Return the next numeric family key string for change orders in a project.
- `_handle_co_document_save(change_order: ChangeOrder, data: dict[str, Any], membership: OrganizationMembership)` — Apply content field updates and line items to a change order (save concern).
- `_handle_co_status_transition(change_order: ChangeOrder, data: dict[str, Any], membership: OrganizationMembership, previous_status: str, next_status: str, is_resend: bool)` — Handle a change-order status transition with financials, audit, and email.
- `_handle_co_status_note(change_order: ChangeOrder, data: dict[str, Any])` — Record a status note without changing the change-order status.

## Views — Accounts Receivable

### `backend/core/views/accounts_receivable/invoice_ingress.py`
_Invoice ingress adapter for normalizing external write payloads._

**class InvoiceCreateIngress** `@dataclass()`
> Immutable ingress payload for invoice creation with defaults applied.

**class InvoicePatchIngress** `@dataclass()`
> Immutable ingress payload for invoice PATCH with per-field presence tracking.

- `_normalize_invoice_line_item(item: dict[str, Any])` — Normalize and whitespace-strip a single invoice line item payload dict.
- `build_invoice_create_ingress(validated_data: dict[str, Any], default_issue_date: date, default_due_days: int, default_sender_name: str, default_sender_email: str, default_sender_address: str, default_sender_logo_url: str, default_terms_text: str, default_footer_text: str, default_notes_text: str)` — Build an InvoiceCreateIngress from validated request data, applying org defaults for missing fields.
- `build_invoice_patch_ingress(validated_data: dict[str, Any])` — Build an InvoicePatchIngress from validated request data with has_* presence flags.

### `backend/core/views/accounts_receivable/invoices.py`
_Accounts receivable invoice endpoints and state transitions._

**Depends on:**
- `from core.models import Quote, Invoice, InvoiceStatusEvent, SigningCeremonyRecord`
- `from core.policies import get_invoice_policy_contract`
- `from core.serializers import InvoiceSerializer, InvoiceStatusEventSerializer, InvoiceWriteSerializer`
- `from core.utils.request import get_client_ip`
- `from core.utils.signing import compute_document_content_hash`
- `from core.views.accounts_receivable.invoice_ingress import build_invoice_create_ingress, build_invoice_patch_ingress`
- `from core.views.accounts_receivable.invoices_helpers import _activate_project_from_invoice_creation, _apply_invoice_lines_and_totals, _freeze_org_identity_on_invoice, _handle_invoice_document_save, _handle_invoice_status_note, _handle_invoice_status_transition, _invoice_line_apply_error_response, _next_invoice_number, _prefetch_invoice_qs`
- `from core.views.helpers import _build_public_decision_note, _capability_gate, _check_project_accepts_document, _ensure_org_membership, _resolve_organization_for_public_actor, _serialize_public_organization_context, _serialize_public_project_context, _validate_project_for_user`
- `from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision`

- `org_invoices_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List all invoices across all projects for the authenticated user's org.
- `public_invoice_detail_view(public_token: str)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Return public invoice detail for share links, including project context.
- `public_invoice_decision_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Apply a customer approval or dispute decision to a public invoice.
- `invoice_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the invoice workflow policy contract for frontend UX guards.
- `project_invoices_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List or create invoices for a project.
- `invoice_detail_view(invoice_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch an invoice with lifecycle and line item guardrails.
- `invoice_send_view(invoice_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Send an invoice by transitioning to ``sent`` status.
- `invoice_status_events_view(invoice_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the immutable status transition history for an invoice.

### `backend/core/views/accounts_receivable/invoices_helpers.py`
_Domain-specific helpers for invoice views._

**Depends on:**
- `from core.models import Invoice, InvoiceLine, InvoiceStatusEvent, Organization, OrganizationMembership, Payment, Project`
- `from core.serializers import InvoiceSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.accounts_receivable.invoice_ingress import InvoicePatchIngress`
- `from core.views.helpers import _promote_prospect_to_active, _resolve_cost_codes_for_user`

- `_prefetch_invoice_qs(queryset: QuerySet)` — Eagerly load invoice relations to prevent N+1 query problems.
- `_is_billable_invoice_status(status: str)` — Return True if the invoice status counts toward billed totals.
- `_project_billable_invoices_total(project: Project, user: AbstractUser, exclude_invoice_id: int | None)` — Sum the totals of all billable invoices for a project, optionally excluding one.
- `_next_invoice_number(project: Project, user: AbstractUser)` — Generate the next unique sequential invoice number for a project.
- `_calculate_invoice_line_totals(line_items_data: list[dict])` — Compute per-line totals and return normalized items with a running subtotal.
- `_apply_invoice_lines_and_totals(invoice: Invoice, line_items_data: list[dict], tax_percent: Decimal, user: AbstractUser)` — Replace an invoice's line items and recompute all totals.
- `_invoice_line_apply_error_response(apply_error: dict)` — Convert an _apply_invoice_lines_and_totals error dict into a (body, status) HTTP response tuple.
- `_activate_project_from_invoice_creation(invoice: Invoice, actor: AbstractUser)` — Transition a prospect project to active when a direct invoice is created.
- `_freeze_org_identity_on_invoice(invoice: Invoice, organization: Organization, update_fields: list[str])` — Stamp org identity fields onto the invoice when leaving draft.
- `_handle_invoice_document_save(invoice: Invoice, ingress: InvoicePatchIngress)` — Apply field updates, line items, and totals to an invoice (the 'save' concern).
- `_handle_invoice_status_transition(invoice: Invoice, ingress: InvoicePatchIngress, membership: OrganizationMembership, previous_status: str, next_status: str, is_resend: bool)` — Handle an invoice status transition: validate, apply, freeze org identity, audit, email.
- `_handle_invoice_status_note(invoice: Invoice, ingress: InvoicePatchIngress)` — Append an audit note to the invoice timeline without changing status.

## Views — Accounts Payable

### `backend/core/views/accounts_payable/expenses.py`
_Quick expense endpoint — create a minimal VendorBill for retail/misc purchases._

**Depends on:**
- `from core.models import Payment, Vendor, VendorBill`
- `from core.serializers import VendorBillSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money, validate_positive_amount`
- `from core.views.accounts_payable.vendor_bills_helpers import _prefetch_vendor_bill_qs`
- `from core.views.helpers import _capability_gate, _check_project_accepts_document, _ensure_org_membership, _promote_prospect_to_active, _validate_project_for_user`

- `project_expenses_view(project_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Create a quick expense (minimal VendorBill) for a project.

### `backend/core/views/accounts_payable/receipt_scan.py`
_Bill/receipt image scanning — best-effort field extraction via Gemini Vision._

**Depends on:**
- `from core.user_helpers import _ensure_org_membership`
- `from core.views.accounts_payable.receipt_scan_helpers import ALLOWED_CONTENT_TYPES, EXTRACTION_PROMPT, MAX_IMAGE_BYTES, _parse_gemini_response, normalize_scan_result`
- `from core.views.helpers import _capability_gate`

- `receipt_scan_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` `@parser_classes([MultiPartParser])` — Accept a bill or receipt image and return best-effort extracted fields.

### `backend/core/views/accounts_payable/receipt_scan_helpers.py`
_Helpers for bill/receipt scanning — Gemini integration, validation constants, response parsing._

- `_parse_gemini_response(text: str)` — Extract JSON from a Gemini text response.
- `normalize_scan_result(raw: dict)` — Ensure the scan result has all expected keys with safe defaults.

### `backend/core/views/accounts_payable/vendor_bills.py`
_Accounts payable vendor-bill endpoints and line item lifecycle._

**Depends on:**
- `from core.models import Vendor, VendorBill, VendorBillSnapshot`
- `from core.policies import get_vendor_bill_policy_contract`
- `from core.serializers import VendorBillSerializer, VendorBillSnapshotSerializer, VendorBillWriteSerializer`
- `from core.utils.money import quantize_money`
- `from core.views.accounts_payable.vendor_bills_helpers import _apply_vendor_bill_lines_and_totals, _find_duplicate_vendor_bills, _handle_vb_document_save, _handle_vb_status_note, _handle_vb_status_transition, _prefetch_vendor_bill_qs, _vendor_bill_line_apply_error_response`
- `from core.views.helpers import _capability_gate, _check_project_accepts_document, _ensure_org_membership, _promote_prospect_to_active, _validate_project_for_user`

- `vendor_bill_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the vendor-bill workflow policy contract for frontend UX guards.
- `org_vendor_bills_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List all vendor bills across all projects for the authenticated user's org.
- `project_vendor_bills_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List or create vendor bills for a project.
- `vendor_bill_detail_view(vendor_bill_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch a vendor bill with lifecycle and line item guardrails.
- `vendor_bill_snapshots_view(vendor_bill_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the immutable status transition history for a vendor bill.

### `backend/core/views/accounts_payable/vendor_bills_helpers.py`
_Domain-specific helpers for vendor bill views._

**Depends on:**
- `from core.models import VendorBill, VendorBillLine, VendorBillSnapshot`
- `from core.serializers import VendorBillSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _resolve_cost_codes_for_user`

- `_find_duplicate_vendor_bills(user, vendor_id: int, bill_number: str, exclude_vendor_bill_id: int | None)` — Find existing vendor bills with the same vendor + bill_number (case-insensitive).
- `_calculate_vendor_bill_line_totals(line_items_data: list[dict])` — Compute per-line amounts and return normalized items with a running subtotal.
- `_apply_vendor_bill_lines_and_totals(vendor_bill: VendorBill, line_items_data: list[dict], tax_amount: Decimal, shipping_amount: Decimal, user)` — Replace a vendor bill's line items and recompute all totals.
- `_vendor_bill_line_apply_error_response(apply_error: dict)` — Convert an ``_apply_vendor_bill_lines_and_totals`` error dict into an HTTP response tuple.
- `_prefetch_vendor_bill_qs(queryset: QuerySet)` — Eagerly load vendor bill relations to prevent N+1 query problems.
- `_validate_vb_dates(next_status: str, next_issue_date: datetime.date | None, next_due_date: datetime.date | None)` — Validate date requirements for a vendor bill status.
- `_validate_vb_line_items_present(line_items: list | None)` — Validate that line items are non-empty when provided.
- `_handle_vb_document_save(vendor_bill: VendorBill, data: dict)` — Apply field updates, line items, and totals to a vendor bill (the 'save' concern).
- `_handle_vb_status_transition(vendor_bill: VendorBill, data: dict, previous_status: str, next_status: str)` — Handle a vendor bill status transition: validate, apply, snapshot.
- `_handle_vb_status_note(vendor_bill: VendorBill, data: dict)` — Append a status note snapshot without changing vendor bill status.

## Views — Cash Management

### `backend/core/views/cash_management/payments.py`
_Cash-management payment endpoints._

**Depends on:**
- `from core.models import Customer, Payment, PaymentRecord`
- `from core.policies import get_payment_policy_contract`
- `from core.serializers import PaymentSerializer, PaymentWriteSerializer`
- `from core.views.helpers import _capability_gate, _ensure_org_membership, _validate_project_for_user`
- `from core.views.cash_management.payments_helpers import _prefetch_payment_qs, _recalculate_payment_target, _recalculate_target_balance, _resolve_and_link_target`

- `payment_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the canonical payment workflow policy contract.
- `org_payments_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List all org payments or create a new payment.
- `project_payments_view(project_id)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project payments or create a new payment linked to the project.
- `payment_detail_view(payment_id)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a single payment.

### `backend/core/views/cash_management/payments_helpers.py`
_Domain-specific helpers for payment views._

**Depends on:**
- `from core.models import Invoice, OrganizationMembership, Payment, VendorBill`
- `from core.models.financial_auditing.invoice_status_event import InvoiceStatusEvent`
- `from core.utils.money import MONEY_ZERO, quantize_money`

- `_prefetch_payment_qs(queryset: QuerySet)` — Apply standard select/prefetch for payment serialization.
- `_set_invoice_balance_from_payments(invoice: Invoice, changed_by: 'User')` — Recompute an invoice's balance_due and status from its settled payments.
- `_set_vendor_bill_balance_from_payments(vendor_bill: VendorBill)` — Recompute a vendor bill's balance_due from its settled payments.
- `_recalculate_payment_target(payment: Payment, changed_by: 'User')` — Refresh balance_due on the single document linked to this payment.
- `_direction_target_mismatch(direction: str, target_type: str)` — Return True if the target type is incompatible with the payment direction.
- `_target_error(fields: dict[str, list[str]])` — Build a standard validation error payload for target resolution failures.
- `_resolve_and_link_target(data: dict[str, Any], payment_kwargs: dict[str, Any], membership: OrganizationMembership)` — Resolve ``target_type`` + ``target_id`` from payload and populate payment FK kwargs.
- `_recalculate_target_balance(target: Model, target_type: str, changed_by: 'User')` — Recalculate the balance on a resolved target after payment creation.

## Utils

### `backend/core/utils/email.py`
_Transactional email helpers with audit logging._

**Depends on:**
- `from core.models import EmailRecord`

- `_frontend_url()` — Return the frontend base URL with trailing slash stripped.
- `_render_email(template_name, context)` — Render an email template pair and return (subject, plain_text, html).
- `send_verification_email(user, token_obj)` — Send email verification link and log to EmailRecord.
- `send_password_reset_email(user, token_obj, is_security_alert)` — Send password reset link and log to EmailRecord.
- `send_otp_email(recipient_email, code, document_type_label, document_title)` — Send a 6-digit OTP code for public document verification.
- `send_document_sent_email(document_type, document_title, public_url, recipient_email, sender_user)` — Send notification email when a document is sent to a customer.
- `send_document_decision_email(user_id, document_type, document_title, customer_name, decision, project_url)` — Send email to document owner when a customer makes a decision.

### `backend/core/utils/money.py`
_Money precision utilities for consistent currency rounding._

- `quantize_money(value)` — Normalize any money value to 2-decimal currency precision.
- `validate_positive_amount(amount: Decimal, field_name: str)` — Return an error payload if amount is <= 0, else None.

### `backend/core/utils/organization_defaults.py`
_Organization-level default helpers for document branding/templates._

- `build_org_defaults(owner_email: str)` — Build the default field values for a new or backfilled organization.
- `apply_missing_org_defaults(organization, owner_email: str)` — Apply missing defaults to an existing organization in-memory.

### `backend/core/utils/push.py`
_Web Push notification delivery utility._

**Depends on:**
- `from core.models.shared_operations.push_subscription import PushSubscription`

- `_get_vapid_claims()` — Build VAPID claims dict from environment variables.
- `_get_vapid_private_key()` — Read the VAPID private key from environment.
- `send_push_to_user(user_id: int, payload: dict)` — Send a push notification to all subscriptions for the given user.
- `build_document_decision_payload(document_type: str, document_title: str, customer_name: str, decision: str, url: str)` — Build a standardized push payload for a document decision event.

### `backend/core/utils/request.py`
_Request utilities — helpers for extracting metadata from Django/DRF requests._

- `get_client_ip()` — Extract the real client IP from a request, respecting reverse proxy headers.

### `backend/core/utils/signing.py`
_Signing ceremony utilities — content hashing, consent text, email masking._

- `compute_consent_text_version(text: str)` — Return SHA-256 hex digest of the consent text for version tracking.
- `_extract_line_items(serialized_data: dict, fields: tuple[str, ...])` — Extract content-relevant fields from serialized line items.
- `compute_document_content_hash(document_type: str, serialized_data: dict)` — Compute SHA-256 of the content-relevant fields of a serialized document.
- `mask_email(email: str)` — Mask an email address for display: ``j***@example.com``.

### `backend/core/utils/tokens.py`
_Shared token generation utilities._

- `generate_public_token(length: int)` — Generate a random alphanumeric token for public-facing share links.

## Core

### `backend/core/apps.py`

**class CoreConfig(AppConfig)**


### `backend/core/authentication.py`
_Custom DRF authentication backends._

**Depends on:**
- `from core.models.shared_operations.impersonation import ImpersonationToken`

**class ImpersonationTokenAuthentication(TokenAuthentication)**
> Authenticate using an impersonation token if one exists.
- `authenticate_credentials(key)` — Look up the key in ImpersonationToken.


### `backend/core/rbac.py`
_RBAC enforcement._

**Depends on:**
- `from core.user_helpers import RBAC_ROLE_BOOKKEEPING, RBAC_ROLE_OWNER, RBAC_ROLE_PM, RBAC_ROLE_VIEWER, RBAC_ROLE_WORKER, _resolve_user_capabilities`

- `_capability_gate(user, resource: str, action: str)` — Check if user has the required capability; returns (error_payload|None, capabilities).

### `backend/core/tasks.py`
_Async tasks executed by the django-q2 worker (qcluster)._

- `_report_to_sentry(func)` — Capture task exceptions in Sentry before Q2 marks the task as failed.
- `send_verification_email_task(user_id, token_id)` `@_report_to_sentry` — Send email verification link.
- `send_password_reset_email_task(user_id, token_id, is_security_alert)` `@_report_to_sentry` — Send password reset link.
- `send_otp_email_task(recipient_email, code, document_type_label, document_title)` `@_report_to_sentry` — Send OTP code for public document verification ceremony.
- `send_document_sent_email_task(document_type, document_title, public_url, recipient_email, sender_user_id)` `@_report_to_sentry` — Send notification when a document is sent to a customer.
- `send_document_decision_notification(user_id, document_type, document_title, customer_name, decision, project_url)` `@_report_to_sentry` — Send push + email notification to document owner after a customer decision.

### `backend/core/user_helpers.py`
_User-centric resolution and lifecycle helpers._

**Depends on:**
- `from core.models import CostCode, Organization, OrganizationMembership, OrganizationMembershipRecord, OrganizationRecord, RoleTemplate`
- `from core.utils.organization_defaults import build_org_defaults`

- `_resolve_user_role(user)` — Return the canonical role slug for a user from their active membership.
- `_resolve_user_capabilities(user, membership)` — Resolve the effective capability flags for a user.
- `_ensure_org_membership(user)` — Return the user's active OrganizationMembership, bootstrapping one if absent.

## Management Commands

### `backend/core/management/commands/backfill_customer_display_names.py`

**Depends on:**
- `from core.models import Customer`

**class Command(BaseCommand)**
- `add_arguments(parser)`
- `handle()`


### `backend/core/management/commands/backfill_organization_invoice_defaults.py`

**Depends on:**
- `from core.models import Organization`
- `from core.utils.organization_defaults import apply_missing_org_defaults`

**class Command(BaseCommand)**
- `add_arguments(parser)`
- `handle()`


### `backend/core/management/commands/nuke_account.py`
_Management command to completely wipe a user account and all associated org data._

**class Command(BaseCommand)**
- `add_arguments(parser)`
- `handle()`


### `backend/core/management/commands/reset_fresh_demo.py`

**Depends on:**
- `from core.models import RoleTemplate`

**class Command(BaseCommand)**
- `add_arguments(parser)`
- `_seed_system_role_templates()` `@atomic` — Ensure system RoleTemplate rows exist after flush.
- `handle()`


### `backend/core/management/commands/seed_adoption_stages.py`
_Seed four demo accounts representing different adoption stages of the platform._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderLine, CostCode, Customer, Quote, QuoteLineItem, QuoteStatusEvent, Invoice, InvoiceLine, OrganizationMembership, OrganizationMembershipRecord, Payment, Project, RoleTemplate, Vendor, VendorBill, VendorBillLine`
- `from core.user_helpers import _ensure_org_membership`

**class Command(BaseCommand)**
- `_get_or_create_user(email, onboarding_completed)`
- `_cost_codes(user)` — Return two cost codes for quote line seeding.
- `_add_team_member(owner_membership, email, full_name, role)` — Create a user and add them as a team member on the owner's org.
- `_make_customer(user, name)`
- `_make_project(user, customer, name, status)`
- `_make_quote(user, project, title, version, status, subtotal, code1, code2)`
- `_sync_quote_lines(quote, code1, code2, subtotal)`
- `_sync_quote_status_history(quote, target_status, user)`
- `_make_change_order(user, project, family_key, title, status, amount)`
- `_make_invoice(user, project, customer, number, status, total, balance_due)`
- `_make_vendor_bill(user, project, vendor, bill_number, status, total, balance_due)`
- `_make_payment(user, project, direction, ref, method, status, amount)`
- `_make_quick_expense(user, project, store_name, total)` — Create a VendorBill for a quick expense (vendor auto-created by name).
- `_seed_new()` — Fresh signup.
- `_seed_early()` — ~2 months in.
- `_seed_mid()` — ~8 months in.
- `_seed_late()` — ~2 years in.
- `_seed_system_role_templates()` `@atomic` — Ensure system RoleTemplate rows exist.
- `handle()`


## Tests

### `backend/core/tests/common.py`

**Depends on:**
- `from core.models import AccountingSyncEvent, AccountingSyncRecord, ChangeOrderSnapshot, ChangeOrderStatusEvent, CustomerRecord, ChangeOrder, ChangeOrderLine, CostCode, Customer, DocumentAccessSession, EmailRecord, EmailVerificationToken, Quote, QuoteLineItem, QuoteStatusEvent, Invoice, InvoiceLine, InvoiceStatusEvent, LeadContactRecord, OrganizationMembershipRecord, OrganizationRecord, Payment, PaymentRecord, Project, Organization, OrganizationInvite, OrganizationMembership, RoleTemplate, SigningCeremonyRecord, VendorBill, VendorBillLine, VendorBillSnapshot, Vendor`

- `_bootstrap_org(user)` — Bootstrap an organization for a test user and return it.

### `backend/core/tests/test_accounting_sync.py`

**Depends on:**
- `from core.tests.common import *`

**class AccountingSyncEventTests(TestCase)**
- `setUp()`
- `test_project_sync_event_list_create_and_scope()`
- `test_retry_failed_event_is_safe()`
- `test_retry_rejects_success_and_other_user_scope()`
- `test_accounting_sync_record_is_immutable()`
- `test_create_rolls_back_when_record_capture_fails()`


### `backend/core/tests/test_change_orders.py`

**Depends on:**
- `from core.tests.common import *`

**class ChangeOrderTests(TestCase)**
- `setUp()`
- `_bootstrap_primary_membership()`
- `_create_quote(project_id: int, cost_code_id: int, token: str, title: str)`
- `_create_quote_family(title: str)`
- `_approve_quote(quote_id: int, token: str)`
- `_create_other_quote_family()` — Create an approved quote on other_project for cross-project tests.
- `_create_change_order(title, amount_delta)`
- `_assert_validation_error(response)`
- `test_change_order_contract_requires_authentication()`
- `test_public_change_order_detail_view_allows_unauthenticated_access()`
- `test_public_change_order_decision_view_approves_sent()`
- `test_public_change_order_decision_view_rejects_sent()`
- `test_change_order_contract_matches_model_transition_policy()`
- `test_change_order_create_and_numbering()`
- `test_change_order_create_defaults_reason_to_empty_when_omitted()`
- `test_change_order_create_allows_per_change_order_reason_override()`
- `test_change_order_patch_allows_reason_updates()`
- `test_change_order_create_with_line_items_scaffold()`
- `test_change_order_create_with_origin_quote_link()`
- `test_change_order_create_requires_origin_quote()`
- `test_change_order_create_rejects_non_approved_origin_quote()`
- `test_change_order_create_rejects_line_total_mismatch()`
- `test_change_order_patch_updates_line_items_scaffold()`
- `test_change_order_patch_rejects_origin_quote_change_or_clear()`
- `test_change_order_create_allows_duplicate_cost_codes()`
- `test_change_order_create_line_with_cost_code()`
- `test_change_order_model_blocks_invalid_status_transition_on_save()`
- `test_change_order_model_rejects_cross_project_origin_quote_on_direct_save()`
- `test_change_order_status_lifecycle_validation()`
- `test_sent_cannot_transition_back_to_draft()`
- `test_change_order_patch_rejects_content_edits_when_sent()`
- `test_change_order_patch_rejects_content_edits_when_approved_rejected_or_void()`
- `test_change_order_approved_status_creates_immutable_snapshot()`
- `test_change_order_rejected_and_void_status_each_create_decision_snapshots()`
- `test_change_order_list_and_detail_are_scoped_to_current_user()`
- `test_rejected_or_void_change_orders_do_not_change_contract_total()`
- `test_approved_change_order_updates_contract_total()`
- `test_approved_change_order_cannot_transition_to_void_and_financials_remain()`
- `test_editing_approved_change_order_amount_is_blocked()`
- `test_change_order_create_records_status_event()`
- `test_status_transition_records_event()`
- `test_resend_records_sent_to_sent_event()`
- `test_status_note_records_same_status_event()`
- `test_public_decision_records_status_event()`
- `test_status_events_endpoint_returns_events()`
- `test_status_events_endpoint_rejects_cross_org_access()`

- `_verified_session(public_token, document_type, document_id, email)` — Create a verified OTP session for public decision tests.

### `backend/core/tests/test_customer_intake.py`

**Depends on:**
- `from core.tests.common import *`

**class CustomerIntakeQuickAddTests(TestCase)**
- `setUp()`
- `test_quick_add_requires_authentication()`
- `test_quick_add_creates_customer_and_intake_provenance_with_required_fields()`
- `test_quick_add_accepts_optional_initial_contract_value()`
- `test_quick_add_allows_email_in_phone_field()`
- `test_quick_add_rejects_when_phone_and_email_are_missing()`
- `test_quick_add_rejects_invalid_contact_method_in_phone_field()`
- `test_quick_add_returns_duplicate_candidates_without_resolution()`
- `test_quick_add_use_existing_reuses_customer()`
- `test_quick_add_merge_existing_is_rejected()`
- `test_quick_add_can_create_project_in_same_request()`
- `test_quick_add_rejects_non_prospect_or_active_project_status()`
- `test_quick_add_rolls_back_when_record_capture_fails()`


### `backend/core/tests/test_customers_management.py`

**Depends on:**
- `from core.tests.common import *`

**class CustomersManagementTests(TestCase)**
- `setUp()`
- `test_customers_list_requires_authentication()`
- `test_customers_list_returns_user_scoped_rows()`
- `test_customers_list_includes_customers_from_same_organization()` — Both customers in the same org are visible to any org member.
- `test_customer_detail_allows_access_to_same_organization_customer()` — A customer in the same org is accessible to any org member.
- `test_customers_list_supports_search()`
- `test_customers_list_project_count_excludes_prospect_projects()`
- `test_customer_patch_updates_record()`
- `test_customer_patch_requires_phone_or_email()`
- `test_customer_patch_can_toggle_archive_flag()`
- `test_customer_patch_archiving_cancels_prospect_projects()`
- `test_customer_patch_rejects_archive_when_customer_has_active_project()`
- `test_customer_patch_allows_archive_when_customer_projects_are_closed()`
- `test_customer_detail_is_user_scoped()`
- `test_customer_project_create_creates_project_for_customer()`
- `test_customer_project_create_allows_same_org_customer()` — A user can create a project under another user's customer if both are in the same org.
- `test_customer_project_create_rejects_active_project_for_archived_customer()`
- `test_customer_project_create_rejects_non_prospect_or_active_status()`
- `test_customer_project_create_active_requests_transition_from_prospect()`
- `test_customer_delete_not_allowed()`
- `test_customer_delete_not_allowed_even_with_projects()`
- `test_customer_delete_is_not_allowed_for_other_user_record()`
- `test_customer_intake_and_customer_records_are_immutable()`
- `test_customer_patch_rejects_project_activation_when_customer_archived()`


### `backend/core/tests/test_demo_seed.py`

**Depends on:**
- `from core.tests.common import *`
- `from core.models import ChangeOrder, Quote, Invoice, Payment, VendorBill`

**class AdoptionStageSeedTests(TestCase)**
- `test_new_account_has_no_data()`
- `test_early_account_shape()`
- `test_mid_account_has_status_coverage()`
- `test_late_account_scale()`


### `backend/core/tests/test_email_verification.py`

**Depends on:**
- `from core.tests.common import *`

**class EmailVerificationTokenModelTests(TestCase)**
> Model-level tests for EmailVerificationToken.
- `setUp()`
- `test_token_auto_generated_on_save()`
- `test_expiry_auto_set_to_24_hours()`
- `test_lookup_valid_success()`
- `test_lookup_valid_not_found()`
- `test_lookup_valid_consumed()`
- `test_lookup_valid_expired()`

**class EmailRecordModelTests(TestCase)**
> Model-level tests for EmailRecord (immutable audit log).
- `test_record_creation()`
- `test_record_immutability()`

**class RegisterFlowAVerificationTests(TestCase)**
> Registration Flow A now returns 200 with message, creates verification token.
- `test_register_returns_check_email_message()`
- `test_register_creates_inactive_user()`
- `test_register_creates_verification_token()`
- `test_register_sends_verification_email()`
- `test_register_creates_email_audit_record()`
- `test_register_duplicate_email_same_response()`
- `test_register_duplicate_does_not_create_token()`
- `test_flow_b_invite_unchanged()` — Flow B (invite registration) still returns 201 with auth token.

**class VerifyEmailTests(TestCase)**
> Tests for the verify-email endpoint.
- `setUp()`
- `test_verify_valid_token()`
- `test_verify_expired_token()`
- `test_verify_consumed_token()`
- `test_verify_not_found()`
- `test_verify_missing_token_field()`

**class ResendVerificationTests(TestCase)**
> Tests for the resend-verification endpoint.
- `setUp()`
- `test_resend_deletes_old_token_and_creates_new()`
- `test_resend_rate_limited()`
- `test_resend_nonexistent_email_returns_200()`
- `test_resend_verified_user_gets_password_reset()` — Verified users get a password reset email instead of verification.
- `test_resend_missing_email_returns_400()`
- `test_resend_works_after_previous_resend()` — Regression: resend should work repeatedly without false 'already verified'.

**class LoginVerificationGateTests(TestCase)**
> Login blocks unverified users (is_active=False), passes active users through.
- `test_login_unverified_returns_403()`
- `test_login_verified_returns_200()`
- `test_login_legacy_user_returns_200()` — Legacy/seed users have is_active=True by default — login works.


### `backend/core/tests/test_quotes.py`

**Depends on:**
- `from core.serializers import QuoteWriteSerializer`
- `from core.tests.common import *`

**class QuoteTests(TestCase)**
- `setUp()`
- `_bootstrap_primary_membership()`
- `test_public_quote_detail_view_allows_unauthenticated_access()`
- `test_public_quote_detail_view_not_found()`
- `test_public_quote_decision_view_approves_sent_quote()`
- `test_public_quote_decision_view_rejects_sent_quote()`
- `test_quote_contract_requires_authentication()`
- `test_quote_contract_matches_model_transition_policy()`
- `test_project_quotes_create()`
- `test_project_quotes_create_persists_valid_through()`
- `test_project_quotes_create_uses_organization_validation_delta_when_valid_through_omitted()`
- `test_project_quotes_create_uses_organization_default_terms_when_omitted()`
- `test_project_quotes_rejects_per_quote_terms_overrides()`
- `test_project_quotes_patch_rejects_terms_edit_when_non_draft()`
- `test_project_quotes_create_rounds_tax_half_up_to_cents()`
- `test_project_quotes_create_requires_title()`
- `test_project_quotes_create_archives_previous_family()`
- `test_project_quotes_create_requires_explicit_confirmation_for_existing_title_family()`
- `test_project_quotes_create_blocks_existing_title_family_after_approval()`
- `test_project_quotes_create_rejects_user_archived_status()`
- `test_project_quotes_list_scoped_by_project_and_user()`
- `test_quote_status_write_contract_distinguishes_void_from_archived()`
- `test_quote_status_transition_validates_allowed_paths()`
- `test_quote_patch_approval_promotes_project_to_active()`
- `test_quote_status_transition_allows_sent_to_void()`
- `test_quote_status_transition_rejects_user_archived_patch()`
- `test_quote_status_transition_creates_audit_events()`
- `test_quote_resend_records_sent_to_sent_status_event()`
- `test_quote_terminal_status_note_records_same_status_event()`
- `test_quote_values_locked_after_send()`
- `test_quote_title_cannot_change_after_creation_even_in_draft()`
- `test_quote_cannot_transition_from_sent_back_to_draft()`

- `_verified_session(public_token, document_type, document_id, email)` — Create a verified OTP session for public decision tests.

### `backend/core/tests/test_health_auth.py`

**Depends on:**
- `from core.tests.common import *`
- `from core.utils.cost_code_defaults import DEFAULT_COST_CODE_ROWS`

**class HealthEndpointTests(TestCase)**
- `test_health_endpoint_returns_ok_payload()`

**class AuthEndpointTests(TestCase)**
- `setUp()`
- `test_me_endpoint_rejects_unauthenticated_request()`
- `test_login_returns_token_and_me_works_with_token()`
- `test_register_creates_account_and_sends_verification()`
- `test_register_bootstraps_organization_defaults()`
- `test_register_duplicate_email_returns_same_200()`
- `test_login_self_heals_legacy_user_missing_membership()`
- `test_login_self_heal_writes_org_and_membership_records()`
- `test_me_self_heals_legacy_user_missing_membership()`
- `test_org_and_membership_records_are_immutable()`
- `assertOrganizationPayload(organization)`


### `backend/core/tests/test_impersonate.py`

**Depends on:**
- `from core.tests.common import *`
- `from core.models.shared_operations.impersonation import ImpersonationToken`

**class ImpersonateStartTests(TestCase)**
- `setUp()`
- `test_auth_required()`
- `test_non_superuser_rejected()`
- `test_missing_user_id()`
- `test_target_not_found()`
- `test_target_is_superuser_rejected()`
- `test_happy_path()`
- `test_cleans_up_prior_tokens()`

**class ImpersonateExitTests(TestCase)**
- `setUp()`
- `_start_impersonation()`
- `test_happy_path()`
- `test_not_impersonating_with_regular_token()`

**class ImpersonateUsersListTests(TestCase)**
- `setUp()`
- `test_non_superuser_rejected()`
- `test_happy_path()`


### `backend/core/tests/test_invites.py`
_Tests for RBAC Phase 4: Invite Flow (create, list, revoke, verify, Flow B, Flow C)._

**Depends on:**
- `from core.tests.common import *`

**class InviteTestMixin**
> Shared setup for invite tests: org + owner + seeded role templates.
- `setUp()`
- `_auth(token_obj)`
- `_create_invite(email, role, token_obj)`

**class InviteCRUDTests(InviteTestMixin, TestCase)**
> Tests for creating, listing, and revoking invites.
- `test_owner_can_create_invite()`
- `test_pm_can_create_invite()`
- `test_worker_cannot_create_invite()`
- `test_viewer_cannot_create_invite()`
- `test_owner_role_cannot_be_invited()`
- `test_duplicate_invite_returns_409()`
- `test_list_returns_only_pending_invites()`
- `test_revoke_invite()`
- `test_revoke_cross_org_returns_404()`

**class VerifyInviteTests(InviteTestMixin, TestCase)**
> Tests for the verify-invite endpoint.
- `test_verify_valid_invite_new_user()`
- `test_verify_valid_invite_existing_user()`
- `test_verify_expired_invite()`
- `test_verify_consumed_invite()`
- `test_verify_invalid_token()`

**class CheckInviteByEmailTests(InviteTestMixin, TestCase)**
> Tests for the check-invite-by-email endpoint (auto-detect pending invites).
- `test_check_invite_returns_pending_invite()`
- `test_check_invite_case_insensitive()`
- `test_check_invite_no_pending_returns_404()`
- `test_check_invite_expired_not_returned()`
- `test_check_invite_consumed_not_returned()`
- `test_check_invite_missing_email_returns_400()`

**class FlowBTests(InviteTestMixin, TestCase)**
> Tests for Flow B: new user registering with invite token.
- `test_register_with_invite_joins_org()`
- `test_register_with_invite_email_mismatch_rejected()`
- `test_register_with_expired_invite_rejected()`
- `test_register_with_consumed_invite_rejected()`
- `test_register_without_invite_unchanged()` — Regression: Flow A still works when no invite_token is provided.

**class FlowCTests(InviteTestMixin, TestCase)**
> Tests for Flow C: existing user accepting invite (org-switch with password confirmation).
- `setUp()`
- `test_accept_invite_moves_membership()`
- `test_accept_invite_wrong_password_rejected()`
- `test_accept_invite_already_in_target_org_idempotent()`
- `test_accept_invite_expired_rejected()`
- `test_accept_invite_missing_fields()`
- `test_accept_invite_nonexistent_user()`

**class RolePolicyInviteTests(InviteTestMixin, TestCase)**
> Tests for can_invite in role_policy response.
- `test_owner_role_policy_includes_can_invite()`
- `test_worker_role_policy_can_invite_false()`


### `backend/core/tests/test_invoices.py`

**Depends on:**
- `from core.tests.common import *`

**class InvoiceTests(TestCase)**
- `setUp()`
- `_create_invoice()`
- `test_public_invoice_detail_view_allows_unauthenticated_access()`
- `test_public_invoice_detail_view_not_found()`
- `test_public_invoice_decision_view_approves_sent_invoice_as_paid()`
- `test_public_invoice_decision_view_dispute_adds_status_note_event()`
- `test_invoice_contract_requires_authentication()`
- `test_invoice_contract_matches_model_transition_policy()`
- `test_invoice_create_calculates_totals_and_lines()`
- `test_invoice_create_uses_organization_invoice_defaults_when_payload_omits_them()`
- `test_invoice_create_allows_overriding_organization_invoice_defaults()`
- `test_invoice_patch_updates_sender_and_template_fields()`
- `test_invoice_create_rounds_tax_half_up_to_cents()`
- `test_invoice_create_rolls_back_when_status_event_write_fails()`
- `test_project_invoices_list_scoped_by_project_and_user()`
- `test_invoice_status_transition_validation_and_closed()`
- `test_invoice_send_endpoint_moves_draft_to_sent()`
- `test_invoice_status_events_endpoint_returns_history()`
- `test_invoice_status_note_without_transition_records_same_status_event()`
- `test_invoice_patch_line_items_recalculates_totals()`
- `test_invoice_model_blocks_invalid_status_transition_on_direct_save()`
- `test_invoice_model_blocks_due_date_before_issue_date()`
- `test_invoice_closed_cannot_transition_to_void()` — Closed is a terminal state — voiding a closed invoice is not allowed.
- `test_invoice_outstanding_cannot_void()` — Outstanding invoices cannot be voided — void payments first.
- `test_invoice_overdue_is_not_a_valid_status()` — Overdue was removed from the status enum — it is now a computed condition.
- `_create_simple_project()` — Helper: create a simple project for additional invoice tests.
- `test_create_invoice_on_simple_project()` — Invoice creation succeeds on a minimal project.
- `test_line_missing_description_rejected()` — Lines without a description are rejected.
- `test_create_invoice_on_prospect_project_activates_it()` — Creating an invoice on a prospect project promotes it to active.
- `test_create_invoice_on_active_project_stays_active()` — Creating an invoice on an already-active project doesn't change status.
- `_create_approved_quote(project)` — Create an approved quote on the given (or default) project.
- `test_create_invoice_with_related_quote()` — POST with related_quote links the invoice to the quote.
- `test_create_invoice_with_initial_status_sent()` — POST with initial_status=sent creates invoice and transitions to sent atomically.
- `test_create_invoice_with_initial_status_sent_freezes_org_identity()` — initial_status=sent should freeze org identity fields on the invoice.
- `test_related_quote_must_belong_to_same_project()` — related_quote from a different project is rejected.
- `test_related_quote_must_be_approved()` — related_quote that is not approved is rejected.
- `test_duplicate_related_quote_blocked()` — Second invoice with same related_quote is rejected (409).
- `test_duplicate_related_quote_allowed_after_void()` — Voiding the linked invoice allows re-creating with the same quote.
- `test_invoice_list_includes_related_quote_field()` — GET invoice list includes the related_quote field.

- `_verified_session(public_token, document_type, document_id, email)` — Create a verified OTP session for public decision tests.

### `backend/core/tests/test_mvp_regression.py`

**Depends on:**
- `from core.tests.common import *`

**class MvpRegressionMoneyLoopTests(TestCase)**
> QA-02 baseline: protect the full money loop from regressions.
- `setUp()`
- `test_end_to_end_mvp_money_loop_regression()`


### `backend/core/tests/test_organization_invoice_defaults_backfill.py`

**Depends on:**
- `from core.tests.common import *`

**class OrganizationInvoiceDefaultsBackfillCommandTests(TestCase)**
- `test_command_populates_missing_defaults_without_overwriting_existing_custom_values()`


### `backend/core/tests/test_organization_management.py`

**Depends on:**
- `from core.tests.common import *`

**class OrganizationManagementTests(TestCase)**
- `setUp()`
- `test_organization_endpoints_require_authentication()`
- `test_organization_profile_get_returns_profile_and_role_policy()`
- `test_organization_profile_patch_identity_requires_org_identity_edit()`
- `test_organization_profile_patch_presets_allows_pm_but_forbids_viewer()`
- `test_organization_profile_patch_updates_org_defaults()`
- `test_organization_profile_patch_validates_delta_range()`
- `test_organization_memberships_list_is_scoped_to_active_org()`
- `test_organization_membership_patch_requires_users_edit_role_capability()`
- `test_owner_can_update_membership_role_and_status_with_audit_records()`
- `test_owner_cannot_self_disable_or_self_downgrade_role()`
- `test_organization_membership_patch_returns_not_found_for_other_org()`
- `test_complete_onboarding_requires_authentication()`
- `test_complete_onboarding_sets_flag()`
- `test_complete_onboarding_is_idempotent()`
- `test_complete_onboarding_any_member_role_can_call()` — Even a viewer can complete onboarding — no RBAC gate.
- `test_logo_upload_requires_authentication()`
- `test_logo_upload_requires_org_identity_edit_capability()` — Viewer lacks org_identity.edit and should get 403.
- `test_logo_upload_rejects_missing_file()`
- `test_logo_upload_rejects_unsupported_content_type()`
- `test_logo_upload_rejects_file_too_large()`
- `test_logo_upload_succeeds_for_owner()`
- `test_logo_upload_creates_audit_record()`
- `test_logo_upload_accepts_all_allowed_types()`


### `backend/core/tests/test_password_reset.py`
_Tests for the forgot-password / reset-password flow._

**Depends on:**
- `from core.models import EmailRecord, EmailVerificationToken, Organization, OrganizationMembership, PasswordResetToken`

**class PasswordResetTokenModelTests(TestCase)**
- `setUp()`
- `test_token_auto_generated_on_save()`
- `test_expiry_auto_set_to_1_hour()`
- `test_lookup_valid_success()`
- `test_lookup_valid_not_found()`
- `test_lookup_valid_consumed()`
- `test_lookup_valid_expired()`

**class ForgotPasswordTests(TestCase)**
- `setUp()`
- `test_returns_200_for_valid_email()`
- `test_creates_password_reset_token()`
- `test_sends_password_reset_email()`
- `test_anti_enumeration_nonexistent_email()`
- `test_unverified_user_gets_verification_email()` — Unverified users get a verification email instead of a password reset.
- `test_rate_limited()`
- `test_missing_email_returns_400()`
- `test_deletes_old_unconsumed_tokens()`

**class ResetPasswordTests(TestCase)**
- `setUp()`
- `test_reset_valid_token()`
- `test_password_actually_changed()`
- `test_token_consumed_after_reset()`
- `test_consumed_token_returns_410()`
- `test_expired_token_returns_410()`
- `test_invalid_token_returns_404()`
- `test_missing_token_returns_400()`
- `test_missing_password_returns_400()`
- `test_short_password_returns_400()`
- `test_auto_login_returns_auth_payload()`

**class RegisterDuplicateEmailTests(TestCase)**
- `test_verified_user_gets_password_reset_email()` — Re-registering with a verified user's email sends a password reset.
- `test_unverified_user_gets_verification_resend()` — Re-registering with an unverified user's email re-sends verification.
- `test_duplicate_registration_respects_rate_limit()` — Re-registration email sending respects the 60s rate limit.
- `test_response_still_anti_enumeration()` — Duplicate registration still returns same 200 regardless.

- `_bootstrap_user(email, password, is_active)` — Create a user with org + membership for auth payload generation.

### `backend/core/tests/test_payments.py`

**Depends on:**
- `from core.tests.common import *`

**class PaymentTests(TestCase)**
- `setUp()`
- `_create_payment(status, amount, direction, target_type, target_id)` — Create a payment via the API.
- `_create_invoice(total, status)`
- `_create_vendor_bill(total, status)`
- `test_payment_contract_requires_authentication()`
- `test_payment_contract_matches_model_transition_policy()`
- `test_payment_create_and_project_list()`
- `test_payment_create_with_target_updates_invoice_balance()`
- `test_payment_create_with_target_updates_vendor_bill_balance()`
- `test_payment_list_scoped_by_project_and_user()`
- `test_payment_status_transition_validation()`
- `test_payment_patch_updates_date_reference_notes()`
- `test_payment_patch_blocks_amount_and_method_changes()` — Amount and method are immutable — void and recreate instead.
- `test_payment_blocks_draft_invoice_target()` — Cannot record payment against a draft invoice.
- `test_payment_blocks_direction_target_mismatch()` — Inbound payment cannot target a vendor bill.
- `test_payment_requires_target_document()` — Every payment must allocate to a document — reject freestanding payments.
- `test_payment_records_append_for_status_change()`
- `test_payment_record_is_immutable()`
- `test_payment_validates_required_fields_and_positive_amount()`
- `test_void_payment_reopens_outstanding_invoice_to_sent()` — Voiding the only payment on an outstanding invoice should revert to sent.
- `test_void_one_of_two_payments_keeps_invoice_outstanding()` — Voiding one of two payments on an outstanding invoice should keep it outstanding.
- `test_void_payment_restores_vendor_bill_balance()` — Voiding a payment restores the vendor bill's balance_due without changing document status.
- `test_user_cannot_manually_transition_outstanding_invoice_to_sent()` — The outstanding → sent transition should only be allowed by the system, not by user API calls.
- `test_payment_amount_edit_is_blocked()` — Amount is immutable after creation — void and recreate instead.


### `backend/core/tests/test_projects_cost_codes.py`

**Depends on:**
- `from core.tests.common import *`

**class ProjectProfileTests(TestCase)**
- `setUp()`
- `test_projects_list_requires_authentication()`
- `test_projects_list_returns_only_current_user_projects()`
- `test_projects_list_includes_rows_created_by_other_user_in_same_org()` — Projects in the same org are visible regardless of who created them.
- `test_project_patch_updates_profile_fields()`
- `test_project_patch_returns_not_found_for_other_users_project()`
- `test_project_patch_site_address_does_not_modify_customer_billing_address()`
- `test_project_patch_rejects_contract_value_original_change()`
- `test_project_patch_rejects_contract_value_current_change()`
- `test_project_patch_rejects_invalid_status_transitions()`
- `test_project_patch_allows_active_on_hold_round_trip()`
- `test_project_patch_rejects_noop_same_status_without_other_changes()`

**class CostCodeTests(TestCase)**
- `setUp()`
- `test_cost_codes_list_requires_auth()`
- `test_cost_codes_list_scoped_to_current_user()`
- `test_cost_codes_list_includes_rows_created_by_other_user_in_same_org()`
- `test_cost_code_create()`
- `test_cost_code_create_rejects_inactive()`
- `test_cost_code_create_rejects_duplicate_code_in_same_org()`
- `test_cost_code_patch()`
- `test_cost_code_patch_rejects_code_change()`
- `test_cost_code_delete_is_blocked_by_policy()`
- `test_cost_code_queryset_delete_is_blocked_by_policy()`

**class ProjectFinancialSummaryTests(TestCase)**
- `setUp()`
- `_seed_financial_records()`
- `test_project_financial_summary_returns_expected_metrics()`
- `test_project_financial_summary_accepted_contract_total_is_zero_without_approved_docs()`
- `test_project_accounting_export_json_and_csv_match_summary_totals()`
- `test_project_financial_summary_scoped_and_requires_auth()`

**class ReportingPackTests(TestCase)**
- `setUp()`
- `_seed_reporting_records()`
- `test_portfolio_snapshot_reports_rollups()`
- `test_change_impact_summary_supports_date_filters()`
- `test_reporting_endpoints_validate_dates_and_scope_to_user()`
- `test_attention_feed_returns_actionable_items()`
- `test_quick_jump_search_returns_cross_entity_results()`
- `test_quick_jump_search_minimum_query_and_scope()`

**class ProjectTimelineTests(TestCase)**
- `setUp()`
- `test_project_timeline_returns_workflow_events()`
- `test_project_timeline_category_filter_validation_and_scope()`

**class RoleHardeningTests(TestCase)**
- `setUp()`
- `test_auth_me_returns_effective_role()`
- `test_viewer_cannot_create_invoice_or_payment()`
- `test_bookkeeping_can_create_payment()`
- `test_viewer_cannot_mutate_cost_codes_or_vendors()`


### `backend/core/tests/test_public_signing.py`
_Tests for public document signing — OTP verification, signing ceremony, and ceremony validation._

**Depends on:**
- `from core.tests.common import *`
- `from core.utils.signing import CEREMONY_CONSENT_TEXT, CEREMONY_CONSENT_TEXT_VERSION, compute_consent_text_version, compute_document_content_hash, mask_email`

**class DocumentAccessSessionModelTests(TestCase)**
> Tests for the DocumentAccessSession model lifecycle.
- `test_save_auto_generates_code_and_session_token()`
- `test_is_expired_false_for_fresh_session()`
- `test_is_expired_true_when_past_expiry()`
- `test_is_verified_false_before_verification()`
- `test_is_verified_true_after_verification()`
- `test_is_session_valid_true_for_fresh_verified_session()`
- `test_is_session_valid_false_when_session_expired()`
- `test_is_session_valid_false_before_verification()`
- `test_lookup_for_verification_success()`
- `test_lookup_for_verification_not_found()`
- `test_lookup_for_verification_expired()`
- `test_lookup_for_verification_already_verified()`
- `test_lookup_valid_session_success()`
- `test_lookup_valid_session_not_found()`
- `test_lookup_valid_session_expired()`

**class SigningCeremonyRecordModelTests(TestCase)**
> Tests for the SigningCeremonyRecord immutable audit artifact.
- `test_record_creates_ceremony()`
- `test_record_is_immutable()`

**class SigningUtilitiesTests(TestCase)**
> Tests for content hashing, email masking, and consent text utilities.
- `test_compute_quote_content_hash_is_deterministic()`
- `test_compute_change_order_content_hash_is_deterministic()`
- `test_compute_invoice_content_hash_is_deterministic()`
- `test_content_hash_changes_with_content()`
- `test_content_hash_excludes_volatile_fields()`
- `test_mask_email_standard()`
- `test_mask_email_single_char()`
- `test_mask_email_empty()`
- `test_consent_text_version_is_deterministic()`

**class OtpViewFlowTests(TestCase)**
> Integration tests for OTP request and verification endpoints.
- `setUp()`
- `test_request_otp_returns_email_hint()`
- `test_request_otp_no_customer_email_returns_422()`
- `test_request_otp_rate_limit_within_60s()`
- `test_request_otp_invalid_document_returns_404()`
- `test_verify_otp_valid_code_returns_session_token()`
- `test_verify_otp_wrong_code_returns_404()`
- `test_verify_otp_expired_code_returns_410()`
- `test_verify_otp_already_verified_returns_409()`
- `test_verify_otp_missing_code_returns_400()`

**class CeremonyDecisionValidationTests(TestCase)**
> Tests for ceremony validation on public decision endpoints.
- `setUp()`
- `_ceremony_payload(session)` — Build a valid ceremony payload dict, allowing overrides for specific fields.
- `test_decision_with_valid_ceremony_succeeds()`
- `test_decision_creates_signing_ceremony_record()`
- `test_decision_without_session_token_returns_403()`
- `test_decision_without_signer_name_returns_400()`
- `test_decision_without_consent_returns_400()`
- `test_decision_with_invalid_session_returns_403()`
- `test_decision_with_expired_session_returns_403()`
- `test_decision_without_customer_email_returns_422()`

**class PublicSigningEdgeCaseTests(TestCase)**
> Edge case tests for public signing — double-approve, cross-doc reuse, OTP limits, etc.
- `setUp()`
- `_ceremony_payload(session)`
- `test_double_approve_returns_409_conflict()` — Approving an already-approved quote returns 409.
- `test_session_token_scoped_to_document()` — A session token for quote_a cannot be used on quote_b's decision endpoint.
- `test_max_otp_attempts_then_new_otp_succeeds()` — After max failed attempts, requesting a new OTP and verifying it works.
- `test_reject_decision_creates_ceremony_record()` — Rejecting an quote creates a SigningCeremonyRecord with decision='reject'.
- `test_empty_whitespace_otp_code_returns_400()` — Submitting a whitespace-only OTP code returns 400 validation_error.
- `test_decision_on_draft_quote_returns_409()` — Attempting a decision on a DRAFT quote returns 409 conflict.
- `test_max_attempts_blocks_correct_code()` — Even the correct OTP code is rejected after max failed attempts.

- `_create_verified_session(public_token, document_type, document_id, email)` — Create a DocumentAccessSession that has been OTP-verified with an active session.

### `backend/core/tests/test_push.py`

**Depends on:**
- `from core.tests.common import *`
- `from core.models.shared_operations.push_subscription import PushSubscription`

**class PushSubscribeTests(TestCase)**
- `setUp()`
- `test_subscribe_rejects_unauthenticated()`
- `test_subscribe_happy_path()`
- `test_subscribe_missing_endpoint()`
- `test_subscribe_missing_keys()`
- `test_subscribe_missing_p256dh()`
- `test_subscribe_missing_auth_key()`
- `test_subscribe_empty_body()`
- `test_subscribe_upsert_same_endpoint_updates()` — Re-subscribing with the same endpoint updates keys, not duplicates.
- `test_subscribe_different_endpoints_create_separate_rows()`

**class PushUnsubscribeTests(TestCase)**
- `setUp()`
- `test_unsubscribe_rejects_unauthenticated()`
- `test_unsubscribe_happy_path()`
- `test_unsubscribe_missing_endpoint()`
- `test_unsubscribe_nonexistent_endpoint_succeeds()` — Unsubscribing from an endpoint that doesn't exist still returns 200.
- `test_unsubscribe_only_removes_own_subscriptions()` — User B cannot unsubscribe User A's endpoint.

**class PushStatusTests(TestCase)**
- `setUp()`
- `test_status_rejects_unauthenticated()`
- `test_status_no_subscriptions()`
- `test_status_with_subscriptions()`
- `test_status_only_counts_own_subscriptions()` — Other users' subscriptions are not included in my count.

**class PushLifecycleTests(TestCase)**
> Full lifecycle: subscribe -> status -> unsubscribe -> status.
- `setUp()`
- `test_full_lifecycle()`

- `_subscribe_payload(endpoint, keys)`

### `backend/core/tests/test_rbac_capabilities.py`

**Depends on:**
- `from core.tests.common import *`
- `from core.rbac import _capability_gate`
- `from core.user_helpers import RBAC_ROLE_OWNER, _resolve_user_role, _resolve_user_capabilities, _ensure_org_membership`

**class ResolveUserCapabilitiesTests(TestCase)**
> Tests for _resolve_user_capabilities resolution chain.
- `setUp()`
- `_make_membership(role, role_template, capability_flags_json)`
- `test_resolves_from_assigned_role_template()`
- `test_falls_back_to_system_template_by_role_slug()`
- `test_owner_system_template_has_full_capabilities()`
- `test_pm_cannot_edit_org_identity()`
- `test_per_membership_overrides_merge_additively()`
- `test_no_prior_membership_bootstraps_owner_capabilities()`
- `test_inactive_membership_bootstraps_via_ensure()`
- `test_bookkeeping_has_invoice_create_but_not_send()`
- `test_worker_cannot_approve_or_pay()`

**class CapabilityGateTests(TestCase)**
> Tests for _capability_gate allow/deny behavior.
- `setUp()`
- `test_gate_allows_when_capability_present()`
- `test_gate_denies_when_capability_missing()`
- `test_gate_denies_for_unknown_resource()`
- `test_gate_returns_capabilities_even_on_deny()`

**class OrgProfileCapabilityGateTests(TestCase)**
> Tests for field-level org profile PATCH capability gates.
- `setUp()`
- `test_owner_can_edit_identity_and_presets()`
- `test_pm_can_edit_presets_but_not_identity()`
- `test_worker_cannot_edit_identity_or_presets()`
- `test_role_policy_reflects_capabilities()`

**class AuthCapabilitiesResponseTests(TestCase)**
> Tests that auth endpoints include capabilities in their responses.
- `test_login_response_includes_capabilities()`
- `test_verify_email_response_includes_capabilities()`
- `test_me_response_includes_capabilities()`
- `test_viewer_capabilities_are_view_only()`

**class ResolveUserRoleTests(TestCase)**
> Tests for role resolution from active membership.
- `setUp()`
- `test_resolves_from_active_membership()`
- `test_fallback_owner_when_no_membership()`

**class OrganizationDeriveNameTests(TestCase)**
> Tests for deriving default org name from user identity.
- `test_email_based()`
- `test_username_fallback()`
- `test_id_fallback()`

**class OrganizationSnapshotTests(TestCase)**
> Tests for immutable audit snapshot builders.
- `setUp()`
- `test_build_organization_snapshot()`
- `test_build_organization_membership_snapshot()`

**class OrganizationAuditRecordTests(TestCase)**
> Tests for immutable audit record creation.
- `setUp()`
- `test_record_organization_record()`
- `test_record_organization_membership_record()`

**class CostCodeSeedDefaultsTests(TestCase)**
> Tests for seeding default cost codes on new organizations.
- `setUp()`
- `test_creates_default_codes()`
- `test_idempotent_on_rerun()`

**class EnsurePrimaryMembershipTests(TestCase)**
> Tests for the membership bootstrap / self-heal function.
- `test_returns_existing_active_membership()`
- `test_bootstraps_org_and_membership_for_new_user()`
- `test_bootstrap_creates_audit_records()`
- `test_bootstrap_seeds_default_cost_codes()`
- `test_idempotent_returns_same_membership()`


### `backend/core/tests/test_receipt_scan.py`

**Depends on:**
- `from core.tests.common import *`

**class ReceiptScanTests(TestCase)**
- `setUp()`
- `test_scan_requires_authentication()`
- `test_scan_rejects_missing_image()` `@dict`
- `test_scan_rejects_unsupported_content_type()` `@dict`
- `test_scan_rejects_image_too_large()` `@dict`
- `test_scan_returns_503_when_gemini_api_key_not_configured()` `@dict`
- `test_scan_accepts_all_allowed_content_types()` `@dict` — All four allowed types pass content-type validation (hit 503 for missing API key, not 400).
- `test_scan_requires_vendor_bills_create_capability()` — A viewer (no vendor_bills.create capability) gets 403.


### `backend/core/tests/test_reporting.py`
_Tests for reporting and dashboard endpoints._

**Depends on:**
- `from core.tests.common import *`

**class ReportingTestBase(TestCase)**
> Shared setUp for all reporting tests.
- `setUp()`
- `_auth(token)`

**class PortfolioSnapshotTests(ReportingTestBase)**
- `test_returns_empty_portfolio_with_no_data()`
- `test_counts_overdue_invoices()`
- `test_counts_overdue_vendor_bills()`
- `test_org_scoping_excludes_other_org_data()`
- `test_invalid_date_filter_returns_400()`
- `test_unauthenticated_returns_401()`

**class ChangeImpactSummaryTests(ReportingTestBase)**
- `test_returns_empty_when_no_approved_change_orders()`
- `test_counts_approved_change_orders()`
- `test_org_scoping_excludes_other_org_change_orders()`

**class AttentionFeedTests(ReportingTestBase)**
- `test_returns_empty_feed_when_nothing_is_actionable()`
- `test_overdue_invoices_appear_as_high_severity()`
- `test_due_soon_vendor_bills_appear_as_medium_severity()`
- `test_pending_change_orders_appear_as_medium_severity()`
- `test_void_payments_appear_as_low_severity()`
- `test_items_sorted_by_severity_high_first()`
- `test_org_scoping_excludes_other_org_items()`

**class QuickJumpSearchTests(ReportingTestBase)**
- `test_returns_empty_for_short_query()`
- `test_returns_empty_for_missing_query()`
- `test_matches_project_by_name()`
- `test_matches_invoice_by_number()`
- `test_matches_change_order_by_family_key()`
- `test_org_scoping_excludes_other_org_results()`
- `test_case_insensitive_search()`
- `test_unauthenticated_returns_401()`

**class ProjectTimelineEventsTests(ReportingTestBase)**
- `test_returns_empty_timeline_for_project_with_no_events()`
- `test_returns_quote_status_events()`
- `test_workflow_category_filter()`
- `test_financial_category_filter_excludes_workflow_events()`
- `test_invalid_category_returns_400()`
- `test_nonexistent_project_returns_404()`
- `test_other_org_project_returns_404()`


### `backend/core/tests/test_vendor_bills.py`

**Depends on:**
- `from core.tests.common import *`

**class VendorBillTests(TestCase)**
- `setUp()`
- `_create_vendor_bill(bill_number, total)` — Create a bill via API.
- `test_vendor_bill_contract_requires_authentication()`
- `test_vendor_bill_contract_matches_model_transition_policy()`
- `test_vendor_bill_create_and_project_list()` — Bills are created in open status with description+amount line items.
- `test_vendor_bill_create_requires_issue_date()` — Bills require issue_date (all bills start as open).
- `test_vendor_bill_list_scoped_by_project_and_user()`
- `test_vendor_bill_duplicate_requires_existing_match_to_be_void()`
- `test_vendor_bill_document_lifecycle_transitions()` — Walk through the full document lifecycle: open → void, open → closed.
- `test_vendor_bill_disputed_and_closed_transitions()` — Open bills can be disputed; disputed bills can return to open or be voided.
- `test_vendor_bill_patch_rejects_bill_number_change()`
- `test_vendor_bill_patch_validates_vendor_scope_and_due_dates()`
- `test_vendor_bill_patch_rejects_line_items_with_wrong_org_cost_code()`
- `test_vendor_bill_status_transitions_create_snapshots()` — Each document status transition creates an immutable snapshot.
- `test_vendor_bill_snapshot_payload_captures_line_items_and_context()`
- `test_quick_expense_creation()` — Quick expense creates a VendorBill with null vendor via /expenses/ endpoint.
- `test_quick_expense_defaults_issue_date_to_today()` — Quick expense sets issue_date to today when omitted.
- `test_quick_expense_rejects_missing_total()` — Quick expense returns 400 when total is missing.
- `test_quick_expense_rejects_zero_total()` — Quick expense returns 400 when total is zero.
- `test_quick_expense_rejects_negative_total()` — Quick expense returns 400 when total is negative.
- `test_full_bill_still_requires_vendor_and_bill_number()` — Full vendor bill creation still requires vendor + bill_number + line_items.
- `test_unique_constraint_skipped_for_empty_bill_number()` — Multiple expenses with empty bill_number don't trigger unique constraint.


### `backend/core/tests/test_vendors.py`

**Depends on:**
- `from core.tests.common import *`

**class VendorTests(TestCase)**
- `setUp()`
- `test_vendor_create_and_search()`
- `test_vendor_list_scoped_by_user()`
- `test_vendor_list_includes_rows_created_by_other_user_in_same_org()`
- `test_vendor_duplicate_blocked_on_create_by_name()`
- `test_vendor_different_name_same_email_allowed()`
- `test_vendor_duplicate_name_has_no_override()`
- `test_vendor_patch_duplicate_name_blocked()`
- `test_vendor_patch_updates_fields()`
- `test_vendor_create_assigns_active_organization()`

