export type UserData = { token?: string; email?: string };

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

export type CostCode = { id: number; code: string; name: string; is_active: boolean };

export type EstimateRecord = {
  id: number;
  version: number;
  status: string;
  title: string;
  subtotal: string;
  grand_total: string;
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
  meta?: { cloned_from?: number };
};
