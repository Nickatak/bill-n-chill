export type UserData = { token?: string; email?: string };

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

export type OrganizationPublicContext = {
  display_name: string;
  logo_url: string;
  billing_address: string;
  help_email: string;
  invoice_terms_and_conditions: string;
  estimate_terms_and_conditions: string;
  change_order_terms_and_conditions: string;
};

export type BudgetLineRecord = {
  id: number;
  scope_item?: number | null;
  cost_code: number;
  cost_code_code: string;
  description: string;
  budget_amount: string;
  approved_change_order_delta?: string;
  current_working_amount?: string;
};

export type ChangeOrderLineRecord = {
  id: number;
  change_order: number;
  budget_line: number;
  budget_line_cost_code: string;
  budget_line_description: string;
  description: string;
  line_type?: "scope" | "adjustment";
  adjustment_reason?: string;
  amount_delta: string;
  days_delta: number;
  created_at: string;
  updated_at: string;
};

export type ChangeOrderRecord = {
  id: number;
  project: number;
  family_key: string;
  revision_number: number;
  title: string;
  status: string;
  public_ref?: string;
  amount_delta: string;
  days_delta: number;
  reason: string;
  terms_text: string;
  origin_estimate: number | null;
  origin_estimate_version?: number | null;
  previous_change_order: number | null;
  requested_by: number;
  requested_by_email: string;
  approved_by: number | null;
  approved_by_email: string | null;
  approved_at: string | null;
  line_items: ChangeOrderLineRecord[];
  line_total_delta: string;
  is_latest_revision: boolean;
  created_at: string;
  updated_at: string;
  project_context?: {
    id: number;
    name: string;
    status: string;
    customer_display_name: string;
    customer_billing_address?: string | null;
    customer_email?: string | null;
    customer_phone?: string | null;
  };
  organization_context?: OrganizationPublicContext;
  ceremony_consent_text?: string;
  ceremony_consent_text_version?: string;
  origin_estimate_context?: {
    id: number;
    title: string;
    version: number;
    public_ref?: string;
  };
};

export type ChangeOrderPolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  default_create_status: string;
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
  revision_rules?: {
    edit_latest_revision_only: boolean;
    clone_requires_latest_revision: boolean;
    revision_gt_one_requires_previous_change_order: boolean;
    previous_change_order_must_match_project_family_and_prior_revision: boolean;
  };
  origin_estimate_rules?: {
    required_on_create: boolean;
    must_be_approved: boolean;
    must_match_change_order_project: boolean;
    immutable_once_set: boolean;
  };
  approval_metadata_rules?: {
    approved_requires_actor_and_timestamp: boolean;
    non_approved_statuses_must_clear_actor_and_timestamp: boolean;
  };
  error_rules?: Record<string, string>;
};

export type ChangeOrderLineInput = {
  localId: number;
  lineType: "scope" | "adjustment";
  adjustmentReason: string;
  budgetLineId: string;
  description: string;
  amountDelta: string;
  daysDelta: string;
};

export type LineValidationIssue = {
  localId: number;
  rowNumber: number;
  message: string;
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | ChangeOrderRecord[]
    | ChangeOrderRecord
    | ChangeOrderPolicyContract
    | Array<{ id: number; status: string; line_items: BudgetLineRecord[] }>;
  error?: { code?: string; message?: string; fields?: Record<string, string[]>; rule?: string };
};
