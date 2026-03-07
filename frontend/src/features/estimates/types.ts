export type UserData = { token?: string; email?: string };

export type ProjectRecord = {
  id: number;
  name: string;
  status: string;
  customer_display_name: string;
  customer_billing_address?: string;
  customer_email?: string;
  customer_phone?: string;
};

export type OrganizationPublicContext = {
  display_name: string;
  logo_url: string;
  billing_address: string;
  help_email: string;
  invoice_terms_and_conditions: string;
  estimate_terms_and_conditions: string;
  change_order_terms_and_conditions: string;
};

export type CostCode = { id: number; code: string; name: string; is_active: boolean };

export type EstimateRecord = {
  id: number;
  project: number;
  version: number;
  status: string;
  title: string;
  valid_through: string | null;
  terms_text: string;
  subtotal: string;
  tax_percent: string;
  grand_total: string;
  public_ref?: string;
  financial_baseline_status?: "none" | "active" | "superseded";
  is_active_financial_baseline?: boolean;
  created_at: string;
  updated_at: string;
  line_items?: EstimateLineItemRecord[];
  project_context?: ProjectRecord;
  organization_context?: OrganizationPublicContext;
  ceremony_consent_text?: string;
  ceremony_consent_text_version?: string;
};

export type EstimateLineItemRecord = {
  id: number;
  cost_code: number;
  cost_code_code?: string;
  cost_code_name?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  markup_percent: string;
};

export type EstimateStatusEventRecord = {
  id: number;
  from_status: string | null;
  to_status: string;
  note: string;
  action_type?: "create" | "transition" | "resend" | "notate" | "unchanged";
  changed_by_email: string;
  changed_by_display?: string | null;
  changed_by_customer_id?: number | null;
  changed_at: string;
};

export type EstimateRelatedChangeOrderRecord = {
  id: number;
  number: number;
  revision_number: number;
  title: string;
  status: string;
  origin_estimate: number | null;
  is_latest_revision: boolean;
};

export type EstimateLineInput = {
  localId: number;
  costCodeId: string;
  description: string;
  quantity: string;
  unit: string;
  unitCost: string;
  markupPercent: string;
};

export type EstimatePolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  default_create_status: string;
  default_status_filters: string[];
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
  quick_action_by_status: Record<string, "change_order" | "revision">;
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | CostCode[]
    | EstimateRecord
    | EstimateRecord[]
    | EstimatePolicyContract
    | EstimateStatusEventRecord[]
    | EstimateRelatedChangeOrderRecord[];
  meta?: {
    cloned_from?: number;
    duplicated_from?: number;
    conversion_status?: string;
    budget_conversion_status?: string;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
    meta?: {
      active_financial_estimate_id?: number | null;
      latest_estimate_id?: number | null;
      latest_version?: number | null;
      latest_status?: string | null;
      family_size?: number | null;
    };
  };
};
