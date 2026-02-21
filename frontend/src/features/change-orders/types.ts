export type UserData = { token?: string; email?: string };

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

export type BudgetLineRecord = {
  id: number;
  cost_code: number;
  cost_code_code: string;
  description: string;
  budget_amount: string;
};

export type ChangeOrderLineRecord = {
  id: number;
  change_order: number;
  budget_line: number;
  budget_line_cost_code: string;
  budget_line_description: string;
  description: string;
  amount_delta: string;
  days_delta: number;
  created_at: string;
  updated_at: string;
};

export type ChangeOrderRecord = {
  id: number;
  project: number;
  number: number;
  revision_number: number;
  title: string;
  status: string;
  amount_delta: string;
  days_delta: number;
  reason: string;
  origin_estimate: number | null;
  origin_estimate_version: number | null;
  supersedes_change_order: number | null;
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
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | ChangeOrderRecord[]
    | ChangeOrderRecord
    | Array<{ id: number; status: string; line_items: BudgetLineRecord[] }>;
  error?: { code?: string; message?: string };
};
