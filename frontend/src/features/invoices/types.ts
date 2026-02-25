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
  subtotal: string;
  tax_percent: string;
  tax_total: string;
  total: string;
  balance_due: string;
  line_items?: Array<{
    id: number;
    line_type: string;
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
  costCodeId: string;
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
    | InvoicePolicyContract;
  error?: { code?: string; message?: string };
};
