export type UserData = { token?: string; email?: string };

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

export type EstimateRecord = { id: number; version: number; status: string; title: string };

export type BudgetLineRecord = {
  id: number;
  budget: number;
  cost_code: number;
  cost_code_code: string;
  cost_code_name: string;
  description: string;
  budget_amount: string;
  planned_amount: string;
  actual_spend: string;
  remaining_amount: string;
  committed_amount: string;
  actual_amount: string;
  created_at: string;
  updated_at: string;
};

export type BudgetRecord = {
  id: number;
  project: number;
  status: string;
  source_estimate: number;
  source_estimate_version: number;
  baseline_snapshot_json: Record<string, unknown>;
  approved_change_order_total: string;
  base_working_total: string;
  current_working_total: string;
  line_items: BudgetLineRecord[];
  created_at: string;
  updated_at: string;
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord
    | ProjectRecord[]
    | EstimateRecord[]
    | BudgetRecord[]
    | BudgetRecord
    | BudgetLineRecord;
  meta?: { conversion_status?: string };
  error?: { code?: string; message?: string };
};
