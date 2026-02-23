export type ContactRecord = {
  id: number;
  full_name: string;
  phone: string;
  project_address: string;
  email: string;
  notes: string;
  source: string;
  is_archived?: boolean;
  has_project?: boolean;
  converted_customer?: number | null;
  converted_project?: number | null;
  converted_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export type ApiResponse = {
  data?: ContactRecord | ContactRecord[];
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};
