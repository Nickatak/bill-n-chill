import type { UserData, OrganizationPublicContext } from "@/shared/types/domain";
export type { UserData, OrganizationPublicContext } from "@/shared/types/domain";
import type { OrganizationBrandingDefaults } from "@/shared/document-creator";

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

/** A single line item from an approved origin estimate, used in contract breakdown displays. */
export type OriginEstimateLineItem = {
  id: number;
  cost_code_code?: string;
  cost_code_name?: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  markup_percent: string;
  line_total: string;
};

/** An approved estimate linked as the origin/baseline for change orders. */
export type OriginEstimateRecord = {
  id: number;
  title: string;
  version: number;
  approved_at: string | null;
  approved_by_email: string | null;
  grand_total: string;
  line_items: OriginEstimateLineItem[];
};

/** A project-level audit event record from the status-events timeline API. */
export type AuditEventRecord = {
  id: number;
  event_type: string;
  object_type: string;
  object_id: number;
  from_status: string;
  to_status: string;
  note: string;
  metadata_json?: Record<string, unknown> | null;
  created_by: number;
  created_by_email: string | null;
  created_by_display?: string | null;
  created_by_customer_id?: number | null;
  created_at: string;
};

/** Organization branding defaults extended with change-order-specific T&C. */
export type OrganizationDocumentDefaults = OrganizationBrandingDefaults & {
  change_order_terms_and_conditions: string;
};

export type CostCodeOption = {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
};

export type ChangeOrderLineRecord = {
  id: number;
  change_order: number;
  cost_code: number;
  cost_code_id: number | null;
  cost_code_code: string | null;
  cost_code_name: string | null;
  description: string;
  /** Retained for API compat — no longer surfaced in the UI. */
  adjustment_reason: string;
  amount_delta: string;
  days_delta: number;
  order?: number;
  created_at: string;
  updated_at: string;
};

export type ChangeOrderSectionRecord = {
  id: number;
  name: string;
  order: number;
  subtotal: string;
};

export type ChangeOrderRecord = {
  id: number;
  project: number;
  family_key: string;
  title: string;
  status: string;
  public_ref?: string;
  amount_delta: string;
  days_delta: number;
  reason: string;
  terms_text: string;
  sender_name: string;
  sender_address: string;
  sender_logo_url: string;
  origin_estimate: number | null;
  origin_estimate_version?: number | null;
  requested_by: number;
  requested_by_email: string;
  approved_by: number | null;
  approved_by_email: string | null;
  approved_at: string | null;
  line_items: ChangeOrderLineRecord[];
  sections?: ChangeOrderSectionRecord[];
  line_total_delta: string;
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
    grand_total?: string;
    line_items?: Array<{
      id: number;
      cost_code_code?: string;
      cost_code_name?: string;
      description: string;
      quantity: string;
      unit: string;
      unit_price: string;
      markup_percent: string;
      line_total: string;
    }>;
  };
  approved_sibling_change_orders?: Array<{
    id: number;
    title: string;
    family_key: string;
    status: string;
    amount_delta: string;
    line_total_delta: string;
    line_items: ChangeOrderLineRecord[];
  }>;
};

export type ChangeOrderPolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  default_create_status: string;
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
  editing_rules?: {
    edit_requires_draft_status: boolean;
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
  costCodeId: string;
  description: string;
  /** Retained for API compat — no longer surfaced in the UI. */
  adjustmentReason: string;
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
    | Array<{ id: number; status: string }>;
  email_sent?: boolean;
  error?: { code?: string; message?: string; fields?: Record<string, string[]>; rule?: string };
};
