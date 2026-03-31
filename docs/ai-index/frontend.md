# Frontend Structural Index

_Auto-generated from `frontend/src/`. Do not edit manually._
_Regenerate: `python scripts/generate_ai_index.py`_

## Sections
- [App Routes](#app-routes)
- [Features — Change Orders](#features-change-orders)
- [Features — Cost Codes](#features-cost-codes)
- [Features — Customers](#features-customers)
- [Features — Dashboard](#features-dashboard)
- [Features — Quotes](#features-quotes)
- [Features — Invoices](#features-invoices)
- [Features — Onboarding](#features-onboarding)
- [Features — Organization](#features-organization)
- [Features — Payments](#features-payments)
- [Features — Projects](#features-projects)
- [Features — Vendor Bills](#features-vendor-bills)
- [Features — Vendors](#features-vendors)
- [Shared — Api](#shared-api)
- [Shared — Components](#shared-components)
- [Shared — Utilities](#shared-utilities)
- [Shared — Document Creator](#shared-document-creator)
- [Shared — Document Viewer](#shared-document-viewer)
- [Shared — Hooks](#shared-hooks)
- [Shared — Onboarding](#shared-onboarding)
- [Shared — Project List Viewer](#shared-project-list-viewer)
- [Shared — Pwa](#shared-pwa)
- [Shared — Session](#shared-session)
- [Shared — Shell](#shared-shell)
- [Shared — Types](#shared-types)
- [Shared — Utils](#shared-utils)

## App Routes

### `frontend/src/app/accounting/page.tsx`
_Accounting page — tabbed hub for invoices and bills._

**Depends on:**
- `@/features/payments`
- `@/shared/shell`

- [default] `AccountingPage`

### `frontend/src/app/admin/impersonate/page.tsx`
_Superuser impersonation page — lists all impersonatable users_

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`
- `@/shared/session/client-session`
- `@/shared/session/session-authorization`

- [default] `ImpersonatePage`

### `frontend/src/app/change-order/[publicRef]/page.tsx`

**Depends on:**
- `@/features/change-orders/components/change-order-public-preview`
- `@/shared/shell`
- `@/shared/styles/light-theme.module.css`

- [Component] `generateMetadata({...})`
- [default] `ChangeOrderPublicPage`

### `frontend/src/app/change-orders/page.tsx`

**Depends on:**
- `@/features/change-orders`
- `@/shared/shell`

- [default] `ChangeOrdersPage`

### `frontend/src/app/cost-codes/page.tsx`

**Depends on:**
- `@/features/cost-codes`
- `@/shared/shell`

- [default] `CostCodesPage`

### `frontend/src/app/customers/page.tsx`

**Depends on:**
- `@/features/customers`
- `@/shared/shell`

- [default] `CustomersPage`

### `frontend/src/app/dashboard/dashboard-route-content.tsx`

**Depends on:**
- `@/features/dashboard`
- `@/shared/shell`
- `@/shared/shell/page-shell.module.css`

- [Component] `DashboardRouteContent()`

### `frontend/src/app/dashboard/page.tsx`

- [default] `DashboardPage`

### `frontend/src/app/dev-notes/page.tsx`

- [default] `DevNotesPage`

### `frontend/src/app/error.tsx`

- [default] `GlobalError`

### `frontend/src/app/quote/[publicRef]/page.tsx`

**Depends on:**
- `@/features/quotes/components/quote-approval-preview`
- `@/shared/shell`
- `@/shared/styles/light-theme.module.css`

- [Component] `generateMetadata({...})`
- [default] `QuoteReviewPage`

### `frontend/src/app/invoice/[publicRef]/page.tsx`

**Depends on:**
- `@/features/invoices/components/invoice-public-preview`
- `@/shared/shell`
- `@/shared/styles/light-theme.module.css`

- [Component] `generateMetadata({...})`
- [default] `InvoiceReviewPage`

### `frontend/src/app/invoices/page.tsx`

- [default] `InvoicesRedirect`

### `frontend/src/app/landing-page.tsx`

**Depends on:**
- `@/shared/session/session-authorization`

- [Component] `LandingPage()`

### `frontend/src/app/layout.tsx`

**Depends on:**
- `@/shared/pwa`
- `@/shared/session/session-authorization`
- `@/shared/shell`

- [default] `RootLayout`

### `frontend/src/app/login/login-route-content.tsx`

**Depends on:**
- `@/shared/api/health`
- `@/shared/session/components/home-auth-console`
- `@/shared/session/session-authorization`

- [Component] `LoginRouteContent({...})`

### `frontend/src/app/login/page.tsx`

**Depends on:**
- `@/shared/api/health`

- [default] `LoginPage`

### `frontend/src/app/manifest.ts`

- [default] `manifest`

### `frontend/src/app/offline/page.tsx`

- [default] `OfflinePage`

### `frontend/src/app/onboarding/page.tsx`

**Depends on:**
- `@/features/onboarding`
- `@/shared/shell`
- `@/shared/shell/page-shell.module.css`

- [default] `OnboardingPage`

### `frontend/src/app/ops/organization/page.tsx`

**Depends on:**
- `@/features/organization/components/organization-console`

- [default] `OrganizationPage`

### `frontend/src/app/page.tsx`

- [default] `Home`

### `frontend/src/app/projects/[projectId]/audit-trail/page.tsx`

**Depends on:**
- `@/features/projects/components/project-activity-console`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectAuditTrailPage`

### `frontend/src/app/projects/[projectId]/bills/page.tsx`

**Depends on:**
- `@/features/vendor-bills`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectBillsPage`

### `frontend/src/app/projects/[projectId]/change-orders/page.tsx`

**Depends on:**
- `@/features/change-orders`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectChangeOrdersPage`

### `frontend/src/app/projects/[projectId]/quotes/page.tsx`

**Depends on:**
- `@/features/quotes`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectQuotesPage`

### `frontend/src/app/projects/[projectId]/invoices/page.tsx`

**Depends on:**
- `@/features/invoices`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectInvoicesPage`

### `frontend/src/app/projects/page.tsx`

**Depends on:**
- `@/features/projects`
- `@/shared/shell`

- [default] `ProjectsPage`

### `frontend/src/app/register/page.tsx`

**Depends on:**
- `@/shared/api/health`
- `@/shared/session/components/home-register-console`

- [default] `RegisterPage`

### `frontend/src/app/reset-password/page.tsx`

**Depends on:**
- `@/shared/session/components/reset-password-console`

- [default] `ResetPasswordPage`

### `frontend/src/app/vendors/page.tsx`

**Depends on:**
- `@/features/vendors`
- `@/shared/shell`

- [default] `VendorsPage`

### `frontend/src/app/verify-email/page.tsx`

**Depends on:**
- `@/shared/session/components/verify-email-console`

- [default] `VerifyEmailPage`

## Features — Quotes

### `frontend/src/features/quotes/api.ts`
_Quotes feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchQuotePolicyContract({...})` — Fetch the quote policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/quotes/components/cost-code-combobox.tsx`
_Accessible combobox for selecting a cost code._

- [fn] `CostCodeCombobox({...})` — Render a searchable combobox for cost code selection.

### `frontend/src/features/quotes/components/quote-approval-preview.tsx`

**Depends on:**
- `@/shared/date-format`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-viewer/public-document-viewer-shell`
- `@/shared/document-viewer/signing-ceremony`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-print-context`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `QuoteApprovalPreview({...})`

### `frontend/src/features/quotes/components/quote-sheet.tsx`
_Quote document creator sheet used for both creating and editing quotes._

**Depends on:**
- `@/shared/date-format`
- `@/shared/document-creator`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/hooks/use-media-query`
- `@/shared/money-format`

- [fn] `QuoteSheet({...})` — Composable quote sheet supporting draft creation, draft editing, and

### `frontend/src/features/quotes/components/quotes-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/date-format`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-line-items`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/hooks/use-status-filters`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`
- `@/shared/shell/printable-context`

- [fn] `QuotesConsole({...})`

### `frontend/src/features/quotes/components/quotes-viewer-panel.tsx`
_Presentational component for the quotes viewer panel._

**Depends on:**
- `@/shared/date-format`
- `@/shared/money-format`
- `@/shared/project-list-viewer`

- [Component] `QuotesViewerPanel({...})`
- [type] `QuoteFamily` { title, items }
- [type] `QuotesViewerPanelProps` { selectedProject, isMobile, isViewerExpanded, setIsViewerExpanded, viewerStatusOptions, quoteStatusFilters, ... }

### `frontend/src/features/quotes/components/quotes-workspace-panel.tsx`
_Workspace panel for the quotes console — toolbar, family-collision_

**Depends on:**
- `@/shared/styles/decision-stamp.module.css`

- [Component] `QuotesWorkspacePanel({...})`
- [type] `QuotesWorkspacePanelProps` { workspaceContextLabel, workspaceContext, workspaceBadgeClass, workspaceBadgeLabel, selectedQuote, onStartNew, ... }

### `frontend/src/features/quotes/document-adapter.ts`
_Document-creator adapter for quotes._

- [fn] `toQuoteStatusPolicy(contract)` — Convert the backend policy contract (snake_case) to the creator's
- [fn] `toQuoteStatusEvents(events)` — Convert backend status event records to the creator's status event
- [fn] `createQuoteDocumentAdapter(statusPolicy, statusEvents)` — Build a fully configured document-creator adapter for quotes.

### `frontend/src/features/quotes/helpers.ts`
_Pure helper functions for the quotes feature._

**Depends on:**
- `@/shared/api/error`

- [fn] `normalizeQuotePolicy({...})`
- [fn] `resolveAutoSelectQuote(rows, activeFilters, hints)` — Pick the best quote to auto-select after a list load.
- [fn] `validateQuoteLineItems(lines)`
- [fn] `resolveQuoteValidationDeltaDays(defaults)`
- [fn] `emptyLine(localId, defaultCostCodeId = "")`
- [fn] `mapQuoteLineItemsToInputs(items)`
- [fn] `readQuoteApiError(payload, fallback)`
- [fn] `normalizeFamilyTitle(value)`
- [fn] `mapPublicQuoteLineItems(quote)`
- [fn] `mapLineCostCodes(quote)`
- [fn] `quoteStatusLabel(status)`
- [fn] `formatStatusAction(event)`
- [fn] `isResendStatusEvent(event)`
- [fn] `isNotatedStatusEvent(event)`
- [fn] `toNumber(value)`
- [fn] `computeLineTotal(line)`
- [fn] `groupQuoteFamilies(quotes)` — Group quotes by title into families, sorted by version within each
- [fn] `computeQuoteStatusCounts(families)` — Count how many families have each status as their latest version's status.
- [fn] `filterVisibleFamilies(families, statusFilters)` — Filter families to those whose latest version's status is in the active filter set.
- [type] `NormalizedQuotePolicy` { statuses, statusLabels, allowedTransitions, quickActionByStatus, defaultCreateStatus, defaultStatusFilters }
- [type] `LineValidationIssue` { localId, rowNumber, message }
- [type] `LineValidationResult` { issues, issuesByLocalId }
- [type] `QuoteFamily` { title, items }

### `frontend/src/features/quotes/hooks/use-quote-form-fields.ts`
_Quote form field state for the composer panel._

- [fn] `useQuoteFormFields({...})` — Manage quote composer form fields: title, dates, tax, terms, sort,
- [type] `QuoteFamilyCollisionPrompt` { title, latestQuoteId, latestVersion, familySize }

### `frontend/src/features/quotes/index.ts`

- [re-export] `QuotesConsole` from `./components/quotes-console`
- [re-export] `QuoteSheet` from `./components/quote-sheet`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/quotes/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, name, status, customer, customer_display_name, customer_billing_address, ... }
- [type] `QuoteRecord` { id, project, version, status, title, valid_through, ... }
- [type] `QuoteLineItemRecord` { id, cost_code, cost_code_code, cost_code_name, description, quantity, ... }
- [type] `QuoteStatusEventRecord` { id, from_status, to_status, note, action_type, changed_by_email, ... }
- [type] `QuoteRelatedChangeOrderRecord` { id, number, revision_number, title, status, origin_quote, ... }
- [type] `QuoteLineInput` { localId, costCodeId, description, quantity, unit, unitCost, ... }
- [type] `QuotePolicyContract` { policy_version, status_labels, statuses, default_create_status, default_status_filters, allowed_status_transitions, ... }
- [type] `ApiResponse` { email_sent, conversion_status, code, message, fields, latest_quote_id, ... }

## Features — Change Orders

### `frontend/src/features/change-orders/api.ts`
_Change-order feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchChangeOrderPolicyContract({...})` — Fetch the change-order policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/change-orders/components/change-order-public-preview.tsx`

**Depends on:**
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-viewer/public-document-viewer-shell`
- `@/shared/document-viewer/signing-ceremony`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-print-context`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `ChangeOrderPublicPreview({...})`

### `frontend/src/features/change-orders/components/change-orders-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/money-format`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`
- `@/shared/shell/printable-context`

- [fn] `ChangeOrdersConsole({...})`

### `frontend/src/features/change-orders/components/change-orders-display.ts`
_Pure display helpers for change order consoles and viewers._

**Depends on:**
- `@/shared/money-format`

- [fn] `statusLabel(status, statusLabels, string>)`
- [fn] `quickStatusControlLabel(status, statusLabels, string>, currentStatus)` — Derive a user-facing control label for a quick-status pill button.
- [fn] `statusEventLabel(status, statusLabels, string>)` — Resolve a status to its human label, returning "Unset" for empty/falsy values.
- [fn] `formatEventDateTime(dateValue)`
- [fn] `formatApprovedDate(dateValue)`
- [fn] `eventActorLabel(event)`
- [fn] `eventActorHref(event)`
- [fn] `statusEventActionLabel(event, statusLabels, string>)` — Derive a past-tense action label from a status audit event.
- [fn] `approvalMeta(quote)`
- [fn] `approvedRollingDeltaForQuote(quoteId, changeOrders)` — Sum approved change order deltas for a given origin quote.
- [fn] `originalBudgetTotalForQuote(quoteId, originQuoteOriginalTotals, number>)`
- [fn] `currentApprovedBudgetTotalForQuote({...})`
- [fn] `lastStatusEventForChangeOrder(changeOrderId, projectAuditEvents)` — Find the most recent status event for a specific change order from the project's audit events.
- [fn] `toLinePayload(lines)`

### `frontend/src/features/change-orders/components/change-orders-viewer-panel.tsx`
_Presentational component for the change-orders viewer panel._

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/project-list-viewer`

- [Component] `ChangeOrdersViewerPanel({...})`
- [type] `ChangeOrdersViewerPanelProps` { isMobile, isViewerExpanded, setIsViewerExpanded, selectedProjectId, selectedProjectName, selectedProjectCustomerEmail, ... }

### `frontend/src/features/change-orders/components/change-orders-workspace-panel.tsx`
_Workspace panel for the change-orders console -- toolbar, create form,_

**Depends on:**
- `@/features/quotes/components/cost-code-combobox`
- `@/shared/document-creator`
- `@/shared/document-creator/change-order-creator.module.css`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/document-creator/types`
- `@/shared/document-viewer/read-only-line-table`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [Component] `ChangeOrdersWorkspacePanel({...})`
- [type] `ChangeOrdersWorkspacePanelProps` { isMobile, selectedProjectId, selectedViewerQuoteId, selectedViewerQuote, projectQuotes, selectedChangeOrder, ... }

### `frontend/src/features/change-orders/document-adapter.ts`
_Document-creator adapter for change orders._

- [fn] `toChangeOrderStatusPolicy(contract)` — Convert the backend policy contract (snake_case) to the creator's
- [fn] `toChangeOrderStatusEvents(events)` — Convert backend status event records to the creator's status event
- [fn] `createChangeOrderDocumentAdapter(statusPolicy, statusEvents)` — Build a fully configured document-creator adapter for change orders.

### `frontend/src/features/change-orders/helpers.ts`
_Pure helper functions for the change-orders feature._

**Depends on:**
- `@/shared/api/error`

- [fn] `isFiniteNumericInput(value)`
- [fn] `validateLineItems(lines)`
- [fn] `emptyLine(localId)`
- [fn] `defaultChangeOrderTitle(projectName)`
- [fn] `coLabel(changeOrder, "family_key">)`
- [fn] `publicChangeOrderHref(publicRef)`
- [fn] `readChangeOrderApiError(payload, fallback)`

### `frontend/src/features/change-orders/hooks/use-change-order-form.ts`
_Dual-mode form state for the change-orders console._

**Depends on:**
- `@/shared/hooks/use-line-items`
- `@/shared/money-format`

- [fn] `useChangeOrderForm()` — Manage dual-mode (create + edit) form state for change orders.

### `frontend/src/features/change-orders/hooks/use-change-order-project-data.ts`
_Project-scoped data fetching for the change-orders console._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useChangeOrderProjectData({...})` — Fetch and manage all project-scoped data for the change-orders console.

### `frontend/src/features/change-orders/hooks/use-change-order-viewer.ts`
_Viewer-side derived state for the change-orders console._

**Depends on:**
- `@/shared/hooks/use-client-pagination`
- `@/shared/money-format`
- `@/shared/session/rbac`

- [fn] `sortChangeOrdersForViewer(changeOrders)`
- [fn] `computeWorkingTotals({...})` — Compute pre- and post-approval working budget totals for the selected
- [fn] `useChangeOrderViewer({...})` — Compute all viewer-side derived state for the change-orders console.

### `frontend/src/features/change-orders/index.ts`

- [re-export] `ChangeOrdersConsole` from `./components/change-orders-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/change-orders/types.ts`

**Depends on:**
- `@/shared/document-creator`
- `@/shared/types/domain`

- [type] `ProjectRecord` { id }
- [type] `OriginQuoteLineItem` { id, cost_code_code, cost_code_name, description, quantity, unit, ... }
- [type] `OriginQuoteRecord` { id, title, version, approved_at, approved_by_email, grand_total, ... }
- [type] `AuditEventRecord` { id, event_type, object_type, object_id, from_status, to_status, ... }
- [type] `CostCodeOption` { id, code, name, is_active }
- [type] `ChangeOrderLineRecord` { id, change_order, cost_code, cost_code_id, cost_code_code, cost_code_name, ... }
- [type] `ChangeOrderRecord` { id, project, family_key, title, status, public_ref, ... }
- [type] `ChangeOrderPolicyContract` { policy_version, status_labels, statuses, default_create_status, allowed_status_transitions, terminal_statuses, ... }
- [type] `ChangeOrderLineInput` { localId, costCodeId, description, adjustmentReason, amountDelta, daysDelta }
- [type] `LineValidationIssue` { localId, rowNumber, message }
- [type] `ApiResponse` { email_sent, error }

## Features — Invoices

### `frontend/src/features/invoices/api.ts`
_Invoices feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchInvoicePolicyContract({...})` — Fetch the invoice policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/invoices/components/invoice-public-preview.tsx`

**Depends on:**
- `@/shared/date-format`
- `@/shared/document-viewer/public-document-viewer-shell`
- `@/shared/document-viewer/signing-ceremony`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-print-context`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `InvoicePublicPreview({...})`

### `frontend/src/features/invoices/components/invoices-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/date-format`
- `@/shared/hooks/use-client-pagination`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-line-items`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/hooks/use-status-filters`
- `@/shared/hooks/use-status-message`
- `@/shared/money-format`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`
- `@/shared/shell/printable-context`

- [fn] `InvoicesConsole({...})`

### `frontend/src/features/invoices/components/invoices-viewer-panel.tsx`
_Presentational component for the invoices viewer panel._

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/document-viewer/read-only-line-table`
- `@/shared/money-format`

- [Component] `InvoicesViewerPanel({...})`
- [type] `InvoicesViewerPanelProps` { selectedProject, invoiceSearch, onInvoiceSearchChange, invoiceStatuses, invoiceStatusFilters, toggleInvoiceStatusFilter, ... }

### `frontend/src/features/invoices/components/invoices-workspace-panel.tsx`
_Workspace panel for the invoices console — toolbar, DocumentCreator form,_

**Depends on:**
- `@/features/quotes/components/cost-code-combobox`
- `@/shared/document-creator`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/invoice-creator.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/document-creator/types`
- `@/shared/document-viewer/read-only-line-table`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [Component] `InvoicesWorkspacePanel({...})`
- [type] `InvoicesWorkspacePanelProps` { isMobile, canMutateInvoices, workspaceSourceInvoice, workspaceIsLocked, workspaceContext, workspaceBadgeLabel, ... }

### `frontend/src/features/invoices/document-adapter.ts`
_Document-creator adapter for invoices._

- [fn] `toInvoiceStatusPolicy(contract)` — Convert the backend policy contract (snake_case) to the creator's
- [fn] `toInvoiceStatusEvents(events)` — Convert backend status event records to the creator's status event
- [fn] `createInvoiceDocumentAdapter(statusPolicy, statusEvents)` — Build a fully configured document-creator adapter for invoices.

### `frontend/src/features/invoices/helpers.ts`
_Pure helper functions for the invoices feature._

**Depends on:**
- `@/shared/api/error`

- [fn] `dueDateFromIssueDate(issueDate, dueDays)`
- [fn] `normalizeDecimalInput(value, fallback = "0")`
- [fn] `emptyLine(localId)`
- [fn] `invoiceStatusLabel(status)`
- [fn] `publicInvoiceHref(publicRef)`
- [fn] `invoiceNextActionHint(status)`
- [fn] `nextInvoiceNumberPreview(invoices)`
- [fn] `invoiceStatusEventActionLabel(event, statusLabel)`
- [fn] `readInvoiceApiError(payload, fallback)`
- [fn] `projectStatusLabel(statusValue)`
- [fn] `validateInvoiceLineItems(lines)`
- [type] `InvoiceLineValidationIssue` { localId, rowNumber, message }
- [type] `InvoiceLineValidationResult` { issues, issuesByLocalId }

### `frontend/src/features/invoices/hooks/use-invoice-data.ts`
_Invoice data fetching and list state._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useInvoiceData({...})` — Fetch and manage invoice-related data for the scoped project.
- [type] `ContractBreakdown` { active_quote, approved_change_orders }

### `frontend/src/features/invoices/hooks/use-invoice-form-fields.ts`
_Invoice workspace form field state._

**Depends on:**
- `@/shared/date-format`

- [fn] `useInvoiceFormFields({...})` — Manage invoice workspace form fields and workspace context.

### `frontend/src/features/invoices/index.ts`

- [re-export] `InvoicesConsole` from `./components/invoices-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/invoices/types.ts`

**Depends on:**
- `@/shared/document-creator`
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, name, customer, customer_display_name, customer_email, status }
- [type] `InvoiceRecord` { id, project, customer, customer_display_name, invoice_number, public_ref, ... }
- [type] `InvoiceStatusEventRecord` { id, invoice, from_status, to_status, note, action_type, ... }
- [type] `InvoicePolicyContract` { policy_version, status_labels, statuses, default_create_status, default_status_filters, allowed_status_transitions, ... }
- [type] `InvoiceLineInput` { localId, costCode, description, quantity, unit, unitPrice }
- [type] `ApiResponse` { organization, email_sent, error }

## Features — Vendor Bills

### `frontend/src/features/vendor-bills/api.ts`
_Vendor-bills feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchVendorBillPolicyContract({...})` — Fetch the vendor-bill policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/vendor-bills/components/vendor-bills-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/api/error`
- `@/shared/date-format`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/hooks/use-combobox`
- `@/shared/hooks/use-creator-flash`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/hooks/use-status-filters`
- `@/shared/hooks/use-status-message`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `VendorBillsConsole({...})`

### `frontend/src/features/vendor-bills/helpers.ts`
_Pure helper functions for the vendor-bills feature._

- [fn] `createEmptyVendorBillLineRow()`
- [fn] `defaultBillStatusFilters(statuses)`
- [fn] `projectStatusLabel(statusValue)`
- [fn] `formatMoney(value)`

### `frontend/src/features/vendor-bills/hooks/use-vendor-bill-form.ts`
_Vendor bill create/edit form state._

**Depends on:**
- `@/shared/date-format`

- [fn] `useVendorBillForm({...})` — Manage vendor bill form fields for both create and edit modes.

### `frontend/src/features/vendor-bills/hooks/use-vendor-bill-viewer.ts`
_Vendor bill viewer panel state — status actions, accordion sections, and snapshots._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useVendorBillViewer({...})` — Manage viewer panel state for the selected vendor bill.

### `frontend/src/features/vendor-bills/index.ts`

- [re-export] `VendorBillsConsole` from `./components/vendor-bills-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/vendor-bills/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, name, customer_display_name, status }
- [type] `VendorRecord` { id, name, email }
- [type] `VendorBillAllocationRecord` { id, payment, applied_amount, payment_date, payment_method, payment_status, ... }
- [type] `VendorBillRecord` { id, project, project_name, vendor, vendor_name, bill_number, ... }
- [type] `VendorBillLineRecord` { id, cost_code, cost_code_code, cost_code_name, description, quantity, ... }
- [type] `VendorBillSnapshotRecord` { id, vendor_bill, capture_status, status_note, acted_by, acted_by_email, ... }
- [type] `VendorBillLineInput` { description, quantity, unit_price }
- [type] `VendorBillPayload` { projectId, vendor, bill_number, received_date, issue_date, due_date, ... }
- [type] `ScanResultLineItem` { description, quantity, unit_price }
- [type] `ScanResult` { document_type, vendor_name, bill_number, issue_date, due_date, subtotal, ... }
- [type] `VendorBillPolicyContract` { policy_version, status_labels, statuses, default_create_status, allowed_status_transitions, terminal_statuses }
- [type] `ApiResponse` { duplicate_candidates, error }

## Features — Payments

### `frontend/src/features/payments/api.ts`
_Payments feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchPaymentPolicyContract({...})` — Fetch the payment policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/payments/components/accounting-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/hooks/use-media-query`
- `@/shared/session/use-shared-session`

- [Component] `AccountingConsole()`

### `frontend/src/features/payments/components/bills-tab.tsx`

**Depends on:**
- `@/features/vendor-bills/types`
- `@/shared/api/base`
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/hooks/use-client-pagination`
- `@/shared/session/auth-headers`

- [fn] `BillsTab({...})`

### `frontend/src/features/payments/components/invoices-tab.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/hooks/use-client-pagination`
- `@/shared/session/auth-headers`

- [fn] `InvoicesTab({...})`

### `frontend/src/features/payments/components/payment-recorder.tsx`

**Depends on:**
- `@/shared/date-format`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `PaymentRecorder({...})`
- [type] `PaymentRecorderProps` { projectId, direction, allocationTargets, onPaymentsChanged, hideHeader, createOnly, ... }

### `frontend/src/features/payments/components/payments-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/hooks/use-client-pagination`
- `@/shared/hooks/use-combobox`
- `@/shared/hooks/use-status-message`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `PaymentsConsole()`

### `frontend/src/features/payments/components/payments-ledger-tab.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/hooks/use-client-pagination`
- `@/shared/session/auth-headers`

- [fn] `PaymentsLedgerTab({...})`

### `frontend/src/features/payments/hooks/use-payment-data.ts`
_Payment data loading, policy contract, and entity lists._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `usePaymentData(authToken, scopedCustomerId, scopedProjectId)` — Fetch and manage all server data for the payments console.

### `frontend/src/features/payments/hooks/use-payment-filters.ts`
_Client-side payment list filtering and search._

- [fn] `usePaymentFilters(allPayments)` — Filter and search the payment list for display.

### `frontend/src/features/payments/hooks/use-payment-form.ts`
_Payment form field state and lifecycle helpers._

**Depends on:**
- `@/shared/date-format`

- [fn] `usePaymentForm(initialMethod)` — Manage payment form field state and mode transitions.

### `frontend/src/features/payments/index.ts`

- [re-export] `PaymentRecorder` from `./components/payment-recorder`
- [re-export] `PaymentsConsole` from `./components/payments-console`
- [re-export] `AccountingConsole` from `./components/accounting-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/payments/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, customer, name, customer_display_name, status }
- [type] `AllocationTarget` { id, label, balanceDue }
- [type] `CustomerRecord` { id, display_name }
- [type] `PaymentRecord` { id, organization, customer, customer_name, project, project_name, ... }
- [type] `InvoiceRecord` { id, invoice_number, status, total, balance_due }
- [type] `VendorBillRecord` { id, bill_number, status, total, balance_due }
- [type] `PaymentPolicyContract` { policy_version, status_labels, statuses, directions, methods, default_create_status, ... }
- [type] `ApiResponse` { code, message, fields }

## Features — Projects

### `frontend/src/features/projects/api.ts`
_Projects feature API configuration._

- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/projects/components/deposit-panel.tsx`

**Depends on:**
- `@/shared/money-format`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`

- [fn] `DepositPanel({...})`

### `frontend/src/features/projects/components/project-activity-console.tsx`

**Depends on:**
- `@/features/projects/api`
- `@/features/projects/types`
- `@/shared/date-format`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`

- [Component] `ProjectActivityConsole({...})`

### `frontend/src/features/projects/components/projects-console.tsx`

**Depends on:**
- `@/features/payments`
- `@/shared/api/error`
- `@/shared/hooks/use-status-message`
- `@/shared/money-format`
- `@/shared/project-list-viewer`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`

- [fn] `ProjectsConsole()`

### `frontend/src/features/projects/index.ts`

- [re-export] `ProjectsConsole` from `./components/projects-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/projects/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, customer, customer_display_name, name, status, contract_value_original, ... }
- [type] `ProjectFinancialSummary` { project_id, contract_value_original, contract_value_current, accepted_contract_total, approved_change_orders_total, invoiced_to_date, ... }
- [type] `AccountingSyncEventRecord` { id, project, project_name, provider, object_type, object_id, ... }
- [type] `ProjectTraceabilityRecord` { id, label, status, amount, detail_endpoint }
- [type] `ProjectTraceabilityBucket` { ui_route, list_endpoint, total, records }
- [type] `ApprovedQuote` { id, title, grand_total }
- [type] `ApiResponse` { retry_status, code, message, fields }
- [type] `PortfolioProjectSnapshot` { project_id, project_name, project_status, ar_outstanding, ap_outstanding, approved_change_orders_total }
- [type] `PortfolioSnapshot` { generated_at, date_from, date_to, active_projects_count, ar_total_outstanding, ap_total_outstanding, ... }
- [type] `ChangeImpactProject` { project_id, project_name, approved_change_orders_count, approved_change_orders_total }
- [type] `ChangeImpactSummary` { generated_at, date_from, date_to, approved_change_orders_count, approved_change_orders_total, projects }
- [type] `AttentionFeedItem` { kind, severity, label, detail, project_id, project_name, ... }
- [type] `AttentionFeed` { generated_at, due_soon_window_days, item_count, items }
- [type] `ProjectTimelineItem` { timeline_id, category, event_type, occurred_at, label, detail, ... }
- [type] `ProjectTimeline` { project_id, project_name, category, item_count, items }

### `frontend/src/features/projects/utils/project-helpers.ts`
_Pure helpers for the projects feature._

- [fn] `parseMoneyValue(value)` — Coerce an unknown value to a numeric dollar amount.
- [fn] `formatCustomerName(project)`
- [fn] `projectStatusLabel(statusValue)`
- [fn] `allowedProfileStatuses(currentStatus)` — Build the list of statuses allowed in the profile editor for a given project.

## Features — Customers

### `frontend/src/features/customers/api.ts`
_Customers feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `postQuickAddCustomerIntake({...})` — Submit a quick-add customer intake record.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/customers/components/customer-editor-form.tsx`

- [Component] `CustomerEditorForm({...})`

### `frontend/src/features/customers/components/customer-project-create-form.tsx`

- [Component] `CustomerProjectCreateForm({...})`

### `frontend/src/features/customers/components/customers-console.tsx`

**Depends on:**
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `CustomersConsole()`

### `frontend/src/features/customers/components/customers-filters.tsx`

- [Component] `CustomersFilters({...})`

### `frontend/src/features/customers/components/customers-list.tsx`

**Depends on:**
- `@/features/projects/types`
- `@/shared/phone-format`

- [Component] `CustomersList({...})`

### `frontend/src/features/customers/components/quick-add/duplicate-resolution-panel.tsx`

- [Component] `DuplicateResolutionPanel({...})`

### `frontend/src/features/customers/components/quick-add/quick-add-console.tsx`

**Depends on:**
- `@/shared/session/use-shared-session`

- [Component] `QuickAddConsole({...})`

### `frontend/src/features/customers/components/quick-add/quick-add-form.tsx`

- [Component] `QuickAddForm({...})`

### `frontend/src/features/customers/hooks/quick-add-controller.types.ts`

- [type] `LeadFieldErrors` { full_name, phone, project_address, project_name }
- [type] `PendingSubmission` { payload, intent, projectName, projectStatus }
- [type] `UseQuickAddControllerArgs` { authToken, baseAuthMessage, onCustomerCreated }
- [type] `QuickAddControllerApi` { fullNameRef, authMessage, leadMessage, leadMessageTone, conversionMessage, conversionMessageTone, ... }

### `frontend/src/features/customers/hooks/quick-add-validation.ts`
_Client-side validation for the quick-add customer intake form._

- [fn] `validateLeadFields(payload, {...})` — Validate lead-capture fields and return a map of field-level errors.

### `frontend/src/features/customers/hooks/use-customer-editor.ts`
_Customer editor modal lifecycle hook._

**Depends on:**
- `@/shared/api/base`
- `@/shared/hooks/use-backdrop-dismiss`
- `@/shared/session/auth-headers`

- [fn] `useCustomerEditor({...})` — Manage the customer edit modal lifecycle: open, populate, PATCH, close.

### `frontend/src/features/customers/hooks/use-customer-filters.ts`
_Client-side customer list filtering._

- [fn] `useCustomerFilters(customerRows)` — Filter customer rows by activity status and project ownership.

### `frontend/src/features/customers/hooks/use-customer-list-fetch.ts`
_Customer list data fetching hook._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useCustomerListFetch(authToken)` — Fetch and paginate the customer list from the server.

### `frontend/src/features/customers/hooks/use-project-creator.ts`
_Project creation modal lifecycle hook._

**Depends on:**
- `@/features/projects/types`
- `@/shared/api/base`
- `@/shared/hooks/use-backdrop-dismiss`
- `@/shared/session/auth-headers`

- [fn] `useProjectCreator({...})` — Manage the create-project modal lifecycle: open, populate, POST, navigate.

### `frontend/src/features/customers/hooks/use-projects-by-customer.ts`
_Project-by-customer index for the customer list accordion._

**Depends on:**
- `@/features/projects/types`
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useProjectsByCustomer(authToken)` — Fetch all projects and group them by customer ID.

### `frontend/src/features/customers/hooks/use-quick-add-auth-status.ts`
_Derives a user-facing authentication status message for the quick-add form._

- [fn] `useQuickAddAuthStatus({...})` — Return the auth status message that should be displayed in the quick-add

### `frontend/src/features/customers/hooks/use-quick-add-business-workflow.ts`
_Business-workflow hook for the quick-add customer intake form._

- [fn] `useQuickAddBusinessWorkflow({...})` — Manage the full submission lifecycle for the quick-add form.

### `frontend/src/features/customers/hooks/use-quick-add-controller.ts`
_Top-level controller hook for the quick-add customer intake form._

- [fn] `useQuickAddController({...})` — Initialize and return the full quick-add controller API.

### `frontend/src/features/customers/index.ts`

- [re-export] `CustomersConsole` from `./components/customers-console`
- [re-export] `QuickAddConsole` from `./components/quick-add/quick-add-console`

### `frontend/src/features/customers/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `CustomerRow` { id, display_name, phone, email, billing_address, is_archived, ... }
- [type] `ApiResponse` { data, code, message, fields }
- [type] `CustomerIntakeRecord` { id, full_name, phone, project_address, email, initial_contract_value, ... }
- [type] `DuplicateCustomerCandidate` { id, display_name, phone, billing_address, email, is_archived, ... }
- [type] `CustomerIntakePayload` { full_name, phone, project_address, email, initial_contract_value, notes, ... }
- [type] `QuickAddResult` { customer_intake, customer, project }
- [type] `DuplicateData` { duplicate_candidates, allowed_resolutions }
- [type] `IntakeApiResponse` { data, duplicate_resolution, conversion_status, customer_created, code, message }

### `frontend/src/features/customers/utils/duplicate-matching.ts`
_Pure helpers for duplicate-candidate comparison during quick-add._

- [fn] `formatCreatedAt(value)`
- [fn] `normalized(value)`
- [fn] `matchedFields(candidate, payload)`

## Features — Vendors

### `frontend/src/features/vendors/api.ts`
_Vendors feature API configuration._

- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/vendors/components/vendors-console.tsx`

**Depends on:**
- `@/shared/hooks/use-api-list`
- `@/shared/hooks/use-pagination`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [Component] `VendorsConsole()`

### `frontend/src/features/vendors/hooks/use-vendor-filters.ts`
_Client-side vendor search filtering._

- [fn] `useVendorFilters(vendors)` — Filter and sort vendors by search text.

### `frontend/src/features/vendors/hooks/use-vendor-form.ts`
_Vendor create/edit form state, CRUD handlers, and duplicate detection._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useVendorForm({...})` — Manage vendor form state, CRUD operations, and duplicate detection.

### `frontend/src/features/vendors/index.ts`

- [re-export] `VendorsConsole` from `./components/vendors-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/vendors/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `VendorRecord` { id, name, email, phone, tax_id_last4, notes, ... }
- [type] `VendorPayload` { name, email, phone, tax_id_last4, notes }
- [type] `ApiResponse` { duplicate_candidates, error }

## Features — Cost Codes

### `frontend/src/features/cost-codes/api.ts`
_Cost-codes feature API configuration._

- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/cost-codes/components/cost-codes-console.tsx`

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/hooks/use-api-list`
- `@/shared/hooks/use-client-pagination`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [Component] `CostCodesConsole()`

### `frontend/src/features/cost-codes/hooks/use-cost-code-filters.ts`
_Client-side cost code search and visibility filtering._

- [fn] `useCostCodeFilters(costCodes)` — Filter and sort cost codes by search text and visibility.

### `frontend/src/features/cost-codes/hooks/use-cost-code-form.ts`
_Cost code create/edit form state and CRUD handlers._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useCostCodeForm({...})` — Manage cost code form state and CRUD operations.

### `frontend/src/features/cost-codes/index.ts`

- [re-export] `CostCodesConsole` from `./components/cost-codes-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/cost-codes/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ApiResponse` { data, error }

## Features — Organization

### `frontend/src/features/organization/api.ts`
_Organization feature API configuration._

- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/organization/components/business-profile-tab.tsx`

**Depends on:**
- `@/shared/session/auth-headers`

- [fn] `BusinessProfileTab({...})`

### `frontend/src/features/organization/components/document-settings-tab.tsx`

**Depends on:**
- `@/shared/session/auth-headers`

- [fn] `DocumentSettingsTab({...})`

### `frontend/src/features/organization/components/notifications-tab.tsx`

**Depends on:**
- `@/shared/pwa`
- `@/shared/styles/animations.module.css`

- [Component] `NotificationsTab({...})`

### `frontend/src/features/organization/components/organization-console.tsx`

**Depends on:**
- `@/shared/session/auth-headers`
- `@/shared/session/client-session`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`
- `@/shared/shell`

- [fn] `OrganizationConsole()`

### `frontend/src/features/organization/components/team-tab.tsx`

**Depends on:**
- `@/shared/date-format`
- `@/shared/session/auth-headers`
- `@/shared/styles/animations.module.css`

- [fn] `TeamTab({...})`

### `frontend/src/features/organization/index.ts`

- [re-export] `OrganizationConsole` from `./components/organization-console`

### `frontend/src/features/organization/types.ts`

**Depends on:**
- `@/shared/session/client-session`

- [type] `OrganizationProfile` { id, display_name, logo_url, help_email, billing_street_1, billing_street_2, ... }
- [type] `OrganizationMembershipRecord` { id, organization, user, user_email, user_full_name, role, ... }
- [type] `OrganizationRolePolicy` { effective_role, can_edit_profile, can_manage_memberships, can_invite, editable_roles, editable_statuses }
- [type] `OrganizationInviteRecord` { id, email, role, role_template, role_template_name, invited_by_email, ... }
- [type] `OrganizationProfileResponseData` { organization, current_membership, active_member_count, role_policy }
- [type] `OrganizationMembershipsResponseData` { memberships, role_policy }
- [type] `OrganizationMembershipUpdateResponseData` { membership, role_policy }
- [type] `ApiError` { code, message, fields }
- [type] `ApiResponse` { organization, role_policy, changed_fields, error }

## Features — Dashboard

### `frontend/src/features/dashboard/components/dashboard-console.tsx`

**Depends on:**
- `@/features/projects/api`
- `@/shared/money-format`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`

- [Component] `DashboardConsole()`

### `frontend/src/features/dashboard/index.ts`

- [re-export] `DashboardConsole` from `./components/dashboard-console`

## Features — Onboarding

### `frontend/src/features/onboarding/components/dismiss-guide-button.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`
- `@/shared/session/client-session`
- `@/shared/session/use-shared-session`

- [Component] `DismissGuideButton()`

### `frontend/src/features/onboarding/components/onboarding-checklist.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/onboarding/guide-arrow-overlay`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`

- [fn] `OnboardingChecklist()`

### `frontend/src/features/onboarding/index.ts`

- [re-export] `DismissGuideButton` from `./components/dismiss-guide-button`
- [re-export] `OnboardingChecklist, ORG_VISITED_KEY` from `./components/onboarding-checklist`

## Shared — Api

### `frontend/src/shared/api/base.ts`
_Shared API base URL resolution._

- [fn] `normalizeApiBaseUrl(baseUrl)`

### `frontend/src/shared/api/error.ts`
_Shared API error extraction._

- [fn] `readApiErrorMessage(payload, fallback)` — Extract a user-facing error message from an API error response.

### `frontend/src/shared/api/health.ts`
_Server-side health check against the Django backend._

- [fn] `fetchHealth()`
- [type] `HealthResult` { ok, message }

## Shared — Session

### `frontend/src/shared/session/auth-headers.ts`
_Build Authorization and org-scoping headers for API requests._

- [fn] `buildAuthHeaders(token, options)` — Construct a complete set of request headers for an authenticated API

### `frontend/src/shared/session/client-session.ts`
_Client-side session persistence layer._

- [fn] `loadClientSession()`
- [fn] `saveClientSession(session)`
- [fn] `clearClientSession()`
- [fn] `startImpersonation(impersonationSession)`
- [fn] `exitImpersonation()`
- [fn] `isImpersonating()`
- [type] `SessionOrganization` { id, displayName, onboardingCompleted }
- [type] `ImpersonationInfo` { active, realEmail }
- [type] `ClientSession` { token, email, role, organization, capabilities, isSuperuser, ... }

### `frontend/src/shared/session/components/home-auth-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/api/health`
- `@/shared/styles/animations.module.css`

- [fn] `HomeAuthConsole({...})` — Login form console. Authenticates credentials against the Django auth endpoint,

### `frontend/src/shared/session/components/home-register-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/api/health`
- `@/shared/styles/animations.module.css`

- [fn] `HomeRegisterConsole({...})` — Registration console supporting three flows: standard signup (Flow A),

### `frontend/src/shared/session/components/reset-password-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/styles/animations.module.css`

- [Component] `ResetPasswordConsole({...})` — Password reset flow. Two modes:

### `frontend/src/shared/session/components/verify-email-console.tsx`

**Depends on:**
- `@/shared/api/base`

- [Component] `VerifyEmailConsole({...})` — Handles the email verification callback. POSTs the token from the verification

### `frontend/src/shared/session/public-routes.ts`
_Route classification helpers for the auth gate._

- [fn] `isPublicDocumentRoute(pathname)`
- [fn] `isPublicAuthRoute(pathname)`

### `frontend/src/shared/session/rbac.ts`

- [fn] `hasAnyRole(role, allowedRoles)`
- [fn] `canDo(capabilities, resource, action)`

### `frontend/src/shared/session/session-authorization.tsx`
_Session authorization provider and hook._

**Depends on:**
- `@/shared/api/base`

- [fn] `SessionAuthorizationProvider({...})` — Top-level provider that verifies the session token on mount and
- [fn] `useSessionAuthorization()`

### `frontend/src/shared/session/use-shared-session.ts`
_Reactive hook that subscribes to the session in localStorage._

- [fn] `useSharedSessionAuth()` — Hook that reactively reads the session from localStorage and returns

## Shared — Shell

### `frontend/src/shared/shell/app-toolbar/app-toolbar.tsx`
_Top-level application toolbar rendered at the very top of every page._

**Depends on:**
- `@/shared/session/client-session`
- `@/shared/session/public-routes`
- `@/shared/session/use-shared-session`
- `@/shared/styles/light-theme.module.css`

- [Component] `AppToolbar()` — Render the persistent toolbar at the top of the viewport.

### `frontend/src/shared/shell/app-toolbar/index.ts`

- [re-export] `AppToolbar` from `./app-toolbar`

### `frontend/src/shared/shell/auth-gate.tsx`
_Client-side authentication gate that wraps the entire app tree._

**Depends on:**
- `@/shared/session/public-routes`
- `@/shared/session/session-authorization`

- [Component] `AuthGate({...})` — Prevent unauthenticated access to protected routes.

### `frontend/src/shared/shell/impersonation-banner/impersonation-banner.tsx`
_Persistent banner shown when a superuser is impersonating another user._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`
- `@/shared/session/client-session`
- `@/shared/session/session-authorization`

- [Component] `ImpersonationBanner()`

### `frontend/src/shared/shell/index.ts`

- [re-export] `AuthGate` from `./auth-gate`
- [re-export] `AppToolbar` from `./app-toolbar`
- [re-export] `ImpersonationBanner` from `./impersonation-banner/impersonation-banner`
- [re-export] `MobileBottomNav` from `./mobile-bottom-nav`
- [re-export] `PrintableProvider, usePrintable` from `./printable-context`
- [re-export] `WorkflowShell` from `./workflow-shell`
- [re-export] `WorkflowNavbar` from `./workflow-navbar`
- [re-export] `WorkflowBreadcrumbs` from `./workflow-breadcrumbs`
- [re-export] `PageShell, PageCard` from `./page-shell`
- [re-export] `isRouteActive, workflowRoutes, businessMenuRoutes` from `./nav-routes`
- [re-export] `isNumericRouteId, resolveProjectQueryTitle, resolveProjectParamTitle, ` from `./route-metadata`
- [re-export] `parsePublicTokenFromRef, composePublicDocumentMetadataTitle, resolvePublicQuoteMetadataTitle, resolvePublicInvoiceMetadataTitle, resolvePublicChangeOrderMetadataTitle, ` from `./public-route-metadata`

### `frontend/src/shared/shell/mobile-bottom-nav/index.ts`

- [re-export] `MobileBottomNav` from `./mobile-bottom-nav`

### `frontend/src/shared/shell/mobile-bottom-nav/mobile-bottom-nav.tsx`

**Depends on:**
- `@/shared/session/client-session`
- `@/shared/session/public-routes`
- `@/shared/session/use-shared-session`

- [Component] `MobileBottomNav()`

### `frontend/src/shared/shell/nav-routes.ts`
_Canonical route definitions for the workflow navbar and business menu._

- [fn] `isRouteActive(pathname, route)` — Determine whether a route should be highlighted as "active" for
- [type] `NavRoute` { href, label, shortLabel, exact, startsWith, section } — Canonical route definitions for the workflow navbar and business menu.

### `frontend/src/shared/shell/onboarding-banner/index.ts`

- [re-export] `OnboardingBanner` from `./onboarding-banner`

### `frontend/src/shared/shell/onboarding-banner/onboarding-banner.tsx`

**Depends on:**
- `@/shared/session/use-shared-session`

- [Component] `OnboardingBanner()`

### `frontend/src/shared/shell/page-shell.tsx`
_Shared layout primitives for route pages._

- [Component] `PageShell({...})` — Outer page wrapper providing the `div.page > main.main` structure.
- [Component] `PageCard({...})` — Content card section within a `PageShell`.

### `frontend/src/shared/shell/printable-context.tsx`

- [Component] `PrintableProvider({...})`
- [fn] `usePrintable()`

### `frontend/src/shared/shell/public-route-metadata.ts`
_Server-side metadata resolvers for public (tokenized) document routes._

**Depends on:**
- `@/shared/api/base`

- [fn] `parsePublicTokenFromRef(publicRef)` — Parse the share token from the `slug--token` style public reference.
- [fn] `composePublicDocumentMetadataTitle(resolvedTitle, fallbackLabel)` — Compose a `<title>` string for a public document page.
- [fn] `resolvePublicQuoteMetadataTitle(publicToken)` — Resolve a human-readable title for a public quote page.
- [fn] `resolvePublicInvoiceMetadataTitle(publicToken)` — Resolve a human-readable title for a public invoice page.
- [fn] `resolvePublicChangeOrderMetadataTitle(publicToken)` — Resolve a human-readable title for a public change order page.

### `frontend/src/shared/shell/route-metadata.ts`
_Shared route-shim metadata helpers._

- [fn] `isNumericRouteId(value)` — Returns `true` only for digit-only ids used in route params/query values.
- [fn] `resolveProjectQueryTitle(baseTitle, projectQuery)` — Build a route title from optional `?project=<id>` query input.
- [fn] `resolveProjectParamTitle(projectId, scopedSuffix, fallbackTitle)` — Build a route title from a required project route param with fallback safety.

### `frontend/src/shared/shell/workflow-breadcrumbs/index.ts`

- [re-export] `WorkflowBreadcrumbs` from `./workflow-breadcrumbs`

### `frontend/src/shared/shell/workflow-breadcrumbs/workflow-breadcrumbs.tsx`
_Breadcrumb trail rendered below the workflow navbar._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`
- `@/shared/session/use-shared-session`

- [fn] `WorkflowBreadcrumbs()` — Render a breadcrumb trail reflecting the current route hierarchy.

### `frontend/src/shared/shell/workflow-navbar/index.ts`

- [re-export] `WorkflowNavbar` from `./workflow-navbar`

### `frontend/src/shared/shell/workflow-navbar/workflow-navbar.tsx`
_Horizontal workflow navbar showing the numbered workflow steps._

- [Component] `WorkflowNavbar()` — Render the primary workflow step navbar.

### `frontend/src/shared/shell/workflow-shell.tsx`
_Workflow shell region rendered below the app toolbar._

**Depends on:**
- `@/shared/session/public-routes`
- `@/shared/session/session-authorization`

- [Component] `WorkflowShell()` — Render the workflow navigation region based on session state.

## Shared — Hooks

### `frontend/src/shared/hooks/use-api-list.ts`
_Generic hook for fetching and managing a list of items from the API._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `useApiList(config)`

### `frontend/src/shared/hooks/use-backdrop-dismiss.ts`

- [fn] `useBackdropDismiss(onDismiss)` — Encapsulates the two-phase backdrop-dismiss pattern for modal overlays.

### `frontend/src/shared/hooks/use-client-pagination.ts`

- [fn] `useClientPagination(items, pageSize = 20)` — Client-side pagination for an already-loaded list.

### `frontend/src/shared/hooks/use-combobox.ts`

- [fn] `useCombobox(options)` — Generic combobox state and interaction hook.
- [type] `UseComboboxOptions`
- [type] `UseComboboxReturn`

### `frontend/src/shared/hooks/use-creator-flash.ts`

**Depends on:**
- `@/shared/document-creator/creator-foundation.module.css`

- [fn] `useCreatorFlash()` — Encapsulates the creator sheet flash animation pattern.
- [type] `UseCreatorFlashReturn`

### `frontend/src/shared/hooks/use-line-items.ts`

- [fn] `useLineItems(options)` — Generic line item CRUD hook.
- [type] `UseLineItemsOptions`
- [type] `UseLineItemsReturn`

### `frontend/src/shared/hooks/use-media-query.ts`

- [fn] `useMediaQuery(query)`

### `frontend/src/shared/hooks/use-pagination.ts`
_Shared hook for client-side list pagination._

- [fn] `usePagination(items, pageSize)`

### `frontend/src/shared/hooks/use-policy-contract.ts`
_Shared hook for fetching and normalizing backend policy contracts._

- [fn] `usePolicyContract(config)`
- [type] `PolicyContractBase` { statuses, status_labels, allowed_status_transitions, default_create_status, terminal_statuses }
- [type] `NormalizedPolicy` { statuses, statusLabels, allowedTransitions, defaultCreateStatus }
- [type] `UsePolicyContractConfig` { fetchContract, fallbackStatuses, fallbackLabels, fallbackTransitions, baseUrl, authToken, ... }

### `frontend/src/shared/hooks/use-print-context.ts`
_Shared hook for print-context management in public document previews._

- [fn] `usePrintContext()`

### `frontend/src/shared/hooks/use-status-filters.ts`
_Shared hook for status filter state management._

- [fn] `useStatusFilters(config)`
- [type] `UseStatusFiltersConfig` { allStatuses, defaultFilters, preserveOrder }
- [type] `UseStatusFiltersReturn` { filters, setFilters, toggleFilter, showAll, resetFilters, countByStatus }

### `frontend/src/shared/hooks/use-status-message.ts`
_Shared hook for the status-message + tone pattern used across console components._

- [fn] `useStatusMessage(initialMessage = "")`

## Shared — Document Creator

### `frontend/src/shared/document-creator/document-creator.tsx`
_Generic document creator component._

- [Component] `DocumentCreator({...})` — Render a slot-driven document creator form.

### `frontend/src/shared/document-creator/index.ts`

- [re-export] `DocumentCreator` from `./document-creator`
- [re-export] `resolveOrganizationBranding` from `./organization-branding`
- [re-export] `toAddressLines` from `../utils/address`

### `frontend/src/shared/document-creator/mobile-line-card.tsx`
_Mobile line-item card: renders a single line item as a stacked card_

- [Component] `MobileLineItemCard({...})`
- [type] `MobileLineField` { label, key, span, align, render }

### `frontend/src/shared/document-creator/organization-branding.ts`
_Organization branding resolution for the internal document composer._

- [fn] `resolveOrganizationBranding(defaults)` — Resolve raw organization branding defaults into a normalized shape.
- [type] `ResolvedOrganizationBranding` { senderName, senderDisplayName, senderAddress, senderAddressLines, logoUrl, helpEmail }

### `frontend/src/shared/document-creator/types.ts`

- [type] `CreatorStatusPolicy` { statuses, statusLabels, defaultCreateStatus, defaultStatusFilters, allowedTransitions, terminalStatuses }
- [type] `CreatorStatusEvent` { id, fromStatus, toStatus, note, actorEmail, occurredAt, ... }
- [type] `CreatorLineDraft` { localId, description, quantity, unit, unitPrice, costCodeId, ... }
- [type] `CreatorTotals` { subtotal, taxPercent, taxAmount, total, metadata }
- [type] `CreatorMetaField` { key, label, value, readonly, tone }
- [type] `CreatorAction` { id, label, disabled, tone, onClick }
- [type] `OrganizationBrandingDefaults` { display_name, logo_url, billing_address, help_email }
- [type] `CreatorSectionConfig` { slot, title, visible }
- [type] `CreatorRenderContext` { kind, document }
- [type] `DocumentCreatorAdapter` { kind, statusPolicy, getDocumentId, getDocumentTitle, getDocumentStatus, getMetaFields, ... }
- [type] `DocumentCreatorProps` { adapter, document, formState, readOnly, className, sectionClassName, ... }

## Shared — Document Viewer

### `frontend/src/shared/document-viewer/public-document-context.ts`
_Context resolution for public (token-authenticated) document viewers._

- [fn] `resolvePublicSender(organizationContext, documentSender)` — Resolve organization context into a display-ready sender shape.
- [fn] `resolvePublicRecipient(projectContext)` — Resolve project context into a display-ready recipient shape.
- [fn] `resolveDefaultTerms(organizationContext, documentType)` — Look up the default terms text for a given document type.
- [type] `PublicViewerSender` { companyName, senderName, senderAddress, senderAddressLines, logoUrl, helpEmail }
- [type] `PublicViewerRecipient` { name, address, addressLines, email, phone }

### `frontend/src/shared/document-viewer/public-document-frame.tsx`
_Structural frame for public-facing document pages (invoices, quotes, change orders)._

- [Component] `publicDocumentViewerClassNames(overrides)` — Build a complete `PublicDocumentViewerClassNames` map by merging the
- [Component] `PublicDocumentFrame({...})` — Render the standard document card frame used by all public viewer pages.

### `frontend/src/shared/document-viewer/public-document-viewer-shell.tsx`
_Layout shell for public document viewer pages._

- [Component] `PublicDocumentViewerShell({...})` — Render the outer shell of a public document viewer page.

### `frontend/src/shared/document-viewer/read-only-line-table.tsx`
_ReadOnlyLineTable — polished read-only line-items table for reference data._

- [Component] `ReadOnlyLineTable({...})`

### `frontend/src/shared/document-viewer/signing-ceremony.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/styles/animations.module.css`

- [fn] `SigningCeremony({...})`
- [type] `DecisionOption` { label, value, variant }
- [type] `CeremonyPayload` { session_token, signer_name, consent_accepted, note }

## Shared — Types

### `frontend/src/shared/types/domain.ts`
_Shared domain types used across multiple feature modules._

- [type] `OrganizationPublicContext` { display_name, logo_url, billing_address, help_email, invoice_terms_and_conditions, quote_terms_and_conditions, ... }
- [type] `CostCode` { id, code, name, is_active }
- [type] `UserData` { token, email }

## Shared — Onboarding

### `frontend/src/shared/onboarding/guide-arrow-overlay.tsx`

- [fn] `GuideArrowOverlay()`

## Shared — Project List Viewer

### `frontend/src/shared/project-list-viewer/index.ts`

- [re-export] `ProjectListViewer` from `./project-list-viewer`
- [re-export] `collapseToggleButtonStyles` from `./collapse-toggle-button.module.css`

### `frontend/src/shared/project-list-viewer/project-list-viewer.tsx`
_Project list panel with search, status filters, and card grid._

- [Component] `ProjectListViewer({...})` — Render a project list with search, status filters, and card grid.
- [type] `ProjectListEntry` { id, name, customer_display_name, status }

## Shared — Utilities

### `frontend/src/shared/date-format.ts`
_Date formatting utilities for consistent human-readable date display._

- [fn] `formatDateDisplay(dateValue, fallback = "TBD")` — Format a date-only ISO string (e.g. "2024-06-15") for display.
- [fn] `formatDateTimeDisplay(dateValue, fallback = "--")` — Format a full ISO datetime string (e.g. "2024-06-15T14:30:00Z") for display,
- [fn] `formatDateInputFromIso(dateValue)` — Convert an ISO datetime string to a `YYYY-MM-DD` value suitable for
- [fn] `todayDateInput()`
- [fn] `futureDateInput(daysFromNow = 30)`
- [fn] `addDaysToDateInput(baseDateInput, daysToAdd)` — Add (or subtract) days from a YYYY-MM-DD base date, returning YYYY-MM-DD.

### `frontend/src/shared/money-format.ts`
_Shared money-formatting utilities._

- [fn] `parseAmount(value)`
- [fn] `formatDecimal(value)`
- [fn] `formatCurrency(value)`

### `frontend/src/shared/phone-format.ts`
_Format a phone number string for display._

- [fn] `formatPhone(value)` — Format a phone number string for display.

## Shared — Components

### `frontend/src/shared/components/pagination-controls.tsx`

- [Component] `PaginationControls({...})` — Minimal Prev/Next pagination controls with item count.

## Shared — Pwa

### `frontend/src/shared/pwa/index.ts`

- [re-export] `ServiceWorkerRegistration` from `./service-worker-registration`
- [re-export] `usePushSubscription` from `./use-push-subscription`

### `frontend/src/shared/pwa/service-worker-registration.tsx`

- [fn] `ServiceWorkerRegistration()`

### `frontend/src/shared/pwa/use-push-subscription.ts`

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `usePushSubscription(authToken)`

## Shared — Utils

### `frontend/src/shared/utils/address.ts`
_Split an address string into individual trimmed display lines,_

- [fn] `toAddressLines(value)` — Split an address string into individual trimmed display lines,

### `frontend/src/shared/utils/class-names.ts`

- [fn] `joinClassNames(...parts)`
