# Enforcement Philosophy

Date: 2026-03-05

## Core Principle

**Trust authorized users. Record everything.**

The system's job is not to prevent every possible mistake or act of bad faith. It is to
ensure that (1) only authorized users can act, and (2) every action is recorded
immutably and completely enough to reconstruct what happened.

## Why This Posture

Our ICP is 1-10 person general contractors. At this scale:

- The owner knows everyone on the team. Trust is personal, not procedural.
- Prevention controls (dual-authorization, approval chains, cooling periods) add
  friction that makes the product unusable for the very people it's built for. A solo
  drywaller can't dual-authorize their own invoice.
- When trust breaks down (a rogue employee, a bad-faith actor), the problem is
  interpersonal — not something software can prevent without also preventing legitimate
  work.

Enterprise tools solve this with process gates because they serve organizations where
people don't know each other. That's not our world.

## Three Layers of the System

### Layer 1: Structural Constraints (DB-level)

Things that are physically impossible. These protect data integrity regardless of who is
acting:

- `PROTECT` foreign keys prevent deleting a project that has invoices
- `CheckConstraint` prevents negative balance_due, ensures due_date >= issue_date
- `unique_together` prevents duplicate invoice numbers per project
- Money stored as fixed-precision decimals with quantization

These are non-negotiable and apply universally. No user, regardless of role, can violate
a structural constraint.

### Layer 2: Workflow Constraints (helper-level)

Things that require specific conditions. These enforce the "rules of the game" for
authorized users:

- **RBAC capability gates** — viewer can't create invoices, worker can't invite users
- **Status transition maps** — can't go from PAID back to DRAFT
- **Scope guard** — can't bill beyond approved contract value without explicit override
- **Validation rules** — adjustment lines need reasons, scope lines need budget lines

These are the enforcement surface that RBAC controls. An authorized user with the right
capabilities can perform any action within these rules. The rules themselves are not
bypassable, but override mechanisms exist where appropriate (scope_override with a
required note, for example).

### Layer 3: Immutable Audit Trail (record-level)

Everything an authorized user does is captured in append-only records that cannot be
modified or deleted through the application:

- **FinancialAuditEvent** — every create, status change, and override across all
  financial artifacts, with actor, timestamp, before/after state, and optional note
- **InvoiceStatusEvent / EstimateStatusEvent** — lifecycle transitions with full context
- **ChangeOrderSnapshot / VendorBillSnapshot** — complete entity state at each
  significant transition
- **OrganizationRecord / OrganizationMembershipRecord** — org and membership changes
  with from/to state
- **CustomerRecord / LeadContactRecord** — customer data changes
- **PaymentRecord / PaymentAllocationRecord** — payment lifecycle
- **InvoiceScopeOverrideEvent** — explicit record when scope guard is bypassed

This layer is the backstop. It does not prevent action — it ensures that every action
has receipts.

## What We Explicitly Do Not Build (For This ICP)

- **Dual-authorization / maker-checker** — requires two people to approve an action.
  Unusable for 1-3 person orgs.
- **Approval chains** — requires sequential sign-off from multiple roles. Blocks work
  for small teams.
- **Cooling periods / undo windows** — delays destructive actions by N hours. Adds
  confusion and latency for time-sensitive billing.
- **Hard caps without override** — prevents an action entirely with no escape hatch.
  Causes support tickets and workarounds.

If the ICP shifts upmarket (50+ person GCs), these become worth revisiting. For now,
they're friction without proportionate value.

## Liability Position

The audit trail establishes a clear fault boundary:

**The platform's responsibility:** Record every action faithfully, enforce access
controls, prevent structural corruption, and make the record available.

**The user's responsibility:** Decide who gets what role, trust their team
appropriately, and review the work their team does.

If a PM with legitimate `invoices.send` capability sends a bogus invoice, the system
recorded: who created it, when, what lines it contained, when it was sent, and every
subsequent event. The platform did its job. The org owner gave that PM the capability.
The dispute is between the owner and the PM — not between the owner and us.

This is the same principle as a bank recording every authorized transaction. The bank
doesn't prevent you from writing a check to the wrong person. It records that you did.

## Recovery Potential

Because the immutable audit layer stores actual entity states (not just diffs or event
types), the system has the raw material to support future recovery workflows:

- **ChangeOrderSnapshot** stores the full CO state at each transition
- **VendorBillSnapshot** stores the full bill state
- **PaymentRecord** stores the complete payment state
- **FinancialAuditEvent.metadata_json** captures contextual data at each event

This means that if an org needs to reconstruct "what did our invoices look like before
Dave went rogue on Tuesday," the data exists to answer that question. Today this would
be a manual/support operation. In the future, it could become a self-service "audit
replay" or "point-in-time rollback" feature — but the data model already supports it.

## How This Connects to Specific Decisions

### Direct Invoicing (DECISION_RECORD_DIRECT_INVOICING)

We allow invoices without estimates/budgets. The `line_type = "direct"` marker is a
permanent forensic record that the user chose to bill without financial controls. We
don't prevent it — we record it.

### Scope Guard Override

We allow billing beyond approved scope with `scope_override = true` and a required note.
The override is recorded in `InvoiceScopeOverrideEvent` with the exact overage amount.
We don't hard-block it — we record the exception and who authorized it.

### RBAC Without Prevention

A PM can void an invoice they didn't create, if they have the capability. The system
records who voided it and when, not whether it was a "good" void. The owner assigned
that role; the audit trail shows what happened under it.
