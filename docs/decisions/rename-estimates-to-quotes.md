# Rename: Estimates to Quotes

Breaking change completed 2026-03-31. All layers renamed atomically.

## What Changed

| Layer | Before | After |
|-------|--------|-------|
| **Models** | `Estimate`, `EstimateLineItem`, `EstimateSection`, `EstimateStatusEvent` | `Quote`, `QuoteLineItem`, `QuoteSection`, `QuoteStatusEvent` |
| **FK fields** | `Invoice.related_estimate`, `ChangeOrder.origin_estimate`, `BillingPeriod.estimate` | `.related_quote`, `.origin_quote`, `.quote` |
| **Org fields** | `default_estimate_valid_delta`, `estimate_terms_and_conditions` | `default_quote_valid_delta`, `quote_terms_and_conditions` |
| **Serializers** | `serializers/estimates.py` (7 classes) | `serializers/quotes.py` |
| **Views** | `views/estimating/estimates.py`, `estimates_helpers.py` | `views/quoting/quotes.py`, `quotes_helpers.py` |
| **URLs** | `/estimates/`, `/public/estimates/`, `/contracts/estimates/` | `/quotes/`, `/public/quotes/`, `/contracts/quotes/` |
| **Policies** | `policies/estimates.py` | `policies/quotes.py` |
| **RBAC** | Capability key `"estimates"` | `"quotes"` |
| **Tests** | `test_estimates.py` | `test_quotes.py` |
| **Frontend feature** | `features/estimates/` | `features/quotes/` |
| **Frontend routes** | `/projects/[projectId]/estimates`, `/estimate/[publicRef]` | `/projects/[projectId]/quotes`, `/quote/[publicRef]` |
| **Docs** | ~19 files, `docs/call-chains/estimates.md` | All updated, `docs/call-chains/quotes.md` |
| **Migrations** | Re-compacted to new `0001_initial.py` with Quote model names | |

## Notes

- **Prod DB:** Full reset required (same as last migration compaction).
- **No backward compat:** No redirects, aliases, or shims. Clean break.
