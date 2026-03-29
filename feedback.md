# PM Feedback — Estimate Creator (2026-03-28)

Source: PM demo session. First real ICP feedback.

## Items

1. [x] **Cost Codes** — Already implemented. PM just didn't realize it was live. *(Resolved — explanation only.)*
2. [ ] **Sub Items** — Hierarchical line items (parent/child nesting for visual grouping). *Moderate.*
    - when she nests items, does the parent line have its own quantity/price, or is it just a label that sums its children?
3. [x] **Drag and Drop Reorder** — Desktop only via @dnd-kit. Line number + grip handle as drag target. Mobile keeps up/down arrows. *(Done — estimates.)*
4. [ ] **Contract Attachment** — Store a link to external contract/DocuSign on the estimate. *Trivial.*
5. [ ] **Bottom of Bid Markups** — Summary-level markups below line items (contingency, OH&P, insurance). *Moderate.*
6. [x] **General Notes / Exclusions** — Text area at bottom of estimate for scope notes, exclusions, caveats. *(Done.)*
7. [x] **Custom Estimate Number** — Optional user-defined estimate number per job (e.g. job name + number). *Small.*
    - Remove the Estimate N# display: that's the internal DB ID, it's not controlled by the user.
8. [ ] **Sales Tax on Line Items** — Per-line tax flag or percentage for non-labor items. *Small.*
9. [ ] **Billing Schedule** — Payment schedule by % and amount with details, on estimates/invoices. *Larger — needs child model + UI.*


