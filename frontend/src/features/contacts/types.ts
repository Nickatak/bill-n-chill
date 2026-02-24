export type CustomerRow = {
  id: number;
  display_name: string;
  phone: string;
  email: string;
  billing_address: string;
  is_archived: boolean;
  project_count?: number;
  active_project_count?: number;
  has_project?: boolean;
  has_active_or_on_hold_project?: boolean;
  created_at: string;
  updated_at?: string;
};

export type ApiResponse = {
  data?: CustomerRow | CustomerRow[];
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};
