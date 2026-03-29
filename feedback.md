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
    - Added general notes/exclusions editable text box.
7. [x] **Custom Estimate Number** — Optional user-defined estimate number per job (e.g. job name + number). *Small.*
    - Remove the Estimate N# display: that's the internal DB ID, it's not controlled by the user.
8. [x] **Sales Tax on Line Items** — Per-line tax flag or percentage for non-labor items. *Small.*
    - Okay, so this grouping of taxation is done per grouping of work (Labor vs. Materials).  This means, that inherently, the Cost Code is indicative of whether it should be taxed or not, since the Cost Code is a "codified type of work descriptor" for a line item.  As such - I made a taxable flag on each cost code, so you can control whether the line item is counted for taxation.  Side note:  This is not a global/country-wide practice, certain states do not have this (WA), and some states distinguish even by the category of work (OR enforces business vs. residential/new vs. repair) - so this'll allow flexibility for them to turn it off too.
9. [ ] **Billing Schedule** — Payment schedule by % and amount with details, on estimates/invoices. *Larger — needs child model + UI.*


Other things:
Made email sending optional on send/re-send via a checkbox.
