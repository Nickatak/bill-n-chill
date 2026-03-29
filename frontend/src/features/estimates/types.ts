import type { UserData, OrganizationPublicContext, CostCode } from "@/shared/types/domain";
export type { UserData, OrganizationPublicContext, CostCode } from "@/shared/types/domain";

export type ProjectRecord = {
  id: number;
  name: string;
  status: string;
  customer?: number;
  customer_display_name: string;
  customer_billing_address?: string;
  customer_email?: string;
  customer_phone?: string;
};

export type EstimateRecord = {
  id: number;
  project: number;
  version: number;
  status: string;
  title: string;
  valid_through: string | null;
  terms_text: string;
  notes_text: string;
  sender_name: string;
  sender_address: string;
  sender_logo_url: string;
  subtotal: string;
  tax_percent: string;
  grand_total: string;
  public_ref?: string;
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
  unit_price: string;
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
  email_sent?: boolean;
  meta?: {
    conversion_status?: string;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
    meta?: {
      latest_estimate_id?: number | null;
      latest_version?: number | null;
      latest_status?: string | null;
      family_size?: number | null;
    };
  };
};
