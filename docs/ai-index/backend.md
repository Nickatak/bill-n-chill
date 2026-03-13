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
- [Models — Estimating](#models-estimating)
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
- [Views — Estimating](#views-estimating)
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
_CostCode model — reusable financial classification for estimating and billing line items._

**class CostCode(models.Model)**
> Reusable financial classification used across estimating/budgeting/billing line items.
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
- _class_ `DocumentType(models.TextChoices)` — ESTIMATE, CHANGE_ORDER, INVOICE
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
- _class_ `EmailType(models.TextChoices)` — VERIFICATION, PASSWORD_RESET, OTP, DOCUMENT_SENT
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
- _class_ `Meta` — ordering
- `__str__()`
- `clean()` — Validate status transitions and prevent activation under an archived customer.
- `save()` — Run full_clean before persisting to enforce domain constraints.


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
_Vendor model — payee directory record for accounts payable and commitments._

**class Vendor(models.Model)**
> Payee directory record used for AP bills and commitments.
- _class_ `VendorType(models.TextChoices)` — TRADE, RETAIL
- _class_ `Meta` — ordering, constraints
- `__str__()`


## Models — Estimating

### `backend/core/models/estimating/estimate.py`
_Estimate model — mutable operational record for customer-facing project cost proposals._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`
- `from core.utils.tokens import generate_public_token`

**class Estimate(StatusTransitionMixin, models.Model)**
> Customer-facing scope and price proposal for a project.
- _class_ `Status(models.TextChoices)` — DRAFT, SENT, APPROVED, REJECTED, VOID, ARCHIVED
- _class_ `Meta` — ordering, unique_together
- `__str__()`
- `public_slug()` `@property` — URL-safe slug derived from the estimate title.
- `public_ref()` `@property` — Combined slug--token identifier for public sharing URLs.
- `clean()` — Validate status transitions before save.
- `save()` — Auto-generate public token if missing, then validate and persist.


### `backend/core/models/estimating/estimate_line_item.py`
_EstimateLineItem model — individual priced scope row within an estimate version._

**class EstimateLineItem(models.Model)**
> Customer-facing priced scope row inside an estimate version.
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
- _class_ `Status(models.TextChoices)` — DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, VOID
- _class_ `Meta` — ordering, unique_together, constraints, indexes
- `__str__()`
- `public_slug()` `@property` — URL-safe slug derived from family key and revision number.
- `public_ref()` `@property` — Combined slug--token identifier for public sharing URLs.
- `clean()` — Validate approval fields, origin estimate, revision chain, and status transitions.
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
- _class_ `Status(models.TextChoices)` — DRAFT, SENT, PARTIALLY_PAID, PAID, VOID
- _class_ `Meta` — ordering, unique_together, constraints
- `__str__()`
- `public_slug()` `@property` — URL-safe slug derived from the invoice number.
- `public_ref()` `@property` — Combined slug--token identifier for public sharing URLs.
- `clean()` — Validate dates, balance, customer-project match, and status transitions.
- `save()` — Auto-generate public token, zero balance on paid status, then validate and persist.

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
> AP bill received from a vendor/subcontractor for project costs.
- _class_ `Status(models.TextChoices)` — PLANNED, RECEIVED, APPROVED, SCHEDULED, PAID, VOID
- _class_ `Meta` — ordering, constraints
- `__str__()`
- `clean()` — Validate due date, scheduled_for requirement, and status transitions.
- `build_snapshot()` — Point-in-time snapshot for immutable audit records.
- `save()` — Run full_clean before persisting to enforce domain constraints.

**class VendorBillLine(models.Model)**
> Individual line item on a vendor bill.
- _class_ `Meta` — ordering
- `__str__()`


## Models — Cash Management

### `backend/core/models/cash_management/payment.py`
_Payment and PaymentAllocation models — cash movement records with AR/AP allocation._

**Depends on:**
- `from core.models.mixins import StatusTransitionMixin`

**class Payment(StatusTransitionMixin, models.Model)**
> Recorded money movement at the organization level (AR inbound or AP outbound).
- _class_ `Direction(models.TextChoices)` — INBOUND, OUTBOUND
- _class_ `Method(models.TextChoices)` — ACH, CARD, CHECK, WIRE, ZELLE, CASH, OTHER
- _class_ `Status(models.TextChoices)` — PENDING, SETTLED, VOID
- _class_ `Meta` — ordering
- `allocated_total()` `@property` — Sum of all applied allocation amounts for this payment.
- `unapplied_amount()` `@property` — Remaining payment amount not yet allocated to invoices or bills.
- `clean()` — Validate status transitions before save.
- `save()` — Run full_clean before persisting to enforce domain constraints.
- `build_snapshot()` — Point-in-time snapshot for immutable audit records.
- `__str__()`

**class PaymentAllocation(models.Model)**
> Applied amount from one payment to one invoice or vendor bill.
- _class_ `TargetType(models.TextChoices)` — INVOICE, VENDOR_BILL
- _class_ `Meta` — ordering
- `build_snapshot()` — Point-in-time snapshot for immutable audit records (includes parent payment).
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
- `record(change_order, decision_status: str, previous_status: str, applied_financial_delta, decided_by)` `@classmethod` — Append an immutable snapshot row for a change-order decision event.
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


### `backend/core/models/financial_auditing/estimate_status_event.py`
_EstimateStatusEvent model — immutable audit trail of estimate status transitions._

**class EstimateStatusEvent(models.Model)**
> Audit trail of estimate status transitions.
- _class_ `Meta` — ordering
- `record(estimate, from_status, to_status, note, changed_by)` `@classmethod` — Append an immutable estimate status transition row.
- `__str__()`


### `backend/core/models/financial_auditing/invoice_status_event.py`
_InvoiceStatusEvent model — immutable audit trail of invoice status transitions._

**class InvoiceStatusEvent(models.Model)**
> Audit trail of invoice status transitions.
- _class_ `Meta` — ordering
- `record(invoice, from_status, to_status, note, changed_by)` `@classmethod` — Append an immutable invoice status transition row.
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


### `backend/core/models/financial_auditing/payment_allocation_record.py`
_PaymentAllocationRecord model — immutable audit capture for payment-allocation events._

**Depends on:**
- `from core.models.mixins import ImmutableModelMixin`

**class PaymentAllocationRecord(ImmutableModelMixin)**
> Immutable audit record for payment-allocation provenance captures.
- _class_ `EventType(models.TextChoices)` — APPLIED, REVERSED
- _class_ `CaptureSource(models.TextChoices)` — MANUAL_UI, MANUAL_API, SYSTEM
- _class_ `TargetType(models.TextChoices)` — INVOICE, VENDOR_BILL
- _class_ `Meta` — ordering
- `record(payment, allocation, event_type: str, capture_source: str, target_type: str, target_object_id: int, recorded_by, source_reference: str, note: str, metadata: dict | None)` `@classmethod` — Append an immutable audit row for a payment allocation event.
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
> Immutable AP lifecycle snapshot for financially meaningful vendor-bill statuses.
- _class_ `CaptureStatus(models.TextChoices)` — RECEIVED, APPROVED, SCHEDULED, PAID, VOID
- _class_ `Meta` — ordering
- `record(vendor_bill, capture_status: str, previous_status: str, acted_by)` `@classmethod` — Append an immutable snapshot row for a vendor-bill status transition.
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
- `from core.models import ChangeOrder, ChangeOrderLine`

**class ChangeOrderLineSerializer(serializers.ModelSerializer)**
> Read-only change order line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class ChangeOrderSerializer(serializers.ModelSerializer)**
> Read-only change order with nested line items and revision context.
- _class_ `Meta` — model, fields, read_only_fields
- `get_is_latest_revision(obj)` — Return whether this change order is the latest revision in its family.
- `get_line_total_delta(obj)` — Return the sum of all line item amount deltas as a decimal string.

**class ChangeOrderLineInputSerializer(serializers.Serializer)**
> Write serializer for a single change order line item in a create/update payload.

**class ChangeOrderWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating a change order with line items.


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

### `backend/core/serializers/estimates.py`
_Estimate serializers for read, write, duplication, and status-event representations._

**Depends on:**
- `from core.models import Estimate, EstimateLineItem, EstimateStatusEvent`
- `from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display`

**class EstimateLineItemSerializer(serializers.ModelSerializer)**
> Read-only estimate line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class EstimateSerializer(serializers.ModelSerializer)**
> Read-only estimate with nested line items.
- _class_ `Meta` — model, fields, read_only_fields

**class EstimateStatusEventSerializer(serializers.ModelSerializer)**
> Read-only estimate status event with computed action type and actor display.
- _class_ `Meta` — model, fields, read_only_fields
- `get_action_type(obj: EstimateStatusEvent)` — Classify the event as create, transition, resend, notate, or unchanged.
- `get_changed_by_display(obj: EstimateStatusEvent)` — Return a human-readable display name for the actor who changed the status.
- `get_changed_by_customer_id(obj: EstimateStatusEvent)` — Return the customer ID if the actor acted via a public token.

**class EstimateLineItemInputSerializer(serializers.Serializer)**
> Write serializer for a single estimate line item in a create/update payload.

**class EstimateWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating an estimate with line items.
- `validate_title(value: str)`
- `validate_status(value: str)`

**class EstimateDuplicateSerializer(serializers.Serializer)**
> Write serializer for duplicating an estimate to the same or different project.
- `validate_title(value: str)`

- `_estimate_customer(obj)` — Return the customer associated with the status event's estimate project.

### `backend/core/serializers/invoices.py`
_Invoice serializers for read, write, and status-event representations._

**Depends on:**
- `from core.models import Invoice, InvoiceLine, InvoiceStatusEvent`
- `from core.serializers.mixins import resolve_public_actor_customer_id, resolve_public_actor_display`

**class InvoiceLineSerializer(serializers.ModelSerializer)**
> Read-only invoice line item with cost code details.
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
_Payment and payment allocation serializers for read, write, and allocation flows._

**Depends on:**
- `from core.models import Payment, PaymentAllocation`

**class PaymentAllocationSerializer(serializers.ModelSerializer)**
> Read-only payment allocation with polymorphic target ID resolution.
- _class_ `Meta` — model, fields, read_only_fields
- `get_target_id(obj: PaymentAllocation)` — Return the invoice or vendor bill ID based on target type.

**class PaymentSerializer(serializers.ModelSerializer)**
> Read-only payment with nested allocations and computed totals.
- _class_ `Meta` — model, fields, read_only_fields
- `get_customer_name(obj: Payment)` — Return customer display name or empty string.
- `get_project_name(obj: Payment)` — Return project name or empty string for unassigned payments.

**class PaymentWriteSerializer(serializers.Serializer)**
> Write serializer for creating or updating a payment.

**class PaymentAllocationInputSerializer(serializers.Serializer)**
> Write serializer for a single allocation entry in an allocate payload.

**class PaymentAllocateSerializer(serializers.Serializer)**
> Write serializer for batch-allocating a payment to invoices or vendor bills.


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
- `from core.models import VendorBill, VendorBillLine`

**class VendorBillLineSerializer(serializers.ModelSerializer)**
> Read-only vendor bill line item with cost code details.
- _class_ `Meta` — model, fields, read_only_fields

**class VendorBillSerializer(serializers.ModelSerializer)**
> Read-only vendor bill with nested line items and vendor/project names.
- _class_ `Meta` — model, fields, read_only_fields

**class VendorBillLineInputSerializer(serializers.Serializer)**
> Write serializer for a single vendor bill line item.

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

### `backend/core/policies/estimates.py`
_Estimate policy contracts shared with UI consumers._

**Depends on:**
- `from core.models import Estimate`
- `from core.policies._base import _build_base_policy_contract`

- `get_estimate_policy_contract()` — Return canonical estimate workflow policy for UI consumers.

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
- `from core.utils.email import send_password_reset_email, send_verification_email`
- `from core.user_helpers import _ensure_membership, _resolve_user_capabilities`

- `_build_auth_response_payload(user, membership)` — Build the standard auth response payload dict.
- `_lookup_valid_invite(token_str)` — Look up a valid invite token, returning (invite, error_response).
- `_send_duplicate_registration_email(user)` — Send a contextual email when someone tries to register with an existing email.
- `health_view(_request)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Health probe endpoint used by infra and local readiness checks.
- `login_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Login endpoint: authenticate credentials and return token + role/org context.
- `register_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Registration endpoint with email verification.
- `me_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Current-session profile endpoint with resolved role and organization scope.
- `check_invite_by_email_view()` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Check if a pending invite exists for the given email.
- `verify_invite_view(token)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Verify an invite token and return context for the registration page.
- `accept_invite_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Accept invite as existing user (Flow C).
- `verify_email_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Consume a verification token and authenticate the user.
- `resend_verification_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Resend a verification email.
- `forgot_password_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Request a password reset email.
- `reset_password_view()` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Consume a password reset token and set a new password.
- `impersonate_start_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Start an impersonation session for a target user.
- `impersonate_exit_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — End the current impersonation session.
- `impersonate_users_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List users available for impersonation.

### `backend/core/views/helpers.py`
_Cross-domain shared helpers and re-exports for the view layer._

**Depends on:**
- `from core.models import CostCode, Estimate, Organization, OrganizationMembership, Project`
- `from core.rbac import _capability_gate`
- `from core.user_helpers import _ensure_membership`

- `_validate_project_for_user(project_id: int, user)` — Look up a project by ID, scoped to the user's organization.
- `_validate_estimate_for_user(estimate_id: int, user, prefetch_lines)` — Look up an estimate by ID, authorized via its project's org scope.
- `_resolve_organization_for_public_actor(actor_user)` — Resolve the primary organization for a public-facing actor user.
- `_serialize_public_organization_context(organization: Organization | None)` — Serialize organization branding fields for public-facing document contexts.
- `_serialize_public_project_context(project: Project)` — Serialize project and customer fields for public-facing document contexts.
- `_paginate_queryset(queryset, query_params, default_page_size: int, max_page_size: int)` — Apply page/page_size pagination to a queryset.
- `_parse_request_bool(raw_value, default: bool)` — Coerce a loosely-typed request value to a boolean.
- `_normalized_phone(value: str)` — Strip a phone string to digits only (for duplicate-detection comparisons).
- `_build_public_decision_note(action_label: str, note: str, decider_name: str, decider_email: str)` — Build a human-readable note for a public-link decision (approve/reject/dispute).
- `_cost_code_scope_filter(user)` — Build a Q filter for cost codes visible to the given user's organization.
- `_vendor_scope_filter(user)` — Build a Q filter for vendors visible to the given user's organization.
- `_resolve_cost_codes_for_user(user, line_items_data, cost_code_key)` — Resolve and validate cost code IDs from line item data for the user's org scope.
- `_not_found_response(message: str)` — Return a standard 404 error response.

### `backend/core/views/public_signing.py`
_Public document signing — OTP verification endpoint wrappers._

**Depends on:**
- `from core.views.public_signing_helpers import _request_otp_handler, _verify_otp_handler`

- `public_estimate_request_otp_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Request an OTP code for estimate public link verification.
- `public_estimate_verify_otp_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Verify an OTP code for estimate public link.
- `public_change_order_request_otp_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Request an OTP code for change order public link verification.
- `public_change_order_verify_otp_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Verify an OTP code for change order public link.
- `public_invoice_request_otp_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Request an OTP code for invoice public link verification.
- `public_invoice_verify_otp_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Verify an OTP code for invoice public link.

### `backend/core/views/public_signing_helpers.py`
_Domain-specific helpers for public document signing views._

**Depends on:**
- `from core.models import ChangeOrder, DocumentAccessSession, Estimate, Invoice`
- `from core.utils.email import send_otp_email`
- `from core.utils.signing import CEREMONY_CONSENT_TEXT, CEREMONY_CONSENT_TEXT_VERSION, mask_email`

- `_resolve_document_and_email(document_type, public_token)` — Look up a document by type + public_token and extract the customer email.
- `_resolve_document_title(document_type, document)` — Extract a human-readable title from a document for email context.
- `_request_otp_handler(document_type, public_token)` — Handle a request to send an OTP code for public document verification.
- `_verify_otp_handler(document_type, public_token)` — Handle OTP code verification for a public document session.
- `validate_ceremony_on_decision(public_token, customer_email)` — Validate OTP session and ceremony data before allowing a public decision.
- `get_ceremony_context()` — Return the current consent text and version for use by decision views.

## Views — Shared Operations

### `backend/core/views/shared_operations/accounting.py`
_Shared operational accounting sync endpoints._

**Depends on:**
- `from core.models import AccountingSyncEvent, AccountingSyncRecord`
- `from core.serializers import AccountingSyncEventSerializer, AccountingSyncEventWriteSerializer`
- `from core.views.helpers import _capability_gate, _ensure_membership, _validate_project_for_user`

- `_build_accounting_sync_snapshot(sync_event: AccountingSyncEvent)` — Serialize an accounting sync event into an immutable snapshot dict for audit records.
- `_record_accounting_sync_record(sync_event: AccountingSyncEvent, event_type: str, capture_source: str, recorded_by, from_status: str | None, to_status: str | None, source_reference: str, note: str, metadata: dict | None)` — Create an immutable AccountingSyncRecord with a point-in-time snapshot.
- `project_accounting_sync_events_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project accounting sync events or enqueue a new sync event record.
- `accounting_sync_event_retry_view(sync_event_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Retry a failed accounting sync event by moving it back to `queued`.

### `backend/core/views/shared_operations/cost_codes.py`
_Shared operational cost-code endpoints._

**Depends on:**
- `from core.models import CostCode`
- `from core.serializers import CostCodeSerializer`
- `from core.utils.csv_import import CsvImportError, process_csv_import`
- `from core.views.helpers import _ensure_membership, _parse_request_bool, _capability_gate`
- `from core.views.shared_operations.cost_codes_helpers import _cost_code_scope_filter, _duplicate_code_error_response`

- `cost_codes_list_create_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List organization-scoped cost codes or create a new cost code.
- `cost_code_detail_view(cost_code_id: int)` `@api_view(['PATCH'])` `@permission_classes([IsAuthenticated])` — Patch mutable cost-code fields while enforcing `code` immutability.
- `cost_codes_import_csv_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Import cost codes from CSV in preview/apply mode with header and row validation.

### `backend/core/views/shared_operations/cost_codes_helpers.py`
_Domain-specific helpers for cost-code views._

**Depends on:**
- `from core.views.helpers import _cost_code_scope_filter`

- `_duplicate_code_error_response()` — Return a 400 response for duplicate cost code code within an organization.

### `backend/core/views/shared_operations/customers.py`
_Shared customer-intake endpoints._

**Depends on:**
- `from core.models import Customer, CustomerRecord, LeadContactRecord, Project`
- `from core.serializers import CustomerIntakeQuickAddSerializer, CustomerProjectCreateSerializer, CustomerManageSerializer, CustomerSerializer, ProjectSerializer`
- `from core.views.helpers import _capability_gate, _ensure_membership, _paginate_queryset`
- `from core.views.shared_operations.customers_helpers import _build_customer_duplicate_candidate, _build_intake_payload, _find_duplicate_customers, build_intake_snapshot`

- `customers_list_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List organization-scoped customers with optional free-text filtering.
- `customer_detail_view(customer_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a customer with immutable record capture on writes.
- `customer_project_create_view(customer_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Create a new project directly from a customer context.
- `quick_add_customer_intake_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Create customer-first intake rows with immutable provenance and optional project creation.

### `backend/core/views/shared_operations/customers_helpers.py`
_Domain-specific helpers for customer intake views._

**Depends on:**
- `from core.models import Customer`
- `from core.views.helpers import _ensure_membership, _normalized_phone`

- `_find_duplicate_customers(user, phone: str, email: str)` — Find existing customers matching by phone or email for duplicate detection.
- `_build_customer_duplicate_candidate(customer: Customer)` — Serialize a customer into a lightweight duplicate-candidate dict.
- `_build_intake_payload(payload: dict, intake_record_id: int | None, created_at, converted_customer_id: int | None, converted_project_id: int | None, converted_at)` — Build the customer_intake sub-dict for a LeadContactRecord snapshot.
- `build_intake_snapshot(payload: dict, intake_record_id: int | None, converted_customer_id: int | None, converted_project_id: int | None, converted_at)` — Build the snapshot_json dict for a LeadContactRecord.

### `backend/core/views/shared_operations/organization_invites.py`
_Organization invite management endpoints (create, list, revoke)._

**Depends on:**
- `from core.models import OrganizationInvite, RoleTemplate`
- `from core.serializers.organization_management import OrganizationInviteCreateSerializer, OrganizationInviteSerializer`
- `from core.rbac import _capability_gate`
- `from core.user_helpers import _ensure_membership`

- `organization_invites_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List or create organization invites.
- `organization_invite_detail_view(invite_id: int)` `@api_view(['DELETE'])` `@permission_classes([IsAuthenticated])` — Revoke (delete) a pending organization invite.

### `backend/core/views/shared_operations/organization_management.py`
_Organization profile and RBAC membership management endpoints._

**Depends on:**
- `from core.models import OrganizationMembership, OrganizationMembershipRecord, OrganizationRecord`
- `from core.serializers.organization_management import OrganizationMembershipSerializer, OrganizationMembershipUpdateSerializer, OrganizationProfileSerializer, OrganizationProfileUpdateSerializer`
- `from core.rbac import _capability_gate`
- `from core.user_helpers import _ensure_membership`
- `from core.views.shared_operations.organization_management_helpers import _is_last_active_owner, _organization_membership_queryset, _organization_role_policy`

- `organization_profile_view()` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch organization profile for the caller's active membership org.
- `complete_onboarding_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Mark the caller's organization onboarding as completed.
- `organization_logo_upload_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Upload or replace the organization logo image.
- `organization_memberships_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List memberships for caller's active organization scope.
- `organization_membership_detail_view(membership_id: int)` `@api_view(['PATCH'])` `@permission_classes([IsAuthenticated])` — Patch one organization membership's role/status (requires users.edit_role).

### `backend/core/views/shared_operations/organization_management_helpers.py`
_Domain-specific helpers for organization management views._

**Depends on:**
- `from core.models import OrganizationMembership`
- `from core.user_helpers import _resolve_user_capabilities, _resolve_user_role`

- `_organization_role_policy(user)` — Build the role policy dict describing the user's effective permissions for the org console.
- `_organization_membership_queryset(organization_id: int)` — Return the ordered membership queryset for an organization with user relations loaded.
- `_is_last_active_owner(membership: OrganizationMembership, next_role: str, next_status: str)` — Return True if changing this membership would leave the organization with no active owner.

### `backend/core/views/shared_operations/projects.py`
_Project CRUD and detail endpoints._

**Depends on:**
- `from core.models import ChangeOrder, Estimate, Project`
- `from core.serializers import ChangeOrderSerializer, EstimateLineItemSerializer, ProjectFinancialSummarySerializer, ProjectProfileSerializer, ProjectSerializer`
- `from core.views.helpers import _capability_gate, _ensure_membership`
- `from core.views.shared_operations.projects_helpers import _build_project_financial_summary_data, _project_accepted_contract_totals_map`

- `projects_list_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — List projects visible to the authenticated owner context.
- `project_detail_view(project_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch a project profile with terminal-state and transition protections.
- `project_financial_summary_view(project_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return normalized AR/AP/CO financial summary plus traceability for one project.
- `project_accounting_export_view(project_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Export project accounting summary as JSON or CSV (`export_format` query param).
- `project_contract_breakdown_view(project_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return the active financial baseline estimate and approved change orders for a project.
- `project_audit_events_view(project_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Audit events endpoint — removed.

### `backend/core/views/shared_operations/projects_helpers.py`
_Domain-specific helpers for project views._

**Depends on:**
- `from core.models import ChangeOrder, Estimate, Invoice, Payment, PaymentAllocation, Project, VendorBill`

- `_parse_optional_date(value: str)` — Parse an ISO date string, returning (date, None) on success or (None, errors) on failure.
- `_date_filter_from_query()` — Extract and validate date_from/date_to query params.
- `_project_accepted_contract_totals_map(project_ids)` — Return a dict mapping project IDs to their accepted contract total (approved estimate + approved COs).
- `_build_project_financial_summary_data(project: Project, user)` — Build a complete financial summary dict for a project with AR/AP totals and traceability links.

### `backend/core/views/shared_operations/reporting.py`
_Cross-project reporting and dashboard endpoints._

**Depends on:**
- `from core.models import ChangeOrder, Estimate, EstimateStatusEvent, Invoice, Payment, Project, VendorBill`
- `from core.serializers import AttentionFeedSerializer, ChangeImpactSummarySerializer, PortfolioSnapshotSerializer, ProjectTimelineSerializer, QuickJumpSearchSerializer`
- `from core.views.helpers import _ensure_membership`
- `from core.views.shared_operations.projects_helpers import _build_project_financial_summary_data, _date_filter_from_query`

- `portfolio_snapshot_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return portfolio-level snapshot metrics with optional date filtering.
- `change_impact_summary_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return approved change-order impact totals, grouped by project, with date filters.
- `attention_feed_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return prioritized operational attention items (overdue, pending, and problem states).
- `quick_jump_search_view()` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Search key entities by lightweight text query for fast navigation jump points.
- `project_timeline_events_view(project_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return merged project timeline events by category (`all|financial|workflow`).

### `backend/core/views/shared_operations/vendors.py`
_Shared operational vendor endpoints._

**Depends on:**
- `from core.models import Vendor`
- `from core.serializers import VendorSerializer, VendorWriteSerializer`
- `from core.utils.csv_import import CsvImportError, process_csv_import`
- `from core.views.helpers import _ensure_membership, _paginate_queryset, _parse_request_bool, _capability_gate`
- `from core.views.shared_operations.vendors_helpers import _find_duplicate_vendors, _vendor_scope_filter`

- `vendors_list_create_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List scoped vendors or create a vendor with duplicate-detection guardrails.
- `vendor_detail_view(vendor_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch one vendor with duplicate checks on identity-changing updates.
- `vendors_import_csv_view()` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Import vendors from CSV in preview/apply mode with strict header validation.

### `backend/core/views/shared_operations/vendors_helpers.py`
_Domain-specific helpers for vendor views._

**Depends on:**
- `from core.models import Vendor`
- `from core.views.helpers import _vendor_scope_filter`

- `_find_duplicate_vendors(user, name: str, email: str, exclude_vendor_id)` — Find existing vendors matching by name or email for duplicate detection.

## Views — Estimating

### `backend/core/views/estimating/estimates.py`
_Estimate authoring and public sharing endpoints._

**Depends on:**
- `from core.models import Estimate, EstimateStatusEvent`
- `from core.policies import get_estimate_policy_contract`
- `from core.serializers import EstimateDuplicateSerializer, EstimateSerializer, EstimateStatusEventSerializer, EstimateWriteSerializer`
- `from core.views.estimating.estimates_helpers import _activate_project_from_estimate_approval, _apply_estimate_lines_and_totals, _archive_estimate_family, _next_estimate_family_version, _serialize_estimate, _serialize_estimates`
- `from core.models import SigningCeremonyRecord`
- `from core.utils.signing import compute_document_content_hash`
- `from core.views.helpers import _build_public_decision_note, _capability_gate, _ensure_membership, _resolve_organization_for_public_actor, _serialize_public_organization_context, _serialize_public_project_context, _validate_estimate_for_user, _validate_project_for_user`
- `from core.utils.email import send_document_sent_email`
- `from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision`

- `public_estimate_detail_view(public_token: str)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Return public estimate detail for share links, including lightweight project context.
- `public_estimate_decision_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Apply customer approve/reject decisions through public estimate share links.
- `estimate_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return canonical estimate workflow policy for frontend UX guards.
- `project_estimates_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project estimates or create a new estimate version within a title family.
- `estimate_detail_view(estimate_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch one estimate with draft-locking and status-transition enforcement.
- `estimate_clone_version_view(estimate_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Create a new draft revision from a prior estimate version in the same title family.
- `estimate_duplicate_view(estimate_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Duplicate an estimate into a draft for same or another project/title context.
- `estimate_status_events_view(estimate_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return immutable estimate status transition history.

### `backend/core/views/estimating/estimates_helpers.py`
_Domain-specific helpers for estimate views._

**Depends on:**
- `from core.models import Estimate, EstimateLineItem, EstimateStatusEvent, Project`
- `from core.serializers import EstimateSerializer`
- `from core.user_helpers import _ensure_membership`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _resolve_cost_codes_for_user`

- `_archive_estimate_family(project, user, title, exclude_ids, note)` — Archive all same-title estimates in a family except the excluded IDs.
- `_next_estimate_family_version(project, title)` — Return the next version number for an estimate family identified by title.
- `_serialize_estimate(estimate)` — Serialize a single estimate.
- `_serialize_estimates(estimates, project)` — Serialize multiple estimates sharing the same project.
- `_sync_project_contract_baseline_if_unset(estimate)` — Set the project's original and current contract values from the estimate if both are zero.
- `_activate_project_from_estimate_approval(estimate, actor, note: str)` — Transition a prospect or on-hold project to active when its estimate is approved.
- `_calculate_line_totals(line_items_data)` — Compute per-line totals with markup and return normalized items, subtotal, and markup total.
- `_apply_estimate_lines_and_totals(estimate, line_items_data, tax_percent, user)` — Replace an estimate's line items and recompute all totals.

## Views — Change Orders

### `backend/core/views/change_orders/change_orders.py`
_Change-order creation, revision, and lifecycle endpoints._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderSnapshot, Estimate, Project`
- `from core.policies import get_change_order_policy_contract`
- `from core.serializers import ChangeOrderSerializer, ChangeOrderWriteSerializer`
- `from core.utils.email import send_document_sent_email`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.change_orders.change_orders_helpers import _model_validation_error_payload, _next_change_order_family_key, _serialize_public_change_order, _sync_change_order_lines, _validate_change_order_lines, _validation_error_payload`
- `from core.models import SigningCeremonyRecord`
- `from core.serializers import ChangeOrderSerializer`
- `from core.utils.signing import compute_document_content_hash`
- `from core.views.helpers import _build_public_decision_note, _capability_gate, _ensure_membership, _validate_project_for_user`
- `from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision`

- `public_change_order_detail_view(public_token: str)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Return public change-order detail for share links.
- `public_change_order_decision_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Apply a customer decision to a public change-order share link.
- `change_order_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return canonical change-order workflow policy for frontend UX guards.
- `project_change_orders_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — List project change orders or create a new family revision-1 draft.
- `change_order_detail_view(change_order_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a change order with strict revision and status semantics.
- `change_order_clone_revision_view(change_order_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Clone the latest change-order revision into a new draft revision in the same family.

### `backend/core/views/change_orders/change_orders_helpers.py`
_Domain-specific helpers for change-order views._

**Depends on:**
- `from core.models import ChangeOrder, ChangeOrderLine, CostCode`
- `from core.serializers import ChangeOrderSerializer, EstimateLineItemSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _resolve_organization_for_public_actor, _serialize_public_organization_context, _serialize_public_project_context`

- `_serialize_public_change_order(change_order)` — Serialize a change order with project and organization context for public preview.
- `_validate_change_order_lines(line_items, organization_id)` — Validate change order line items.
- `_sync_change_order_lines(change_order, line_items, cost_code_map)` — Replace all line items on a change order with the provided set.
- `_validation_error_payload(message: str, fields: dict, rule: str | None)` — Build a (body, status_code) tuple for a 400 validation error.
- `_next_change_order_family_key(project)` — Return the next numeric family key string for change orders in a project.
- `_infer_model_validation_rule(fields: dict)` — Infer a domain-specific rule code from Django model ValidationError field names.
- `_model_validation_error_payload(exc: ValidationError, message: str)` — Convert a Django model ValidationError into a (body, status_code) tuple.

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
- `from core.models import Invoice, InvoiceStatusEvent`
- `from core.policies import get_invoice_policy_contract`
- `from core.serializers import InvoiceSerializer, InvoiceStatusEventSerializer, InvoiceWriteSerializer`
- `from core.utils.email import send_document_sent_email`
- `from core.utils.money import quantize_money`
- `from core.views.accounts_receivable.invoice_ingress import build_invoice_create_ingress, build_invoice_patch_ingress`
- `from core.views.accounts_receivable.invoices_helpers import _activate_project_from_invoice_creation, _apply_invoice_lines_and_totals, _calculate_invoice_line_totals, _invoice_line_apply_error_response, _next_invoice_number`
- `from core.models import SigningCeremonyRecord`
- `from core.utils.signing import compute_document_content_hash`
- `from core.views.helpers import _build_public_decision_note, _capability_gate, _ensure_membership, _resolve_cost_codes_for_user, _resolve_organization_for_public_actor, _serialize_public_organization_context, _serialize_public_project_context, _validate_project_for_user`
- `from core.views.public_signing_helpers import get_ceremony_context, validate_ceremony_on_decision`

- `public_invoice_detail_view(public_token: str)` `@api_view(['GET'])` `@permission_classes([AllowAny])` — Return public invoice detail for share links, including lightweight project context.
- `public_invoice_decision_view(public_token: str)` `@api_view(['POST'])` `@permission_classes([AllowAny])` — Apply customer approval/dispute decision to a public invoice share link.
- `invoice_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return canonical invoice workflow policy for frontend UX guards.
- `project_invoices_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — Project invoice collection endpoint: `GET` lists invoices, `POST` creates a draft.
- `invoice_detail_view(invoice_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update one invoice while enforcing lifecycle and totals rules.
- `invoice_send_view(invoice_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Send an invoice by transitioning to `sent`.
- `invoice_status_events_view(invoice_id: int)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return immutable invoice status transition history for one invoice.

### `backend/core/views/accounts_receivable/invoices_helpers.py`
_Domain-specific helpers for invoice views._

**Depends on:**
- `from core.models import Invoice, InvoiceLine, Project`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _resolve_cost_codes_for_user`

- `_is_billable_invoice_status(status)` — Return True if the invoice status counts toward billed totals.
- `_project_billable_invoices_total(project, user, exclude_invoice_id)` — Sum the totals of all billable invoices for a project, optionally excluding one.
- `_next_invoice_number(project, user)` — Generate the next unique sequential invoice number for a project.
- `_calculate_invoice_line_totals(line_items_data)` — Compute per-line totals and return normalized items with a running subtotal.
- `_apply_invoice_lines_and_totals(invoice, line_items_data, tax_percent, user)` — Replace an invoice's line items and recompute all totals.
- `_invoice_line_apply_error_response(apply_error)` — Convert an _apply_invoice_lines_and_totals error dict into a (body, status) HTTP response tuple.
- `_activate_project_from_invoice_creation(invoice, actor)` — Transition a prospect project to active when a direct invoice is created.

## Views — Accounts Payable

### `backend/core/views/accounts_payable/vendor_bills.py`
_Accounts payable vendor-bill endpoints and line item lifecycle._

**Depends on:**
- `from core.models import Vendor, VendorBill, VendorBillSnapshot`
- `from core.policies import get_vendor_bill_policy_contract`
- `from core.serializers import VendorBillSerializer, VendorBillWriteSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.accounts_payable.vendor_bills_helpers import _apply_vendor_bill_lines_and_totals, _find_duplicate_vendor_bills, _vendor_bill_line_apply_error_response, _vendor_scope_filter`
- `from core.views.helpers import _capability_gate, _ensure_membership, _validate_project_for_user`

- `_prefetch_vendor_bill_qs(qs)` — Apply standard select/prefetch for vendor bill queries.
- `vendor_bill_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return canonical vendor-bill workflow policy for frontend UX guards.
- `project_vendor_bills_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — Project vendor-bill collection endpoint: `GET` lists bills, `POST` creates a bill with line items.
- `vendor_bill_detail_view(vendor_bill_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or patch one vendor bill with lifecycle and line item guardrails.

### `backend/core/views/accounts_payable/vendor_bills_helpers.py`
_Domain-specific helpers for vendor bill views._

**Depends on:**
- `from core.models import VendorBill, VendorBillLine`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _resolve_cost_codes_for_user, _vendor_scope_filter`

- `_find_duplicate_vendor_bills(user, vendor_id: int, bill_number: str, exclude_vendor_bill_id)` — Return same-user vendor bills matching vendor+bill number (case-insensitive).
- `_calculate_vendor_bill_line_totals(line_items_data)` — Compute per-line totals and return normalized items with a running subtotal.
- `_apply_vendor_bill_lines_and_totals(vendor_bill, line_items_data, tax_amount, shipping_amount, user)` — Replace a vendor bill's line items and recompute all totals.
- `_vendor_bill_line_apply_error_response(apply_error)` — Convert an _apply_vendor_bill_lines_and_totals error dict into a (body, status) HTTP response tuple.

## Views — Cash Management

### `backend/core/views/cash_management/payments.py`
_Cash-management payment and allocation endpoints._

**Depends on:**
- `from core.models import Customer, Invoice, Payment, PaymentAllocation, PaymentAllocationRecord, PaymentRecord, VendorBill`
- `from core.policies import get_payment_policy_contract`
- `from core.serializers import PaymentAllocateSerializer, PaymentAllocationSerializer, PaymentSerializer, PaymentWriteSerializer`
- `from core.utils.money import MONEY_ZERO, quantize_money`
- `from core.views.helpers import _capability_gate, _ensure_membership, _validate_project_for_user`
- `from core.views.cash_management.payments_helpers import _all_allocated_total, _direction_target_mismatch, _recalculate_payment_allocation_targets, _set_invoice_balance_from_allocations, _set_vendor_bill_balance_from_allocations`

- `payment_contract_view(_request)` `@api_view(['GET'])` `@permission_classes([IsAuthenticated])` — Return canonical payment workflow policy for frontend UX guards.
- `org_payments_view()` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — Org-level payment endpoint: `GET` lists all payments, `POST` creates a payment.
- `project_payments_view(project_id: int)` `@api_view(['GET', 'POST'])` `@permission_classes([IsAuthenticated])` — Project-scoped payment endpoint: `GET` lists project payments, `POST` creates attached to project.
- `payment_detail_view(payment_id: int)` `@api_view(['GET', 'PATCH'])` `@permission_classes([IsAuthenticated])` — Fetch or update a payment while enforcing transition and allocation safety rules.
- `payment_allocate_view(payment_id: int)` `@api_view(['POST'])` `@permission_classes([IsAuthenticated])` — Allocate a settled payment to invoices or vendor bills based on payment direction.

### `backend/core/views/cash_management/payments_helpers.py`
_Domain-specific helpers for payment and allocation views._

**Depends on:**
- `from core.models import Invoice, Payment, PaymentAllocation, VendorBill`
- `from core.utils.money import MONEY_ZERO, quantize_money`

- `_settled_allocated_total(payment: Payment)` — Return the total amount allocated from a payment's settled allocations only.
- `_all_allocated_total(payment: Payment)` — Return the total amount allocated from a payment across all statuses.
- `_set_invoice_balance_from_allocations(invoice: Invoice)` — Recompute an invoice's balance_due and status from its settled payment allocations.
- `_set_vendor_bill_balance_from_allocations(vendor_bill: VendorBill)` — Recompute a vendor bill's balance_due and status from its settled payment allocations.
- `_recalculate_payment_allocation_targets(payment: Payment)` — Refresh balance_due on all invoices and vendor bills linked to a payment.
- `_direction_target_mismatch(direction: str, target_type: str)` — Return True if the allocation target type is incompatible with the payment direction.

## Utils

### `backend/core/utils/csv_import.py`
_Shared CSV import logic for preview/apply workflows._

**class CsvImportError(Exception)**
> Raised when CSV input or headers fail validation.

- `process_csv_import(csv_text: str, dry_run: bool, required_headers: set[str], allowed_headers: set[str], entity_name: str, lookup_existing_fn, create_fn, update_fn, validate_row_fn, serialize_row_fn)` — Parse CSV text and process each row through lookup/create/update callbacks.
- `_default_row(index, row, status, message, serialize_row_fn, instance)` — Build the per-row result dict, delegating to serialize_row_fn if provided.

### `backend/core/utils/email.py`
_Transactional email helpers with audit logging._

**Depends on:**
- `from core.models import EmailRecord`

- `send_verification_email(user, token_obj)` — Send email verification link and log to EmailRecord.
- `send_password_reset_email(user, token_obj, is_security_alert)` — Send password reset link and log to EmailRecord.
- `send_otp_email(recipient_email, code, document_type_label, document_title)` — Send a 6-digit OTP code for public document verification.
- `send_document_sent_email(document_type, document_title, public_url, recipient_email, sender_user)` — Send notification email when a document is sent to a customer.

### `backend/core/utils/money.py`
_Money precision utilities for consistent currency rounding._

- `quantize_money(value)` — Normalize any money value to 2-decimal currency precision.

### `backend/core/utils/organization_defaults.py`
_Organization-level default helpers for document branding/templates._

- `build_org_defaults(owner_email: str)` — Build the default field values for a new or backfilled organization.
- `apply_missing_org_defaults(organization, owner_email: str)` — Apply missing defaults to an existing organization in-memory.

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

### `backend/core/user_helpers.py`
_User-centric resolution and lifecycle helpers._

**Depends on:**
- `from core.models import CostCode, Organization, OrganizationMembership, OrganizationMembershipRecord, OrganizationRecord, RoleTemplate`
- `from core.utils.organization_defaults import build_org_defaults`

- `_resolve_user_role(user)` — Return the canonical role slug for a user from their active membership.
- `_resolve_user_capabilities(user, membership)` — Resolve the effective capability flags for a user.
- `_ensure_membership(user)` — Return the user's active OrganizationMembership, bootstrapping one if absent.

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
- `from core.models import ChangeOrder, CostCode, Customer, Estimate, EstimateLineItem, EstimateStatusEvent, Invoice, InvoiceLine, OrganizationMembership, OrganizationMembershipRecord, Payment, PaymentAllocation, Project, RoleTemplate, Vendor, VendorBill, VendorBillLine`
- `from core.user_helpers import _ensure_membership`

**class Command(BaseCommand)**
- `_get_or_create_user(email)`
- `_cost_codes(user)` — Return two cost codes for estimate line seeding.
- `_seed_canonical_vendors(user)`
- `_add_team_member(owner_membership, email, full_name, role)` — Create a user and add them as a team member on the owner's org.
- `_make_customer(user, name)`
- `_make_project(user, customer, name, status)`
- `_make_estimate(user, project, title, version, status, subtotal, code1, code2)`
- `_sync_estimate_lines(estimate, code1, code2, subtotal)`
- `_sync_estimate_status_history(estimate, target_status, user)`
- `_make_change_order(user, project, family_key, title, status, amount)`
- `_make_invoice(user, project, customer, number, status, total, balance_due)`
- `_make_vendor_bill(user, project, vendor, bill_number, status, total, balance_due)`
- `_make_payment(user, project, direction, ref, method, status, amount)`
- `_allocate_payment(user, payment, invoice, vendor_bill, amount)`
- `_seed_new()` — Fresh signup.
- `_seed_early()` — ~2 months in.
- `_seed_mid()` — ~8 months in.
- `_seed_late()` — ~2 years in.
- `_seed_system_role_templates()` `@atomic` — Ensure system RoleTemplate rows exist.
- `handle()`


## Tests

### `backend/core/tests/common.py`

**Depends on:**
- `from core.models import AccountingSyncEvent, AccountingSyncRecord, ChangeOrderSnapshot, CustomerRecord, ChangeOrder, ChangeOrderLine, CostCode, Customer, DocumentAccessSession, EmailRecord, EmailVerificationToken, Estimate, EstimateLineItem, EstimateStatusEvent, Invoice, InvoiceLine, InvoiceStatusEvent, LeadContactRecord, OrganizationMembershipRecord, OrganizationRecord, Payment, PaymentAllocation, PaymentAllocationRecord, PaymentRecord, Project, Organization, OrganizationInvite, OrganizationMembership, RoleTemplate, SigningCeremonyRecord, VendorBill, VendorBillLine, VendorBillSnapshot, Vendor`

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
- `_create_estimate(project_id: int, cost_code_id: int, token: str, title: str)`
- `_create_estimate_family(title: str)`
- `_approve_estimate(estimate_id: int, token: str)`
- `_create_other_estimate_family()` — Create an approved estimate on other_project for cross-project tests.
- `_create_change_order(title, amount_delta)`
- `_assert_validation_rule(response, expected_rule: str)`
- `test_change_order_contract_requires_authentication()`
- `test_public_change_order_detail_view_allows_unauthenticated_access()`
- `test_public_change_order_decision_view_approves_pending_approval()`
- `test_public_change_order_decision_view_rejects_pending_approval()`
- `test_change_order_contract_matches_model_transition_policy()`
- `test_change_order_create_and_numbering()`
- `test_change_order_create_defaults_reason_to_empty_when_omitted()`
- `test_change_order_create_allows_per_change_order_reason_override()`
- `test_change_order_patch_allows_reason_updates()`
- `test_change_order_create_with_line_items_scaffold()`
- `test_change_order_create_with_origin_estimate_link()`
- `test_change_order_create_requires_origin_estimate()`
- `test_change_order_create_rejects_non_approved_origin_estimate()`
- `test_change_order_create_rejects_line_total_mismatch()`
- `test_change_order_patch_updates_line_items_scaffold()`
- `test_change_order_clone_revision_creates_next_revision_in_same_family()`
- `test_change_order_patch_rejects_non_latest_revision_edit()`
- `test_change_order_patch_allows_non_latest_revision_status_update()`
- `test_change_order_patch_rejects_origin_estimate_change_or_clear()`
- `test_change_order_create_allows_duplicate_cost_codes()`
- `test_change_order_create_line_with_cost_code()`
- `test_change_order_model_blocks_invalid_status_transition_on_save()`
- `test_change_order_model_requires_previous_change_order_for_revision_gt_one()`
- `test_change_order_model_rejects_revision_number_mismatch_with_previous_change_order()`
- `test_change_order_model_rejects_cross_project_origin_estimate_on_direct_save()`
- `test_change_order_model_rejects_cross_project_previous_change_order_on_direct_save()`
- `test_change_order_status_lifecycle_validation()`
- `test_pending_approval_cannot_transition_back_to_draft()`
- `test_change_order_patch_rejects_content_edits_when_pending_approval()`
- `test_change_order_patch_rejects_content_edits_when_approved_rejected_or_void()`
- `test_change_order_clone_revision_requires_latest_revision()`
- `test_change_order_clone_from_open_revision_auto_voids_source_revision()`
- `test_change_order_approved_status_creates_immutable_snapshot()`
- `test_change_order_rejected_and_void_status_each_create_decision_snapshots()`
- `test_change_order_list_and_detail_are_scoped_to_current_user()`
- `test_rejected_or_void_change_orders_do_not_change_contract_total()`
- `test_approved_change_order_updates_contract_total()`
- `test_approved_change_order_cannot_transition_to_void_and_financials_remain()`
- `test_editing_approved_change_order_amount_is_blocked()`

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
- `from core.models import ChangeOrder, Estimate, Invoice, Payment, VendorBill`

**class AdoptionStageSeedTests(TestCase)**
- `test_seed_is_idempotent()` — Running twice produces the same result without errors.
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


### `backend/core/tests/test_estimates.py`

**Depends on:**
- `from core.serializers import EstimateWriteSerializer`
- `from core.tests.common import *`

**class EstimateTests(TestCase)**
- `setUp()`
- `_bootstrap_primary_membership()`
- `test_public_estimate_detail_view_allows_unauthenticated_access()`
- `test_public_estimate_detail_view_not_found()`
- `test_public_estimate_decision_view_approves_sent_estimate()`
- `test_public_estimate_decision_view_rejects_sent_estimate()`
- `test_estimate_contract_requires_authentication()`
- `test_estimate_contract_matches_model_transition_policy()`
- `test_project_estimates_create()`
- `test_project_estimates_create_persists_valid_through()`
- `test_project_estimates_create_uses_organization_validation_delta_when_valid_through_omitted()`
- `test_project_estimates_create_uses_organization_default_terms_when_omitted()`
- `test_project_estimates_rejects_per_estimate_terms_overrides()`
- `test_project_estimates_patch_rejects_terms_edit_when_non_draft()`
- `test_project_estimates_create_rounds_tax_half_up_to_cents()`
- `test_project_estimates_create_requires_title()`
- `test_project_estimates_create_archives_previous_family()`
- `test_project_estimates_create_requires_explicit_confirmation_for_existing_title_family()`
- `test_project_estimates_create_blocks_existing_title_family_after_approval()`
- `test_project_estimates_create_rejects_user_archived_status()`
- `test_project_estimates_list_scoped_by_project_and_user()`
- `test_estimate_status_write_contract_distinguishes_void_from_archived()`
- `test_estimate_clone_creates_next_version()`
- `test_estimate_clone_from_rejected_keeps_source_rejected()`
- `test_estimate_clone_blocked_when_source_is_approved()`
- `test_estimate_clone_blocked_when_source_is_draft()`
- `test_estimate_clone_allowed_when_source_is_archived()`
- `test_estimate_clone_allowed_when_source_is_void()`
- `test_estimate_status_transition_validates_allowed_paths()`
- `test_estimate_patch_approval_promotes_project_to_active()`
- `test_estimate_status_transition_allows_sent_to_void()`
- `test_estimate_status_transition_rejects_user_archived_patch()`
- `test_estimate_status_transition_creates_audit_events()`
- `test_estimate_resend_records_sent_to_sent_status_event()`
- `test_estimate_terminal_status_note_records_same_status_event()`
- `test_estimate_values_locked_after_send()`
- `test_estimate_title_cannot_change_after_creation_even_in_draft()`
- `test_estimate_cannot_transition_from_sent_back_to_draft()`
- `test_estimate_duplicate_creates_new_draft_without_archiving_source()`
- `test_estimate_duplicate_same_project_same_title_requires_revision_flow()`
- `test_estimate_duplicate_new_titles_start_new_family_at_version_one()`

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
- `test_invoice_status_transition_validation_and_paid_balance()`
- `test_invoice_send_endpoint_moves_draft_to_sent()`
- `test_invoice_status_events_endpoint_returns_history()`
- `test_invoice_status_note_without_transition_records_same_status_event()`
- `test_invoice_patch_line_items_recalculates_totals()`
- `test_invoice_model_blocks_invalid_status_transition_on_direct_save()`
- `test_invoice_model_blocks_due_date_before_issue_date()`
- `test_invoice_model_paid_status_sets_zero_balance_due()`
- `test_invoice_paid_cannot_transition_to_void()` — Paid is a terminal state — voiding a paid invoice is not allowed.
- `test_invoice_partially_paid_cannot_transition_to_void()` — Partially paid is a terminal state — voiding is not allowed.
- `test_invoice_partially_paid_can_revert_to_sent()` — partially_paid -> sent is allowed for payment void reversal.
- `test_invoice_overdue_is_not_a_valid_status()` — Overdue was removed from the status enum — it is now a computed condition.
- `_create_simple_project()` — Helper: create a simple project for additional invoice tests.
- `test_create_invoice_on_simple_project()` — Invoice creation succeeds on a minimal project.
- `test_line_missing_description_rejected()` — Lines without a description are rejected.
- `test_create_invoice_on_prospect_project_activates_it()` — Creating an invoice on a prospect project promotes it to active.
- `test_create_invoice_on_active_project_stays_active()` — Creating an invoice on an already-active project doesn't change status.

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
- `_create_payment(status, amount, direction)`
- `_create_invoice(total, status)`
- `_create_vendor_bill(total, status)`
- `test_payment_contract_requires_authentication()`
- `test_payment_contract_matches_model_transition_policy()`
- `test_payment_create_and_project_list()`
- `test_payment_list_scoped_by_project_and_user()`
- `test_payment_status_transition_validation()`
- `test_payment_patch_updates_direction_method_status_reference()`
- `test_payment_allocation_inbound_partial_updates_invoice_balances()`
- `test_payment_allocation_outbound_partial_updates_vendor_bill_balances()`
- `test_payment_allocation_blocks_direction_mismatch_and_overallocation()`
- `test_payment_allocation_requires_settled_and_reverses_on_void()`
- `test_payment_records_append_for_status_change_and_allocation()`
- `test_payment_record_is_immutable()`
- `test_payment_allocation_record_is_immutable()`
- `test_payment_validates_required_fields_and_positive_amount()`


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
- `test_cost_code_csv_import_preview_and_apply()`
- `test_cost_code_csv_import_applies_when_dry_run_string_false()`
- `test_cost_code_csv_import_rejects_is_active_header()`

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
- `test_compute_estimate_content_hash_is_deterministic()`
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
- `test_double_approve_returns_409_conflict()` — Approving an already-approved estimate returns 409.
- `test_session_token_scoped_to_document()` — A session token for estimate_a cannot be used on estimate_b's decision endpoint.
- `test_max_otp_attempts_then_new_otp_succeeds()` — After max failed attempts, requesting a new OTP and verifying it works.
- `test_reject_decision_creates_ceremony_record()` — Rejecting an estimate creates a SigningCeremonyRecord with decision='reject'.
- `test_empty_whitespace_otp_code_returns_400()` — Submitting a whitespace-only OTP code returns 400 validation_error.
- `test_decision_on_draft_estimate_returns_409()` — Attempting a decision on a DRAFT estimate returns 409 conflict.
- `test_max_attempts_blocks_correct_code()` — Even the correct OTP code is rejected after max failed attempts.

- `_create_verified_session(public_token, document_type, document_id, email)` — Create a DocumentAccessSession that has been OTP-verified with an active session.

### `backend/core/tests/test_rbac_capabilities.py`

**Depends on:**
- `from core.tests.common import *`
- `from core.rbac import _capability_gate`
- `from core.user_helpers import RBAC_ROLE_OWNER, _resolve_user_role, _resolve_user_capabilities, _ensure_membership`

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
- `test_returns_estimate_status_events()`
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
- `_create_vendor_bill(bill_number, total)`
- `test_vendor_bill_contract_requires_authentication()`
- `test_vendor_bill_contract_matches_model_transition_policy()`
- `test_vendor_bill_create_and_project_list()`
- `test_vendor_bill_create_requires_initial_status()`
- `test_vendor_bill_create_received_requires_issue_and_due_date()`
- `test_vendor_bill_create_allows_received_when_dates_present()`
- `test_vendor_bill_list_scoped_by_project_and_user()`
- `test_vendor_bill_duplicate_requires_existing_match_to_be_void()`
- `test_vendor_bill_status_transition_and_balance_due()`
- `test_vendor_bill_can_move_from_approved_to_paid_directly()`
- `test_vendor_bill_patch_rejects_bill_number_change()`
- `test_vendor_bill_patch_validates_vendor_scope_and_due_dates()`
- `test_vendor_bill_create_allows_global_canonical_vendor()`
- `test_vendor_bill_patch_requires_scheduled_for_when_status_scheduled()`
- `test_vendor_bill_patch_rejects_line_items_with_wrong_org_cost_code()`
- `test_vendor_bill_status_transitions_create_snapshots_for_all_captured_statuses()`
- `test_vendor_bill_paid_cannot_transition_to_void()` — Paid bills are terminal — voiding a paid bill is not allowed.
- `test_vendor_bill_snapshot_payload_captures_line_items_and_context()`
- `test_vendor_bill_compound_received_to_scheduled_creates_two_snapshots()` — Compound transition: received → scheduled atomically walks through approved.


### `backend/core/tests/test_vendors.py`

**Depends on:**
- `from core.tests.common import *`

**class VendorTests(TestCase)**
- `setUp()`
- `test_vendor_create_and_search()`
- `test_vendor_list_scoped_by_user()`
- `test_vendor_list_includes_global_canonical_vendors()`
- `test_vendor_list_includes_rows_created_by_other_user_in_same_org()`
- `test_vendor_duplicate_warning_on_create_by_name_or_email()`
- `test_vendor_duplicate_override_allows_create()`
- `test_vendor_patch_duplicate_warning_and_override()`
- `test_vendor_patch_updates_fields()`
- `test_vendor_create_accepts_retail_vendor_type()`
- `test_vendor_create_rejects_inactive_state()`
- `test_vendor_create_assigns_active_organization()`
- `test_vendor_patch_updates_vendor_type()`
- `test_vendor_csv_import_preview_and_apply()`
- `test_vendor_csv_import_applies_when_dry_run_string_false()`
- `test_vendor_csv_import_rejects_is_active_header()`

