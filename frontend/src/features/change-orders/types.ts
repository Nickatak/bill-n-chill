export type UserData = { token?: string; email?: string };

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

export type ChangeOrderRecord = {
  id: number;
  project: number;
  number: number;
  title: string;
  status: string;
  amount_delta: string;
  days_delta: number;
  reason: string;
  requested_by: number;
  requested_by_email: string;
  approved_by: number | null;
  approved_by_email: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiResponse = {
  data?: UserData | ProjectRecord[] | ChangeOrderRecord[] | ChangeOrderRecord;
  error?: { code?: string; message?: string };
};
