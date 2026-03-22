"use client";

import { useState } from "react";

type Tab = "ic" | "gc";

export default function DevNotesPage() {
  const [tab, setTab] = useState<Tab>("ic");

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "system-ui, sans-serif", color: "var(--text, #e0e0e0)" }}>
      <h1 style={{ marginBottom: "0.25rem" }}>Dev Notes</h1>
      <p style={{ opacity: 0.6, marginTop: 0, marginBottom: "1.5rem" }}>Internal workflow mapping — not user-facing.</p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border, #333)" }}>
        <button
          type="button"
          onClick={() => setTab("ic")}
          style={{
            padding: "0.5rem 1.25rem",
            background: tab === "ic" ? "var(--surface-secondary, #1a1a1a)" : "transparent",
            color: tab === "ic" ? "var(--text, #e0e0e0)" : "var(--text-muted, #888)",
            border: "1px solid var(--border, #333)",
            borderBottom: tab === "ic" ? "1px solid var(--surface-secondary, #1a1a1a)" : "1px solid var(--border, #333)",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            fontWeight: tab === "ic" ? 600 : 400,
            marginBottom: -1,
          }}
        >
          Independent Contractor
        </button>
        <button
          type="button"
          onClick={() => setTab("gc")}
          style={{
            padding: "0.5rem 1.25rem",
            background: tab === "gc" ? "var(--surface-secondary, #1a1a1a)" : "transparent",
            color: tab === "gc" ? "var(--text, #e0e0e0)" : "var(--text-muted, #888)",
            border: "1px solid var(--border, #333)",
            borderBottom: tab === "gc" ? "1px solid var(--surface-secondary, #1a1a1a)" : "1px solid var(--border, #333)",
            borderRadius: "6px 6px 0 0",
            cursor: "pointer",
            fontWeight: tab === "gc" ? 600 : 400,
            marginBottom: -1,
          }}
        >
          General Contractor
        </button>
      </div>

      {/* Tab content */}
      <div style={{ border: "1px solid var(--border, #333)", borderTop: "none", borderRadius: "0 0 6px 6px", background: "var(--surface-secondary, #1a1a1a)", padding: "1.5rem" }}>
        {tab === "ic" ? <ICWorkflow /> : <GCWorkflow />}
      </div>
    </div>
  );
}

const note = {
  box: { background: "var(--tone-warning-bg, #422006)", border: "1px solid var(--tone-warning-border, #f59e0b)", borderRadius: 6, padding: "0.75rem 1rem", marginTop: "1.5rem" } as const,
  label: { fontWeight: 700, marginBottom: "0.25rem" } as const,
};

const acc = {
  item: { borderBottom: "1px solid var(--border, #333)", padding: "0.25rem 0" } as const,
  toggle: {
    background: "none", border: "none", color: "var(--text, #e0e0e0)", cursor: "pointer",
    padding: "0.5rem 0", width: "100%", textAlign: "left" as const, fontSize: "1rem",
    display: "flex", alignItems: "center", gap: "0.5rem",
  } as const,
  arrow: (open: boolean) => ({ display: "inline-block", transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)", fontSize: "0.75rem" }) as const,
  body: { padding: "0.5rem 0 0.75rem 1.5rem", opacity: 0.85 } as const,
};

function Step({ num, title, children }: { num: number; title: React.ReactNode; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const hasContent = Boolean(children);
  return (
    <li style={acc.item} value={num}>
      <button type="button" style={acc.toggle} onClick={() => hasContent && setOpen((v) => !v)}>
        <span style={acc.arrow(open)}>{hasContent ? "▶" : "·"}</span>
        <span><strong>{num}.</strong> {title}</span>
      </button>
      {open && children ? <div style={acc.body}>{children}</div> : null}
    </li>
  );
}

function ICWorkflow() {
  return (
    <div>
      <h2>Independent Contractor Workflow</h2>
      <p style={{ opacity: 0.6 }}>Happy path. Expand each step for lifecycle notes.</p>

      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Step num={1} title="User registers.">
          <h4 style={{ margin: "0 0 0.5rem" }}>A. Standard Registration (no invite)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User visits <code>/register</code> (no token).</li>
            <li>Posts email + password &rarr; backend creates user, org, membership, verification token.</li>
            <li>No auth token returned &mdash; must verify email first.</li>
            <li>User receives verification email, clicks link.</li>
            <li>Token consumed, user activated, auto-signed in with full auth payload.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Invited New User</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User receives invite link: <code>/register?token=...</code></li>
            <li>Frontend verifies invite &rarr; pre-fills email, shows org name + role banner.</li>
            <li>Posts register with <code>invite_token</code> &rarr; creates user + membership in invited org.</li>
            <li>Auth token returned immediately &mdash; no email verification (invite proves email).</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Invited Existing User (Org Switch)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Existing user clicks invite link.</li>
            <li>Frontend shows confirmation: &quot;Accepting moves you to Org A. You will lose access to Org B&apos;s data.&quot;</li>
            <li>User enters password to confirm identity.</li>
            <li>Membership updated in-place to new org + role. Token consumed.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>Edge Cases</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Duplicate (verified user):</strong> Sends password-reset email instead. Same 200 response (anti-enumeration).</li>
            <li><strong>Duplicate (unverified user):</strong> Resends verification email. Same 200 response.</li>
            <li><strong>Resend verification:</strong> Rate-limited (60s). Deletes old tokens, creates new one.</li>
            <li><strong>Token expiry:</strong> Verification 24h, password reset 1h. Expired &rarr; 410.</li>
            <li><strong>Password reset:</strong> <code>/auth/forgot-password/</code> &rarr; token email &rarr; <code>/auth/reset-password/</code> &rarr; auto-login.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>EmailVerificationToken</strong> &mdash; created on register, consumed on verify. 24h expiry.</li>
            <li><strong>PasswordResetToken</strong> &mdash; created on forgot-password, consumed on reset. 1h expiry.</li>
            <li><strong>EmailRecord</strong> &mdash; immutable log for every email sent (VERIFICATION, PASSWORD_RESET types).</li>
            <li><strong>OrganizationMembershipRecord</strong> &mdash; CREATED event on registration (Flow A/B). ROLE_CHANGED + CREATED on org switch (Flow C).</li>
          </ul>
        </Step>
        <Step num={2} title="User adds a customer.">
          <h4 style={{ margin: "0 0 0.5rem" }}>A. With email only</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User enters name + email in Quick Add.</li>
            <li>Email is lowercased and validated.</li>
            <li>Customer created &mdash; email enables document delivery (estimates, invoices, COs).</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. With phone only</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User enters name + phone in Quick Add.</li>
            <li>Phone validated: <code>[0-9+\-().\\s]+</code>, 7&ndash;15 digits.</li>
            <li>Customer created &mdash; no email means no built-in document delivery. Relies on Copy Link / manual sharing.</li>
          </ol>

          <div style={note.box}>
            <p style={note.label}>Planned: Split phone/email into two inputs</p>
            <p style={{ margin: 0 }}>
              Currently Quick Add has a single polymorphic contact field that secretly accepts either phone or email
              (backend auto-remaps). This is clever but ambiguous. Planned change: split into two clearly labeled
              fields (phone + email), require at least one valid entry. This eliminates the magic remapping,
              captures both upfront when available, and removes the amortized friction of a guaranteed second trip
              to the customer record to add the missing contact method. The second field is optional so it adds
              no real friction to the form.
            </p>
          </div>

          <h4 style={{ margin: "0 0 0.5rem" }}>Quick Add Details <span style={{ opacity: 0.5 }}>(current)</span></h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Single contact field:</strong> Quick Add has one field that accepts either phone or email (not both). Backend auto-remaps if a valid email is entered in the phone field.</li>
            <li><strong>Adding the other later:</strong> The second contact method can be added via the customer edit/manage flow.</li>
            <li><strong>Required:</strong> Name + one of phone/email.</li>
            <li><strong>Optional fields:</strong> Project address, ballpark value, notes, source.</li>
            <li><strong>Two submit intents:</strong> &quot;Save Customer + Start Project&quot; (requires project name + address) or &quot;Save Customer Only&quot;.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Duplicate Detection</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li>Backend scans for matching phone or email in same org (normalized phone as fallback).</li>
            <li>HTTP 409 &rarr; frontend shows resolution panel with candidates.</li>
            <li>User can reuse existing customer or cancel and refine.</li>
            <li>Reusing skips customer creation but still creates intake record + optional project.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>CustomerRecord</strong> &mdash; immutable snapshot on CREATED (and UPDATED on edits).</li>
            <li><strong>LeadContactRecord</strong> &mdash; CREATED on every quick-add intake. CONVERTED if project created in same request.</li>
          </ul>
        </Step>
        <Step num={3} title={<>User creates a project. <span style={{ opacity: 0.5 }}>(May happen in tandem with step 2 via Quick Add.)</span></>}>
          <h4 style={{ margin: "0 0 0.5rem" }}>A. Via Quick Add (step 2)</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Created in tandem with customer &mdash; see step 2.</li>
            <li>User clicks &quot;Save Customer + Start Project&quot; &rarr; project name + address required.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Standalone (from Customers page)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User clicks &quot;Add Project&quot; on an existing customer row.</li>
            <li>Modal with project fields: name, site address, status, initial contract value.</li>
            <li><code>POST /customers/&lt;id&gt;/projects/</code></li>
          </ol>

          <div style={note.box}>
            <p style={note.label}>Gap: No project creation on the Projects page</p>
            <p style={{ margin: 0 }}>
              Projects can only be created from the Customers page (Quick Add or &quot;Add Project&quot; on a customer row).
              The Projects page itself is read-only for listing. Once users are past onboarding and living in the app
              day-to-day, the most obvious place to create a project is&hellip; the projects page. Needs a &quot;New Project&quot;
              action with a customer selector.
            </p>
          </div>

          <h4 style={{ margin: "0 0 0.5rem" }}>Field Defaults</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Name:</strong> Defaults to &quot;&lt;customer&gt; Project&quot; if blank.</li>
            <li><strong>Site address:</strong> Defaults to customer&apos;s billing address. Validation fails if both are empty.</li>
            <li><strong>Status:</strong> &quot;prospect&quot; or &quot;active&quot; only. Defaults to &quot;prospect&quot;.</li>
            <li><strong>Initial contract value:</strong> Defaults to 0.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>No project-specific audit model.</strong> Creation is recorded indirectly via <code>LeadContactRecord</code> (CONVERTED) if created through Quick Add.</li>
            <li>Standalone creation (<code>POST /customers/&lt;id&gt;/projects/</code>) has no immutable audit record.</li>
          </ul>
        </Step>
        <Step num={4} title={<><strong>[Optional]</strong> Estimate &rarr; approval cycle. <span style={{ opacity: 0.5 }}>(Same mechanics as GC, just not strictly necessary for ICs.)</span></>}>
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Draft</strong> &rarr; mutable, user can edit freely.</li>
            <li><strong>Sent</strong> &rarr; immutable (values locked), awaiting customer decision.</li>
            <li><strong>Approved</strong> &rarr; terminal. Triggers project activation.</li>
            <li><strong>Rejected</strong> &rarr; can create revision (clone as new draft).</li>
            <li><strong>Void</strong> &rarr; terminal. User-driven cancellation.</li>
            <li><strong>Archived</strong> &rarr; terminal. System-controlled (superseded by newer version in same family).</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Happy Path: Draft &rarr; Send &rarr; Approved</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates estimate with title, line items (cost code + qty + unit price + markup%), tax%.</li>
            <li>User sends &rarr; org identity frozen (name, address, logo, terms). Email sent to customer.</li>
            <li>Customer receives email (or Copy Link), opens public preview.</li>
            <li>Customer completes OTP ceremony (email verification).</li>
            <li>Customer approves &rarr; project transitions to active. Estimate locked.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Rejection &rarr; Revision Cycle</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Customer rejects estimate (with optional note).</li>
            <li>User clones rejected estimate &rarr; new draft in same title family, version incremented (v1 &rarr; v2).</li>
            <li>User edits line items / pricing, re-sends.</li>
            <li>Previous version auto-archived when new version is created.</li>
            <li>Repeat until approved or voided.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Resend (Sent &rarr; Sent)</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can resend a sent estimate &mdash; triggers new email, same document.</li>
            <li>Recorded as a resend event in audit trail.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>D. Void</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can void from draft, sent, or rejected.</li>
            <li>Terminal &mdash; no further transitions.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Title family:</strong> Same title = same family. Versions are 1-based. Approved family is locked (no more drafts).</li>
            <li><strong>Clone vs Duplicate:</strong> Clone = same family, new version. Duplicate = new family/project entirely.</li>
            <li><strong>Immutable after send:</strong> Title, tax%, line items, valid_through all locked once sent.</li>
            <li><strong>Org identity freeze:</strong> Sender name/address/logo/terms captured at send time, not live.</li>
            <li><strong>Public OTP ceremony:</strong> Customer must verify email via 6-digit code before signing. Session valid 60min.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>EstimateStatusEvent</strong> &mdash; immutable record on every status transition, resend, and note append. Captures from/to status, note, actor, IP, user-agent.</li>
            <li><strong>EmailRecord</strong> &mdash; DOCUMENT_SENT type logged when estimate is emailed to customer.</li>
            <li><strong>SigningCeremonyRecord</strong> &mdash; immutable record on customer approve/reject. Captures content hash, signer name, consent, session token.</li>
            <li><strong>DocumentAccessSession</strong> &mdash; OTP session created for public decision flow. Tracks code, verified_at, expiry.</li>
          </ul>
        </Step>
        <Step num={5} title="User creates an invoice (draft minimum — just needs an invoice #).">
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Draft</strong> &rarr; mutable, user can edit freely.</li>
            <li><strong>Sent</strong> &rarr; awaiting customer action. Identity frozen.</li>
            <li><strong>Partially Paid</strong> &rarr; some payment allocated, balance remaining.</li>
            <li><strong>Paid</strong> &rarr; terminal. Balance = $0.</li>
            <li><strong>Void</strong> &rarr; terminal. User cancellation.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Happy Path: Draft &rarr; Send &rarr; Paid</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates invoice &mdash; auto-generates invoice # (INV-0001, INV-0002, etc.).</li>
            <li>User adds line items (description, qty, unit price, optional cost code).</li>
            <li>User sends &rarr; org identity frozen (name, address, logo, terms). Email sent to customer.</li>
            <li>Customer receives email (or Copy Link), opens public preview.</li>
            <li>Customer approves via OTP ceremony &rarr; invoice transitions to paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Partial Payment Flow</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Payment allocated against sent invoice (via accounting page or Quick Payment).</li>
            <li>If applied amount &lt; total &rarr; status transitions to partially_paid.</li>
            <li>Balance recalculated: <code>total - sum(settled allocations)</code>.</li>
            <li>Additional payments applied until balance = $0 &rarr; paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Customer Dispute</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Customer can dispute from public preview (sent or partially_paid).</li>
            <li>Status stays the same &mdash; dispute is recorded as a note in the audit trail.</li>
            <li>User sees dispute note in status events and can follow up.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>D. Void</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can void from draft or sent.</li>
            <li>Terminal &mdash; no further transitions.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>No versioning:</strong> Unlike estimates, invoices have no title families or revision cloning. Duplication is a frontend-only convenience (copies lines into a fresh create).</li>
            <li><strong>Invoice # auto-generated:</strong> Sequential per project (INV-0001, INV-0002). Unique constraint on (project, invoice_number).</li>
            <li><strong>Identity freeze:</strong> Sender name/address/logo/terms backfilled from org on leaving draft.</li>
            <li><strong>Balance tracking:</strong> <code>balance_due = total - sum(settled allocations)</code>. Clamped to 0.</li>
            <li><strong>Auto-activation:</strong> Creating first invoice on a prospect project auto-transitions project to active.</li>
            <li><strong>Billable statuses:</strong> Only sent, partially_paid, paid count toward project &quot;billed&quot; totals.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>InvoiceStatusEvent</strong> &mdash; immutable record on every status transition, resend, note, and dispute. Captures from/to status, note, actor, IP, user-agent.</li>
            <li><strong>EmailRecord</strong> &mdash; DOCUMENT_SENT type logged when invoice is emailed to customer.</li>
            <li><strong>SigningCeremonyRecord</strong> &mdash; immutable record on customer approve/dispute from public page. Content hash, signer, consent.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; immutable record when payment is allocated to invoice (applied/reversed events).</li>
          </ul>
        </Step>
        <Step num={6} title="User logs an ingress payment via Quick Payment.">
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Pending</strong> &rarr; payment recorded but not yet cleared.</li>
            <li><strong>Settled</strong> &rarr; default for manual entry. Money received.</li>
            <li><strong>Void</strong> &rarr; terminal. Reverses balance impact on linked invoices.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Quick Payment (one-step create + allocate)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User opens Quick Payment on project page (or inline on accounting Invoices tab).</li>
            <li>Fills in: method, amount, date, reference, notes.</li>
            <li>Optionally selects an invoice to allocate against (amount pre-filled with balance_due).</li>
            <li><code>POST /projects/&lt;id&gt;/payments/</code> creates the payment (settled by default).</li>
            <li>If allocation target selected &rarr; immediately <code>POST /payments/&lt;id&gt;/allocate/</code>.</li>
            <li>Invoice balance_due recalculated. Status auto-transitions: partially_paid or paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Separate Allocation (two-step, Accounting page)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates payment on the Accounting page (Payments Ledger tab) without allocating.</li>
            <li>Later, selects payment, picks invoice target, enters amount.</li>
            <li><code>POST /payments/&lt;id&gt;/allocate/</code> with target_type=invoice.</li>
            <li>Supports split allocations &mdash; one payment across multiple invoices.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Void Payment</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User voids a settled payment &rarr; all linked invoice balances recalculated.</li>
            <li>Invoice auto-reverts: paid &rarr; sent, partially_paid &rarr; sent (if no other settled allocations remain).</li>
            <li>System-driven status revert bypasses normal transition validation.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Settled by default:</strong> Manual entry assumes money already received. No pending/clearing workflow for MVP.</li>
            <li><strong>Direction-locked:</strong> Inbound payments can only allocate to invoices. Outbound to bills/receipts.</li>
            <li><strong>Atomic allocation:</strong> Uses <code>select_for_update</code> row-level locking to prevent double-spend.</li>
            <li><strong>Balance recalc:</strong> <code>balance_due = total - sum(settled allocations)</code>, clamped to 0.</li>
            <li><strong>Cost code at payment time:</strong> Cost attribution set on allocation, not inherited from invoice.</li>
            <li><strong>Methods:</strong> Check, Zelle, ACH, Cash, Wire, Card, Other.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Entry Points</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Project page:</strong> Quick Payment tab (PaymentRecorder, create-only, inbound-locked).</li>
            <li><strong>Accounting page &rarr; Invoices tab:</strong> Inline payment form per invoice row (amount pre-filled with balance_due).</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>PaymentRecord</strong> &mdash; immutable snapshot on CREATED, UPDATED, STATUS_CHANGED. Captures full payment state.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; immutable on APPLIED / REVERSED. Captures allocation + payment snapshot.</li>
            <li><strong>InvoiceStatusEvent</strong> &mdash; auto-recorded when payment causes invoice status transition (e.g., &quot;Payment settled — invoice fully paid.&quot;).</li>
          </ul>
        </Step>
        <Step num={7} title="User logs receipts + their associated egress payment.">
          <h4 style={{ margin: "0 0 0.5rem" }}>What is a Receipt?</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Lightweight expense record &mdash; no statuses, no document lifecycle.</li>
            <li>Represents money already spent (backward-looking). Not a bill.</li>
            <li>Optionally linked to a Store (org-scoped lookup table, auto-created on first mention, case-insensitive).</li>
            <li>Has a derived <code>balance_due</code> computed from settled payment allocations.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Create Receipt (Quick Receipt on project page)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User opens Quick Receipt tab on the project page.</li>
            <li>Optionally uploads a photo &rarr; Gemini Vision OCR extracts fields.</li>
            <li>Fills in: store name, amount, date, notes.</li>
            <li><code>POST /projects/&lt;id&gt;/receipts/</code> creates the receipt. <strong>No payment auto-created.</strong></li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Record Egress Payment (Accounting page &rarr; Receipts tab)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User opens Accounting page, Receipts tab.</li>
            <li>Expands a receipt row &rarr; sees balance_due, existing allocations.</li>
            <li>Fills in: amount (pre-filled with balance_due), method, date, reference, notes.</li>
            <li>Two-step behind the scenes:
              <ol style={{ margin: "0.25rem 0", paddingLeft: "1.25rem" }}>
                <li><code>POST /payments/</code> creates outbound payment (settled by default).</li>
                <li><code>POST /payments/&lt;id&gt;/allocate/</code> allocates to the receipt.</li>
              </ol>
            </li>
            <li>Receipt balance_due recalculated.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>Receipt vs. Vendor Bill</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Receipt:</strong> No statuses, no line items, no lifecycle. Standalone expense record. Linked to Store (optional lookup, not a relationship).</li>
            <li><strong>Vendor Bill:</strong> Full document lifecycle (received &rarr; approved &rarr; closed). Has line items. Linked to Vendor (B2B relationship entity).</li>
            <li>Separated by design &mdash; receipts aren&apos;t bills, even though both represent outgoing money.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>No auto-payment:</strong> Receipt creation and payment recording are intentionally separate steps.</li>
            <li><strong>Store auto-create:</strong> Entering a new store name creates the Store record automatically (case-insensitive dedup).</li>
            <li><strong>Balance tracking:</strong> <code>balance_due = amount - sum(settled allocations)</code>. No &quot;paid&quot; status &mdash; balance_due = 0 means fully covered.</li>
            <li><strong>Direction-locked:</strong> Outbound payments only. Allocation target_type = &quot;receipt&quot;.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>No receipt-specific audit model.</strong> Receipts are tracked through their payment allocations.</li>
            <li><strong>PaymentRecord</strong> &mdash; immutable snapshot when the outbound payment is created/updated/voided.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; APPLIED / REVERSED events when payment is allocated to receipt.</li>
          </ul>
        </Step>
      </ol>

      <div style={note.box}>
        <p style={note.label}>Insight: Copy Link for SMS delivery</p>
        <p style={{ margin: 0 }}>
          Public document links (estimates, invoices, COs) are already fully functional standalone pages
          with tokenized URLs. Currently the only delivery mechanism is &quot;Send&quot; (Mailgun email).
          But ICs are more likely to text their customers than email them. A &quot;Copy Link&quot; / tap-to-copy
          action next to Send would let them paste the URL into SMS, iMessage, WhatsApp, etc.
          Same public preview, same approve/reject/dispute flow — just a different delivery channel.
          This sidesteps the email-vs-SMS friction entirely without needing an SMS provider integration.
        </p>
      </div>
    </div>
  );
}

function GCWorkflow() {
  return (
    <div>
      <h2>General Contractor Workflow</h2>
      <p style={{ opacity: 0.6 }}>Expand each step for lifecycle notes. Same core as IC with estimates (expected), change orders, and vendor bills.</p>

      <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Step num={1} title="User registers.">
          <h4 style={{ margin: "0 0 0.5rem" }}>A. Standard Registration (no invite)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User visits <code>/register</code> (no token).</li>
            <li>Posts email + password &rarr; backend creates user, org, membership, verification token.</li>
            <li>No auth token returned &mdash; must verify email first.</li>
            <li>User receives verification email, clicks link.</li>
            <li>Token consumed, user activated, auto-signed in with full auth payload.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Invited New User</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User receives invite link: <code>/register?token=...</code></li>
            <li>Frontend verifies invite &rarr; pre-fills email, shows org name + role banner.</li>
            <li>Posts register with <code>invite_token</code> &rarr; creates user + membership in invited org.</li>
            <li>Auth token returned immediately &mdash; no email verification (invite proves email).</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Invited Existing User (Org Switch)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Existing user clicks invite link.</li>
            <li>Frontend shows confirmation: &quot;Accepting moves you to Org A. You will lose access to Org B&apos;s data.&quot;</li>
            <li>User enters password to confirm identity.</li>
            <li>Membership updated in-place to new org + role. Token consumed.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>Edge Cases</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Duplicate (verified user):</strong> Sends password-reset email instead. Same 200 response (anti-enumeration).</li>
            <li><strong>Duplicate (unverified user):</strong> Resends verification email. Same 200 response.</li>
            <li><strong>Resend verification:</strong> Rate-limited (60s). Deletes old tokens, creates new one.</li>
            <li><strong>Token expiry:</strong> Verification 24h, password reset 1h. Expired &rarr; 410.</li>
            <li><strong>Password reset:</strong> <code>/auth/forgot-password/</code> &rarr; token email &rarr; <code>/auth/reset-password/</code> &rarr; auto-login.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>EmailVerificationToken</strong> &mdash; created on register, consumed on verify. 24h expiry.</li>
            <li><strong>PasswordResetToken</strong> &mdash; created on forgot-password, consumed on reset. 1h expiry.</li>
            <li><strong>EmailRecord</strong> &mdash; immutable log for every email sent (VERIFICATION, PASSWORD_RESET types).</li>
            <li><strong>OrganizationMembershipRecord</strong> &mdash; CREATED event on registration (Flow A/B). ROLE_CHANGED + CREATED on org switch (Flow C).</li>
          </ul>
        </Step>
        <Step num={2} title="User adds a customer.">
          <h4 style={{ margin: "0 0 0.5rem" }}>A. With email only</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User enters name + email in Quick Add.</li>
            <li>Email is lowercased and validated.</li>
            <li>Customer created &mdash; email enables document delivery (estimates, invoices, COs).</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. With phone only</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User enters name + phone in Quick Add.</li>
            <li>Phone validated: <code>[0-9+\-().\\s]+</code>, 7&ndash;15 digits.</li>
            <li>Customer created &mdash; no email means no built-in document delivery. Relies on Copy Link / manual sharing.</li>
          </ol>

          <div style={note.box}>
            <p style={note.label}>Planned: Split phone/email into two inputs</p>
            <p style={{ margin: 0 }}>
              Currently Quick Add has a single polymorphic contact field that secretly accepts either phone or email
              (backend auto-remaps). Planned change: split into two clearly labeled fields (phone + email),
              require at least one valid entry.
            </p>
          </div>

          <h4 style={{ margin: "0 0 0.5rem" }}>Quick Add Details <span style={{ opacity: 0.5 }}>(current)</span></h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Single contact field:</strong> Quick Add has one field that accepts either phone or email (not both). Backend auto-remaps if a valid email is entered in the phone field.</li>
            <li><strong>Required:</strong> Name + one of phone/email.</li>
            <li><strong>Optional fields:</strong> Project address, ballpark value, notes, source.</li>
            <li><strong>Two submit intents:</strong> &quot;Save Customer + Start Project&quot; or &quot;Save Customer Only&quot;.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Duplicate Detection</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li>Backend scans for matching phone or email in same org (normalized phone as fallback).</li>
            <li>HTTP 409 &rarr; frontend shows resolution panel with candidates.</li>
            <li>User can reuse existing customer or cancel and refine.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>CustomerRecord</strong> &mdash; immutable snapshot on CREATED (and UPDATED on edits).</li>
            <li><strong>LeadContactRecord</strong> &mdash; CREATED on every quick-add intake. CONVERTED if project created in same request.</li>
          </ul>
        </Step>
        <Step num={3} title={<>User creates a project. <span style={{ opacity: 0.5 }}>(May happen in tandem with step 2 via Quick Add.)</span></>}>
          <h4 style={{ margin: "0 0 0.5rem" }}>A. Via Quick Add (step 2)</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Created in tandem with customer &mdash; see step 2.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Standalone (from Customers page)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User clicks &quot;Add Project&quot; on an existing customer row.</li>
            <li>Modal with project fields: name, site address, status, initial contract value.</li>
            <li><code>POST /customers/&lt;id&gt;/projects/</code></li>
          </ol>

          <div style={note.box}>
            <p style={note.label}>Gap: No project creation on the Projects page</p>
            <p style={{ margin: 0 }}>
              Projects can only be created from the Customers page. The Projects page itself is read-only for listing.
              Needs a &quot;New Project&quot; action with a customer selector.
            </p>
          </div>

          <h4 style={{ margin: "0 0 0.5rem" }}>Field Defaults</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Name:</strong> Defaults to &quot;&lt;customer&gt; Project&quot; if blank.</li>
            <li><strong>Site address:</strong> Defaults to customer&apos;s billing address. Validation fails if both are empty.</li>
            <li><strong>Status:</strong> &quot;prospect&quot; or &quot;active&quot; only. Defaults to &quot;prospect&quot;.</li>
            <li><strong>Initial contract value:</strong> Defaults to 0.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>No project-specific audit model.</strong> Creation recorded indirectly via <code>LeadContactRecord</code> (CONVERTED) if through Quick Add.</li>
            <li>Standalone creation has no immutable audit record.</li>
          </ul>
        </Step>
        <Step num={4} title={<>Estimate &rarr; approval cycle. <span style={{ opacity: 0.5 }}>(Not hard-required, but 100% expected for GCs.)</span></>}>
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Draft</strong> &rarr; mutable, user can edit freely.</li>
            <li><strong>Sent</strong> &rarr; immutable (values locked), awaiting customer decision.</li>
            <li><strong>Approved</strong> &rarr; terminal. Triggers project activation.</li>
            <li><strong>Rejected</strong> &rarr; can create revision (clone as new draft).</li>
            <li><strong>Void</strong> &rarr; terminal. User-driven cancellation.</li>
            <li><strong>Archived</strong> &rarr; terminal. System-controlled (superseded by newer version in same family).</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Happy Path: Draft &rarr; Send &rarr; Approved</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates estimate with title, line items (cost code + qty + unit price + markup%), tax%.</li>
            <li>User sends &rarr; org identity frozen (name, address, logo, terms). Email sent to customer.</li>
            <li>Customer receives email (or Copy Link), opens public preview.</li>
            <li>Customer completes OTP ceremony (email verification).</li>
            <li>Customer approves &rarr; project transitions to active. Estimate locked.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Rejection &rarr; Revision Cycle</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Customer rejects estimate (with optional note).</li>
            <li>User clones rejected estimate &rarr; new draft in same title family, version incremented (v1 &rarr; v2).</li>
            <li>User edits line items / pricing, re-sends.</li>
            <li>Previous version auto-archived when new version is created.</li>
            <li>Repeat until approved or voided.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Resend (Sent &rarr; Sent)</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can resend a sent estimate &mdash; triggers new email, same document.</li>
            <li>Recorded as a resend event in audit trail.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>D. Void</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can void from draft, sent, or rejected.</li>
            <li>Terminal &mdash; no further transitions.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>Title family:</strong> Same title = same family. Versions are 1-based. Approved family is locked (no more drafts).</li>
            <li><strong>Clone vs Duplicate:</strong> Clone = same family, new version. Duplicate = new family/project entirely.</li>
            <li><strong>Immutable after send:</strong> Title, tax%, line items, valid_through all locked once sent.</li>
            <li><strong>Org identity freeze:</strong> Sender name/address/logo/terms captured at send time, not live.</li>
            <li><strong>Public OTP ceremony:</strong> Customer must verify email via 6-digit code before signing. Session valid 60min.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>EstimateStatusEvent</strong> &mdash; immutable record on every status transition, resend, and note append. Captures from/to status, note, actor, IP, user-agent.</li>
            <li><strong>EmailRecord</strong> &mdash; DOCUMENT_SENT type logged when estimate is emailed to customer.</li>
            <li><strong>SigningCeremonyRecord</strong> &mdash; immutable record on customer approve/reject. Captures content hash, signer name, consent, session token.</li>
            <li><strong>DocumentAccessSession</strong> &mdash; OTP session created for public decision flow. Tracks code, verified_at, expiry.</li>
          </ul>
        </Step>
        <Step num={5} title="User creates change orders as scope evolves.">
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Draft</strong> &rarr; mutable, user can edit freely.</li>
            <li><strong>Pending Approval</strong> &rarr; sent to customer, awaiting decision. Identity frozen.</li>
            <li><strong>Approved</strong> &rarr; terminal. Propagates amount_delta to project contract value.</li>
            <li><strong>Rejected</strong> &rarr; can create revision.</li>
            <li><strong>Void</strong> &rarr; terminal.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Happy Path: Draft &rarr; Pending &rarr; Approved</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates CO linked to an approved estimate (<code>origin_estimate</code> required).</li>
            <li>Adds line items (cost code + description + amount_delta + days_delta). Line totals must sum to CO amount_delta.</li>
            <li>User sends &rarr; status to sent. Org identity frozen. Email sent to customer.</li>
            <li>Customer opens public preview, completes OTP ceremony.</li>
            <li>Customer approves &rarr; <code>amount_delta</code> added to <code>project.contract_value_current</code>.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Rejection &rarr; Revision Cycle</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Customer rejects CO.</li>
            <li>User clones &rarr; new draft in same family_key, revision_number incremented.</li>
            <li>If source was draft or pending, source auto-voided.</li>
            <li>Only the latest revision in a family can be cloned.</li>
            <li>Repeat until approved or voided.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Void</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can void from draft, pending, or rejected.</li>
            <li>If CO was previously approved, amount_delta is subtracted from project contract value.</li>
            <li>Terminal &mdash; no further transitions.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Origin estimate required:</strong> Every CO must link to an approved estimate. Immutable once set.</li>
            <li><strong>Family + revision:</strong> <code>family_key</code> groups revisions. Revision numbers are 1-based, unique per family per project.</li>
            <li><strong>Contract value propagation:</strong> Approved CO&apos;s <code>amount_delta</code> atomically added to <code>project.contract_value_current</code>.</li>
            <li><strong>Identity freeze:</strong> Sender name/address/logo/terms captured when leaving draft.</li>
            <li><strong>Public OTP ceremony:</strong> Same mechanism as estimates.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>ChangeOrderSnapshot</strong> &mdash; immutable record on approved, rejected, or void. Full CO + line items + decision context + financial delta.</li>
            <li><strong>SigningCeremonyRecord</strong> &mdash; immutable record on customer approve/reject from public page.</li>
            <li><strong>EmailRecord</strong> &mdash; DOCUMENT_SENT type logged when CO is emailed to customer.</li>
          </ul>
        </Step>
        <Step num={6} title="User creates an invoice (draft minimum — just needs an invoice #).">
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Draft</strong> &rarr; mutable, user can edit freely.</li>
            <li><strong>Sent</strong> &rarr; awaiting customer action. Identity frozen.</li>
            <li><strong>Partially Paid</strong> &rarr; some payment allocated, balance remaining.</li>
            <li><strong>Paid</strong> &rarr; terminal. Balance = $0.</li>
            <li><strong>Void</strong> &rarr; terminal. User cancellation.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Happy Path: Draft &rarr; Send &rarr; Paid</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates invoice &mdash; auto-generates invoice # (INV-0001, INV-0002, etc.).</li>
            <li>User adds line items (description, qty, unit price, optional cost code).</li>
            <li>User sends &rarr; org identity frozen. Email sent to customer.</li>
            <li>Customer receives email (or Copy Link), opens public preview.</li>
            <li>Customer approves via OTP ceremony &rarr; invoice transitions to paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Partial Payment Flow</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Payment allocated against sent invoice (via accounting page or Quick Payment).</li>
            <li>If applied amount &lt; total &rarr; status transitions to partially_paid.</li>
            <li>Balance recalculated: <code>total - sum(settled allocations)</code>.</li>
            <li>Additional payments applied until balance = $0 &rarr; paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Customer Dispute</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Customer can dispute from public preview (sent or partially_paid).</li>
            <li>Status stays the same &mdash; dispute is recorded as a note in the audit trail.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>D. Void</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can void from draft or sent.</li>
            <li>Terminal &mdash; no further transitions.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>No versioning:</strong> Unlike estimates, invoices have no title families or revision cloning.</li>
            <li><strong>Invoice # auto-generated:</strong> Sequential per project (INV-0001, INV-0002).</li>
            <li><strong>Identity freeze:</strong> Sender name/address/logo/terms backfilled from org on leaving draft.</li>
            <li><strong>Balance tracking:</strong> <code>balance_due = total - sum(settled allocations)</code>. Clamped to 0.</li>
            <li><strong>Auto-activation:</strong> Creating first invoice on a prospect project auto-transitions project to active.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>InvoiceStatusEvent</strong> &mdash; immutable record on every status transition, resend, note, and dispute.</li>
            <li><strong>EmailRecord</strong> &mdash; DOCUMENT_SENT type logged when invoice is emailed.</li>
            <li><strong>SigningCeremonyRecord</strong> &mdash; immutable record on customer approve/dispute from public page.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; immutable record when payment is allocated to invoice.</li>
          </ul>
        </Step>
        <Step num={7} title="User logs an ingress payment via Quick Payment.">
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Pending</strong> &rarr; payment recorded but not yet cleared.</li>
            <li><strong>Settled</strong> &rarr; default for manual entry. Money received.</li>
            <li><strong>Void</strong> &rarr; terminal. Reverses balance impact on linked invoices.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Quick Payment (one-step create + allocate)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User opens Quick Payment on project page (or inline on accounting Invoices tab).</li>
            <li>Fills in: method, amount, date, reference, notes.</li>
            <li>Optionally selects an invoice to allocate against (amount pre-filled with balance_due).</li>
            <li>Creates payment (settled by default), then allocates if target selected.</li>
            <li>Invoice balance_due recalculated. Status auto-transitions: partially_paid or paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Separate Allocation (two-step, Accounting page)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User creates payment on the Accounting page (Payments Ledger tab) without allocating.</li>
            <li>Later, selects payment, picks invoice target, enters amount.</li>
            <li>Supports split allocations &mdash; one payment across multiple invoices.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Void Payment</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User voids a settled payment &rarr; all linked invoice balances recalculated.</li>
            <li>Invoice auto-reverts: paid &rarr; sent, partially_paid &rarr; sent.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Settled by default:</strong> Manual entry assumes money already received.</li>
            <li><strong>Direction-locked:</strong> Inbound payments can only allocate to invoices.</li>
            <li><strong>Atomic allocation:</strong> Uses <code>select_for_update</code> row-level locking.</li>
            <li><strong>Cost code at payment time:</strong> Cost attribution set on allocation, not inherited from invoice.</li>
            <li><strong>Methods:</strong> Check, Zelle, ACH, Cash, Wire, Card, Other.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>PaymentRecord</strong> &mdash; immutable snapshot on CREATED, UPDATED, STATUS_CHANGED.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; immutable on APPLIED / REVERSED.</li>
            <li><strong>InvoiceStatusEvent</strong> &mdash; auto-recorded when payment causes invoice status transition.</li>
          </ul>
        </Step>
        <Step num={8} title="User creates vendor bills for subs/materials.">
          <h4 style={{ margin: "0 0 0.5rem" }}>Statuses</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Received</strong> &rarr; default. Bill entered from vendor document.</li>
            <li><strong>Disputed</strong> &rarr; user flags an issue with the bill.</li>
            <li><strong>Approved</strong> &rarr; bill verified, ready for payment.</li>
            <li><strong>Closed</strong> &rarr; terminal. Fully settled.</li>
            <li><strong>Void</strong> &rarr; terminal. Cancelled.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Happy Path: Received &rarr; Approved &rarr; Closed</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User receives a bill (paper, PDF, email) from a vendor/sub.</li>
            <li>Transcribes it on the Bills page: vendor, bill #, dates, line items (description + qty + unit price).</li>
            <li>Bill created in &quot;received&quot; status with balance_due = total.</li>
            <li>User reviews and approves the bill.</li>
            <li>Payment recorded against the bill (via Accounting page &rarr; Bills tab).</li>
            <li>Bill closed when fully paid.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Dispute Flow</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User disputes a received or approved bill (e.g., incorrect amount, wrong items).</li>
            <li>From disputed: can approve (resolved) or void (cancelled).</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>C. Void</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User can void from received, disputed, or approved.</li>
            <li>Terminal &mdash; no further transitions.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Key Mechanics</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Transcription tool:</strong> This page captures what the vendor wrote, not internal cost structure.</li>
            <li><strong>Vendor required:</strong> Every bill links to a Vendor (B2B relationship entity, org-scoped).</li>
            <li><strong>Duplicate detection:</strong> Same vendor + bill_number (case-insensitive) per org &rarr; HTTP 409.</li>
            <li><strong>Balance tracking:</strong> Driven by payment allocations, not status. <code>payment_status</code> derived: paid/partial/unpaid.</li>
            <li><strong>Editable only in received:</strong> Line items and fields locked after leaving received status.</li>
            <li><strong>Approval capability:</strong> Transitioning to approved requires <code>vendor_bills.approve</code> capability.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>VendorBillSnapshot</strong> &mdash; immutable record on every status transition (received, approved, disputed, closed, void). Full bill + line items + decision context.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; immutable when outbound payment allocated to bill (APPLIED / REVERSED).</li>
            <li><strong>PaymentRecord</strong> &mdash; immutable snapshot on outbound payment creation/status change.</li>
          </ul>
        </Step>
        <Step num={9} title="User logs receipts + their associated egress payment.">
          <h4 style={{ margin: "0 0 0.5rem" }}>What is a Receipt?</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Lightweight expense record &mdash; no statuses, no document lifecycle.</li>
            <li>Represents money already spent (backward-looking). Not a bill.</li>
            <li>Optionally linked to a Store (org-scoped lookup table, auto-created on first mention).</li>
            <li>Has a derived <code>balance_due</code> computed from settled payment allocations.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>A. Create Receipt (Quick Receipt on project page)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User opens Quick Receipt tab on the project page.</li>
            <li>Optionally uploads a photo &rarr; Gemini Vision OCR extracts fields.</li>
            <li>Fills in: store name, amount, date, notes.</li>
            <li><code>POST /projects/&lt;id&gt;/receipts/</code> creates the receipt. <strong>No payment auto-created.</strong></li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>B. Record Egress Payment (Accounting page &rarr; Receipts tab)</h4>
          <ol style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li>User opens Accounting page, Receipts tab.</li>
            <li>Expands a receipt row &rarr; sees balance_due, existing allocations.</li>
            <li>Fills in: amount, method, date, reference, notes.</li>
            <li>Creates outbound payment + allocates to receipt in two-step behind the scenes.</li>
            <li>Receipt balance_due recalculated.</li>
          </ol>

          <h4 style={{ margin: "0 0 0.5rem" }}>Receipt vs. Vendor Bill</h4>
          <ul style={{ margin: "0 0 1rem", paddingLeft: "1.25rem" }}>
            <li><strong>Receipt:</strong> No statuses, no line items, no lifecycle. Linked to Store (optional).</li>
            <li><strong>Vendor Bill:</strong> Full lifecycle. Has line items. Linked to Vendor (B2B).</li>
            <li>Separated by design &mdash; receipts aren&apos;t bills.</li>
          </ul>

          <h4 style={{ margin: "0 0 0.5rem" }}>Audit</h4>
          <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem" }}>
            <li><strong>No receipt-specific audit model.</strong> Tracked through payment allocations.</li>
            <li><strong>PaymentRecord</strong> &mdash; immutable snapshot on outbound payment creation/status change.</li>
            <li><strong>PaymentAllocationRecord</strong> &mdash; APPLIED / REVERSED events when allocated to receipt.</li>
          </ul>
        </Step>
      </ol>

      <div style={note.box}>
        <p style={note.label}>Insight: Copy Link for SMS delivery</p>
        <p style={{ margin: 0 }}>
          Public document links (estimates, invoices, COs) are already fully functional standalone pages
          with tokenized URLs. A &quot;Copy Link&quot; / tap-to-copy action next to Send would let users
          share via SMS, iMessage, WhatsApp, etc. Same flow, different delivery channel.
        </p>
      </div>

      <div style={note.box}>
        <p style={note.label}>Future: Receipts as proof-of-payment for bills</p>
        <p style={{ margin: 0 }}>
          Currently receipts and vendor bills are parallel models with no connection. In a multi-tenant
          org setting, a PM pays a sub and the owner wants the receipt attached to that bill payment as proof.
          Additive feature (associate receipt with payment allocation), not a restructuring. Defer past MVP.
        </p>
      </div>
    </div>
  );
}
