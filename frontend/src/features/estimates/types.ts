export type UserData = { token?: string; email?: string };

export type ProjectRecord = {
  id: number;
  name: string;
  status: string;
  customer_display_name: string;
  customer_billing_address?: string;
};

export type CostCode = { id: number; code: string; name: string; is_active: boolean };

export type EstimateRecord = {
  id: number;
  project: number;
  version: number;
  status: string;
  title: string;
  subtotal: string;
  tax_percent: string;
  grand_total: string;
  public_ref?: string;
  created_at: string;
  updated_at: string;
  line_items?: EstimateLineItemRecord[];
  project_context?: ProjectRecord;
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
  changed_by_email: string;
  changed_at: string;
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

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | CostCode[]
    | EstimateRecord
    | EstimateRecord[]
    | EstimateStatusEventRecord[];
  meta?: { cloned_from?: number; duplicated_from?: number };
  error?: { code?: string; message?: string; fields?: Record<string, string[]> };
};
