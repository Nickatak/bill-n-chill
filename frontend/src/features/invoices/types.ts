import type { OrganizationBrandingDefaults } from "@/shared/document-composer";

export type UserData = { token?: string; email?: string };

export type ProjectRecord = {
  id: number;
  name: string;
  customer_display_name: string;
  status: string;
  start_date_planned?: string | null;
  end_date_planned?: string | null;
};

export type CostCode = { id: number; code: string; name: string; is_active: boolean };

export type InvoiceRecord = {
  id: number;
  project: number;
  customer: number;
  customer_display_name: string;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  sender_name: string;
  sender_email: string;
  sender_address: string;
  sender_logo_url: string;
  terms_text: string;
  footer_text: string;
  notes_text: string;
  subtotal: string;
  tax_percent: string;
  tax_total: string;
  total: string;
  balance_due: string;
  line_items?: Array<{
    id: number;
    line_type: string;
    budget_line: number | null;
    budget_line_description?: string;
    budget_line_cost_code?: string;
    cost_code: number | null;
    scope_item: number | null;
    adjustment_reason: string;
    internal_note: string;
    description: string;
    quantity: string;
    unit: string;
    unit_price: string;
    line_total: string;
  }>;
};

export type InvoiceStatusEventRecord = {
  id: number;
  invoice: number;
  from_status: string | null;
  to_status: string;
  note: string;
  changed_by: number;
  changed_by_email: string;
  changed_at: string;
};

export type OrganizationInvoiceDefaults = OrganizationBrandingDefaults & {
  id: number;
  invoice_default_due_days: number;
  invoice_default_terms: string;
  invoice_default_footer: string;
  invoice_default_notes: string;
};

export type InvoicePolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  default_create_status: string;
  default_status_filters: string[];
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
  scope_guard_rules?: {
    billable_statuses: string[];
    scope_override_event_required_for_out_of_scope_billable: boolean;
  };
};

export type InvoiceLineInput = {
  localId: number;
  lineType: "scope" | "adjustment";
  budgetLineId: string;
  adjustmentReason: string;
  internalNote: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | CostCode[]
    | InvoiceRecord
    | InvoiceRecord[]
    | InvoiceStatusEventRecord[]
    | InvoicePolicyContract
    | {
        organization?: OrganizationInvoiceDefaults;
      };
  error?: { code?: string; message?: string };
};
