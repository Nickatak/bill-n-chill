# Frontend Structural Index

_Auto-generated from `frontend/src/`. Do not edit manually._
_Regenerate: `python scripts/generate_ai_index.py`_

## Sections
- [App Routes](#app-routes)
- [Features — Change Orders](#features-change-orders)
- [Features — Cost Codes](#features-cost-codes)
- [Features — Customers](#features-customers)
- [Features — Dashboard](#features-dashboard)
- [Features — Estimates](#features-estimates)
- [Features — Financials Auditing](#features-financials-auditing)
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
- [Shared — Session](#shared-session)
- [Shared — Shell](#shared-shell)
- [Shared — Types](#shared-types)

## App Routes

### `frontend/src/app/admin/impersonate/page.tsx`
_Superuser impersonation page — lists all impersonatable users_

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`
- `@/shared/session/client-session`
- `@/shared/session/session-authorization`

- [default] `ImpersonatePage`

### `frontend/src/app/bills/page.tsx`

**Depends on:**
- `@/features/vendor-bills`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `BillsPage`

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
- `@/shared/session/session-authorization`
- `@/shared/shell`
- `@/shared/shell/page-shell.module.css`

- [Component] `DashboardRouteContent()`

### `frontend/src/app/dashboard/page.tsx`

- [default] `DashboardPage`

### `frontend/src/app/error.tsx`

- [default] `GlobalError`

### `frontend/src/app/estimate/[publicRef]/page.tsx`

**Depends on:**
- `@/features/estimates/components/estimate-approval-preview`
- `@/shared/shell`
- `@/shared/styles/light-theme.module.css`

- [Component] `generateMetadata({...})`
- [default] `EstimateReviewPage`

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

### `frontend/src/app/payments/page.tsx`
_Payments page — first-class workflow page for recording and managing payments._

**Depends on:**
- `@/features/payments`
- `@/shared/shell`

- [default] `PaymentsPage`

### `frontend/src/app/projects/[projectId]/audit-trail/page.tsx`

**Depends on:**
- `@/features/projects/components/project-activity-console`
- `@/shared/shell`
- `@/shared/shell/page-shell.module.css`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectAuditTrailPage`

### `frontend/src/app/projects/[projectId]/change-orders/page.tsx`

**Depends on:**
- `@/features/change-orders`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectChangeOrdersPage`

### `frontend/src/app/projects/[projectId]/estimates/page.tsx`

**Depends on:**
- `@/features/estimates`
- `@/shared/shell`
- `@/shared/shell/route-metadata`

- [Component] `generateMetadata({...})`
- [default] `ProjectEstimatesPage`

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

## Features — Estimates

### `frontend/src/features/estimates/api.ts`
_Estimates feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchEstimatePolicyContract({...})` — Fetch the estimate policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/estimates/components/cost-code-combobox.tsx`
_Accessible combobox for selecting a cost code._

- [fn] `CostCodeCombobox({...})` — Render a searchable combobox for cost code selection.

### `frontend/src/features/estimates/components/estimate-approval-preview.tsx`

**Depends on:**
- `@/shared/date-format`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-viewer/public-document-viewer-shell`
- `@/shared/document-viewer/signing-ceremony`
- `@/shared/hooks/use-print-context`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `EstimateApprovalPreview({...})`

### `frontend/src/features/estimates/components/estimate-sheet.tsx`
_Estimate document creator sheet used for both creating and editing estimates._

**Depends on:**
- `@/shared/date-format`
- `@/shared/document-creator`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/hooks/use-media-query`
- `@/shared/money-format`

- [fn] `EstimateSheet({...})` — Composable estimate sheet supporting draft creation, draft editing, and

### `frontend/src/features/estimates/components/estimates-console.tsx`

**Depends on:**
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/financial-baseline`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/hooks/use-status-filters`
- `@/shared/money-format`
- `@/shared/project-list-viewer`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`
- `@/shared/shell/printable-context`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `EstimatesConsole({...})`

### `frontend/src/features/estimates/document-adapter.ts`
_Document-creator adapter for estimates._

- [fn] `toEstimateStatusPolicy(contract)` — Convert the backend policy contract (snake_case) to the creator's
- [fn] `toEstimateStatusEvents(events)` — Convert backend status event records to the creator's status event
- [fn] `createEstimateDocumentAdapter(statusPolicy, statusEvents)` — Build a fully configured document-creator adapter for estimates.

### `frontend/src/features/estimates/helpers.ts`
_Pure helper functions for the estimates feature._

**Depends on:**
- `@/shared/api/error`

- [fn] `normalizeEstimatePolicy({...})`
- [fn] `resolveAutoSelectEstimate(rows, activeFilters, hints)` — Pick the best estimate to auto-select after a list load.
- [fn] `resolveEstimateValidationDeltaDays(defaults)`
- [fn] `emptyLine(localId, defaultCostCodeId = "")`
- [fn] `mapEstimateLineItemsToInputs(items)`
- [fn] `readEstimateApiError(payload, fallback)`
- [fn] `normalizeFamilyTitle(value)`
- [fn] `mapPublicEstimateLineItems(estimate)`
- [fn] `mapLineCostCodes(estimate)`
- [fn] `estimateStatusLabel(status)`
- [fn] `formatStatusAction(event)`
- [fn] `isNotatedStatusEvent(event)`
- [type] `NormalizedEstimatePolicy` { statuses, statusLabels, allowedTransitions, quickActionByStatus, defaultCreateStatus, defaultStatusFilters }
- [re-export] `estimateFinancialBaselineStatus, formatFinancialBaselineStatus, ` from `@/shared/financial-baseline`

### `frontend/src/features/estimates/index.ts`

- [re-export] `EstimatesConsole` from `./components/estimates-console`
- [re-export] `EstimateSheet` from `./components/estimate-sheet`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/estimates/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, name, status, customer_display_name, customer_billing_address, customer_email, ... }
- [type] `EstimateRecord` { id, project, version, status, title, valid_through, ... }
- [type] `EstimateLineItemRecord` { id, cost_code, cost_code_code, cost_code_name, description, quantity, ... }
- [type] `EstimateStatusEventRecord` { id, from_status, to_status, note, action_type, changed_by_email, ... }
- [type] `EstimateRelatedChangeOrderRecord` { id, number, revision_number, title, status, origin_estimate, ... }
- [type] `EstimateLineInput` { localId, costCodeId, description, quantity, unit, unitCost, ... }
- [type] `EstimatePolicyContract` { policy_version, status_labels, statuses, default_create_status, default_status_filters, allowed_status_transitions, ... }
- [type] `ApiResponse` { email_sent, cloned_from, duplicated_from, conversion_status, code, message, ... }

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
- `@/shared/hooks/use-print-context`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `ChangeOrderPublicPreview({...})`

### `frontend/src/features/change-orders/components/change-orders-console.tsx`

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/document-creator`
- `@/shared/document-creator/change-order-creator.module.css`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/hooks/use-client-pagination`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/money-format`
- `@/shared/project-list-viewer`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`
- `@/shared/shell/printable-context`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `ChangeOrdersConsole({...})`

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
- [fn] `coLabel(changeOrder, "family_key" | "revision_number">)`
- [fn] `publicChangeOrderHref(publicRef)`
- [fn] `readChangeOrderApiError(payload, fallback)`

### `frontend/src/features/change-orders/index.ts`

- [re-export] `ChangeOrdersConsole` from `./components/change-orders-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/change-orders/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id }
- [type] `CostCodeOption` { id, code, name, is_active }
- [type] `ChangeOrderLineRecord` { id, change_order, cost_code, cost_code_id, cost_code_code, cost_code_name, ... }
- [type] `ChangeOrderRecord` { id, project, family_key, revision_number, title, status, ... }
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
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-viewer/public-document-viewer-shell`
- `@/shared/document-viewer/signing-ceremony`
- `@/shared/hooks/use-print-context`
- `@/shared/money-format`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `InvoicePublicPreview({...})`

### `frontend/src/features/invoices/components/invoices-console.tsx`

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/document-creator`
- `@/shared/document-creator/creator-foundation.module.css`
- `@/shared/document-creator/invoice-creator.module.css`
- `@/shared/document-creator/mobile-line-card`
- `@/shared/document-creator/mobile-line-card.module.css`
- `@/shared/hooks/use-client-pagination`
- `@/shared/hooks/use-media-query`
- `@/shared/hooks/use-policy-contract`
- `@/shared/hooks/use-status-filters`
- `@/shared/hooks/use-status-message`
- `@/shared/money-format`
- `@/shared/project-list-viewer`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`
- `@/shared/shell/printable-context`
- `@/shared/styles/decision-stamp.module.css`

- [fn] `InvoicesConsole({...})`

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
- [fn] `nextInvoiceNumberPreview(rows)`
- [fn] `invoiceStatusEventActionLabel(event, statusLabel)`
- [fn] `readInvoiceApiError(payload, fallback)`
- [fn] `projectStatusLabel(statusValue)`

### `frontend/src/features/invoices/index.ts`

- [re-export] `InvoicesConsole` from `./components/invoices-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/invoices/types.ts`

**Depends on:**
- `@/shared/document-creator`
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, name, customer_display_name, customer_email, status }
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
- `@/features/payments`
- `@/shared/api/error`
- `@/shared/date-format`
- `@/shared/hooks/use-policy-contract`
- `@/shared/hooks/use-status-filters`
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

### `frontend/src/features/vendor-bills/index.ts`

- [re-export] `VendorBillsConsole` from `./components/vendor-bills-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/vendor-bills/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, name, customer_display_name, status }
- [type] `VendorRecord` { id, name, vendor_type, is_canonical, email, is_active }
- [type] `VendorBillRecord` { id, project, project_name, vendor, vendor_name, bill_number, ... }
- [type] `VendorBillLineRecord` { id, cost_code, cost_code_code, cost_code_description, description, quantity, ... }
- [type] `VendorBillLineInput` { costCode, description, quantity, unit, unitPrice }
- [type] `VendorBillPayload` { projectId, vendor, bill_number, status, received_date, issue_date, ... }
- [type] `VendorBillPolicyContract` { policy_version, status_labels, statuses, default_create_status, create_shortcut_statuses, allowed_status_transitions, ... }
- [type] `ApiResponse` { duplicate_candidates, allowed_resolutions, meta, error }

## Features — Payments

### `frontend/src/features/payments/api.ts`
_Payments feature API layer._

**Depends on:**
- `@/shared/api/base`
- `@/shared/session/auth-headers`

- [fn] `fetchPaymentPolicyContract({...})` — Fetch the payment policy contract from the backend.
- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/payments/components/payment-recorder.tsx`

**Depends on:**
- `@/shared/date-format`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `PaymentRecorder({...})`
- [type] `PaymentRecorderProps` { projectId, direction, allocationTargets, onPaymentsChanged }

### `frontend/src/features/payments/components/payments-console.tsx`

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/date-format`
- `@/shared/hooks/use-client-pagination`
- `@/shared/hooks/use-status-message`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `PaymentsConsole()`

### `frontend/src/features/payments/index.ts`

- [re-export] `PaymentRecorder` from `./components/payment-recorder`
- [re-export] `PaymentsConsole` from `./components/payments-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/payments/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `ProjectRecord` { id, customer, name, customer_display_name, status }
- [type] `AllocationTarget` { id, label, balanceDue }
- [type] `PaymentAllocationRecord` { id, payment, target_type, target_id, invoice, vendor_bill, ... }
- [type] `CustomerRecord` { id, display_name }
- [type] `PaymentRecord` { id, organization, customer, customer_name, project, project_name, ... }
- [type] `InvoiceRecord` { id, invoice_number, status, total, balance_due }
- [type] `VendorBillRecord` { id, bill_number, status, total, balance_due }
- [type] `PaymentAllocateResult` { payment, created_allocations }
- [type] `PaymentPolicyContract` { policy_version, status_labels, statuses, directions, methods, default_create_status, ... }
- [type] `ApiResponse` { allocated_total, unapplied_amount, code, message, fields }

## Features — Projects

### `frontend/src/features/projects/api.ts`
_Projects feature API configuration._

- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

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
- [type] `ApiResponse` { retry_status, code, message, fields }
- [type] `PortfolioProjectSnapshot` { project_id, project_name, project_status, ar_outstanding, ap_outstanding, approved_change_orders_total }
- [type] `PortfolioSnapshot` { generated_at, date_from, date_to, active_projects_count, ar_total_outstanding, ap_total_outstanding, ... }
- [type] `ChangeImpactProject` { project_id, project_name, approved_change_order_count, approved_change_order_total }
- [type] `ChangeImpactSummary` { generated_at, date_from, date_to, approved_change_order_count, approved_change_order_total, projects }
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
- `@/features/projects/types`
- `@/shared/project-list-viewer`
- `@/shared/session/auth-headers`
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

### `frontend/src/features/customers/components/duplicate-resolution-panel.tsx`

- [Component] `DuplicateResolutionPanel({...})`

### `frontend/src/features/customers/components/quick-add-console.tsx`

**Depends on:**
- `@/shared/session/use-shared-session`

- [Component] `QuickAddConsole({...})`

### `frontend/src/features/customers/components/quick-add-form.tsx`

- [Component] `QuickAddForm({...})`

### `frontend/src/features/customers/hooks/quick-add-controller.types.ts`

- [type] `LeadFieldErrors` { full_name, phone, project_address, project_name }
- [type] `PendingSubmission` { payload, intent, projectName, projectStatus }
- [type] `UseQuickAddControllerArgs` { token, baseAuthMessage, onCustomerCreated }
- [type] `QuickAddControllerApi` { fullNameRef, authMessage, leadMessage, leadMessageTone, conversionMessage, conversionMessageTone, ... }

### `frontend/src/features/customers/hooks/quick-add-validation.ts`
_Client-side validation for the quick-add customer intake form._

- [fn] `validateLeadFields(payload, {...})` — Validate lead-capture fields and return a map of field-level errors.

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
- [re-export] `QuickAddConsole` from `./components/quick-add-console`

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
- `@/shared/hooks/use-pagination`
- `@/shared/hooks/use-status-message`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `VendorsConsole()`

### `frontend/src/features/vendors/index.ts`

- [re-export] `VendorsConsole` from `./components/vendors-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/vendors/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `VendorRecord` { id, name, vendor_type, is_canonical, email, phone, ... }
- [type] `VendorPayload` { name, vendor_type, email, phone, tax_id_last4, notes, ... }
- [type] `VendorCsvImportResult` { entity, mode, total_rows, created_count, updated_count, error_count, ... }
- [type] `ApiResponse` { duplicate_candidates, allowed_resolutions, meta, error }

## Features — Cost Codes

### `frontend/src/features/cost-codes/api.ts`
_Cost-codes feature API configuration._

- [re-export] `defaultApiBaseUrl, normalizeApiBaseUrl` from `@/shared/api/base`

### `frontend/src/features/cost-codes/components/cost-codes-console.tsx`

**Depends on:**
- `@/shared/components/pagination-controls`
- `@/shared/hooks/use-client-pagination`
- `@/shared/hooks/use-status-message`
- `@/shared/session/auth-headers`
- `@/shared/session/rbac`
- `@/shared/session/use-shared-session`

- [fn] `CostCodesConsole()`

### `frontend/src/features/cost-codes/index.ts`

- [re-export] `CostCodesConsole` from `./components/cost-codes-console`
- [re-export] `*` from `./api`
- [re-export] `*` from `./types`

### `frontend/src/features/cost-codes/types.ts`

**Depends on:**
- `@/shared/types/domain`

- [type] `CsvImportRowResult` { row_number, code, name, status, message }
- [type] `CsvImportResult` { entity, mode, total_rows, created_count, updated_count, error_count, ... }
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

### `frontend/src/features/onboarding/components/onboarding-checklist.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/onboarding/guide-arrow-overlay`
- `@/shared/session/auth-headers`
- `@/shared/session/client-session`
- `@/shared/session/use-shared-session`

- [fn] `OnboardingChecklist()`

### `frontend/src/features/onboarding/index.ts`

- [re-export] `OnboardingChecklist, ORG_VISITED_KEY` from `./components/onboarding-checklist`

## Features — Financials Auditing

### `frontend/src/features/financials-auditing/components/financials-auditing-console.tsx`

- [fn] `FinancialsAuditingConsole()`

### `frontend/src/features/financials-auditing/index.ts`

- [re-export] `FinancialsAuditingConsole` from `./components/financials-auditing-console`

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

- [fn] `HomeAuthConsole({...})` — Login form console. Authenticates credentials against the Django auth endpoint,

### `frontend/src/shared/session/components/home-register-console.tsx`

**Depends on:**
- `@/shared/api/base`
- `@/shared/api/health`

- [fn] `HomeRegisterConsole({...})` — Registration console supporting three flows: standard signup (Flow A),

### `frontend/src/shared/session/components/reset-password-console.tsx`

**Depends on:**
- `@/shared/api/base`

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
- [re-export] `MobileDrawer` from `./mobile-drawer`
- [re-export] `PrintableProvider, usePrintable` from `./printable-context`
- [re-export] `WorkflowShell` from `./workflow-shell`
- [re-export] `WorkflowNavbar` from `./workflow-navbar`
- [re-export] `WorkflowBreadcrumbs` from `./workflow-breadcrumbs`
- [re-export] `PageShell, PageCard` from `./page-shell`
- [re-export] `isRouteActive, workflowRoutes, businessMenuRoutes` from `./nav-routes`
- [re-export] `isNumericRouteId, resolveProjectQueryTitle, resolveProjectParamTitle, ` from `./route-metadata`
- [re-export] `parsePublicTokenFromRef, composePublicDocumentMetadataTitle, resolvePublicEstimateMetadataTitle, resolvePublicInvoiceMetadataTitle, resolvePublicChangeOrderMetadataTitle, ` from `./public-route-metadata`

### `frontend/src/shared/shell/mobile-bottom-nav/index.ts`

- [re-export] `MobileBottomNav` from `./mobile-bottom-nav`

### `frontend/src/shared/shell/mobile-bottom-nav/mobile-bottom-nav.tsx`

**Depends on:**
- `@/shared/session/client-session`
- `@/shared/session/public-routes`
- `@/shared/session/use-shared-session`

- [Component] `MobileBottomNav()`

### `frontend/src/shared/shell/mobile-drawer/index.ts`

- [re-export] `MobileDrawer` from `./mobile-drawer`

### `frontend/src/shared/shell/mobile-drawer/mobile-drawer.tsx`

**Depends on:**
- `@/shared/session/client-session`
- `@/shared/session/public-routes`
- `@/shared/session/use-shared-session`

- [Component] `MobileDrawer()`

### `frontend/src/shared/shell/nav-routes.ts`
_Canonical route definitions for the workflow navbar and business menu._

- [fn] `isRouteActive(pathname, route)` — Determine whether a route should be highlighted as "active" for
- [type] `NavRoute` { href, label, shortLabel, exact, startsWith, section } — Canonical route definitions for the workflow navbar and business menu.

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
- [fn] `resolvePublicEstimateMetadataTitle(publicToken)` — Resolve a human-readable title for a public estimate page.
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

### `frontend/src/shared/hooks/use-client-pagination.ts`

- [fn] `useClientPagination(items, pageSize = 20)` — Client-side pagination for an already-loaded list.

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
- [type] `UsePolicyContractConfig` { fetchContract, fallbackStatuses, fallbackLabels, fallbackTransitions, baseUrl, token, ... }

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
- [re-export] `resolveOrganizationBranding, toAddressLines, ` from `./organization-branding`

### `frontend/src/shared/document-creator/mobile-line-card.tsx`
_Mobile line-item card: renders a single line item as a stacked card_

- [Component] `MobileLineItemCard({...})`
- [type] `MobileLineField` { label, key, span, align, render }

### `frontend/src/shared/document-creator/organization-branding.ts`
_Organization branding resolution for the internal document composer._

- [fn] `toAddressLines(address)` — Split a multi-line address string into individual trimmed lines,
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

- [fn] `toAddressLines(value)` — Split an address string into individual display lines.
- [fn] `resolvePublicSender(organizationContext)` — Resolve organization context into a display-ready sender shape.
- [fn] `resolvePublicRecipient(projectContext)` — Resolve project context into a display-ready recipient shape.
- [fn] `resolveDefaultTerms(organizationContext, documentType)` — Look up the default terms text for a given document type.
- [type] `PublicViewerSender` { companyName, senderName, senderAddress, senderAddressLines, logoUrl, helpEmail }
- [type] `PublicViewerRecipient` { name, address, addressLines, email, phone }

### `frontend/src/shared/document-viewer/public-document-frame.tsx`
_Structural frame for public-facing document pages (invoices, estimates, change orders)._

- [Component] `publicDocumentViewerClassNames(overrides)` — Build a complete `PublicDocumentViewerClassNames` map by merging the
- [Component] `PublicDocumentFrame({...})` — Render the standard document card frame used by all public viewer pages.

### `frontend/src/shared/document-viewer/public-document-viewer-shell.tsx`
_Layout shell for public document viewer pages._

- [Component] `PublicDocumentViewerShell({...})` — Render the outer shell of a public document viewer page.

### `frontend/src/shared/document-viewer/signing-ceremony.tsx`

**Depends on:**
- `@/shared/api/base`

- [fn] `SigningCeremony({...})`
- [type] `DecisionOption` { label, value, variant }
- [type] `CeremonyPayload` { session_token, signer_name, consent_accepted, note }

## Shared — Types

### `frontend/src/shared/types/domain.ts`
_Shared domain types used across multiple feature modules._

- [type] `OrganizationPublicContext` { display_name, logo_url, billing_address, help_email, invoice_terms_and_conditions, estimate_terms_and_conditions, ... }
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
_Collapsible project list panel with search, status filters, and card grid._

- [Component] `ProjectListViewer({...})` — Render a collapsible project list with search, status filters, and card grid.
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

### `frontend/src/shared/financial-baseline.ts`
_Shared financial-baseline status helpers._

- [fn] `financialBaselineStatus(record)`
- [fn] `formatFinancialBaselineStatus(status)`

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
