import type { OrganizationBrandingDefaults } from "@/shared/document-creator";

import type { UserData, OrganizationPublicContext, CostCode } from "@/shared/types/domain";
export type { UserData, OrganizationPublicContext, CostCode } from "@/shared/types/domain";

export type ProjectRecord = {
  id: number;
  name: string;
  customer?: number;
  customer_display_name: string;
  customer_email?: string;
  status: string;
};

export type InvoiceRecord = {
  id: number;
  project: number;
  customer: number;
  customer_display_name: string;
  invoice_number: string;
  public_ref?: string;
  related_quote?: number | null;
  billing_period?: number | null;
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
  payment_schedule?: {
    quote_total: string;
    periods: Array<{
      id: number;
      description: string;
      percent: string;
      due_date: string | null;
      order: number;
    }>;
  } | null;
  line_items?: Array<{
    id: number;
    cost_code: number | null;
    description: string;
    quantity: string;
    unit: string;
    unit_price: string;
    line_total: string;
  }>;
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
};

export type InvoiceStatusEventRecord = {
  id: number;
  invoice: number;
  from_status: string | null;
  to_status: string;
  note: string;
  action_type?: "create" | "transition" | "resend" | "notate" | "unchanged";
  changed_by: number;
  changed_by_email: string;
  changed_by_display?: string | null;
  changed_by_customer_id?: number | null;
  changed_at: string;
};

export type OrganizationInvoiceDefaults = OrganizationBrandingDefaults & {
  id: number;
  default_invoice_due_delta: number;
  invoice_terms_and_conditions: string;
};

export type InvoicePolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  default_create_status: string;
  default_status_filters: string[];
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
};

export type InvoiceLineInput = {
  localId: number;
  costCode: string;
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
  email_sent?: boolean;
  error?: { code?: string; message?: string };
};
