# Document Composer Contract (Estimate + CO + Invoice)

## Goal
Use one shared document surface for:
- Estimates
- Change Orders
- Invoices

The UI shell can stay consistent while each document type plugs in behavior through adapters.

## Contract Added
Shared contract types live in:
- `src/shared/document-composer/types.ts`

Core primitives:
- `DocumentKind`
- `ComposerStatusPolicy`
- `ComposerStatusEvent`
- `ComposerLineDraft`
- `ComposerTotals`
- `ComposerMetaField`
- `DocumentComposerAdapter<TDocument, TLine, TFormState>`
- `DocumentComposerProps<TDocument, TLine, TFormState>`

## Feature Adapters Added
- `src/features/estimates/document-adapter.ts`
- `src/features/change-orders/document-adapter.ts`
- `src/features/invoices/document-adapter.ts`

Each adapter provides:
1. Status policy normalization from existing backend contracts.
2. Status-event normalization to shared event shape.
3. Create/update payload mapping from feature draft form state.
4. Meta/totals/line mapping to shared composer primitives.

## Why This Helps
1. Stops UX drift between estimate/CO/invoice editors.
2. Keeps feature-specific business rules local to adapters.
3. Lets us build one WYSIWYG shell and reuse it everywhere.
4. Makes future docs (vendor bill, quote variants) easier to add.

## Next Extraction Steps
1. Build `DocumentComposer` shell component under `src/shared/document-composer/`.
2. Start with Estimate: replace `EstimateSheet` internals with shell + estimate adapter.
3. Migrate CO editor form to shell section-by-section.
4. Migrate Invoice create/editor form to same shell.
5. Keep list rails/status viewers feature-specific until final convergence.
