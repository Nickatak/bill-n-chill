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

// --- Quick-add intake types ---

export type UserData = {
  token?: string;
  email?: string;
  id?: number;
};

export type CustomerIntakeRecord = {
  id: number;
  full_name: string;
  phone: string;
  project_address: string;
  email: string;
  initial_contract_value?: string | null;
  notes: string;
  source: string;
  created_at: string;
};

export type DuplicateCustomerCandidate = {
  id: number;
  display_name: string;
  phone: string;
  billing_address: string;
  email: string;
  is_archived?: boolean;
  created_at: string;
};

export type CustomerIntakePayload = {
  full_name: string;
  phone: string;
  project_address: string;
  email: string;
  initial_contract_value?: string | null;
  notes: string;
  source: string;
};

export type QuickAddResult = {
  customer_intake: CustomerIntakeRecord;
  customer?: { id: number; display_name: string };
  project?: { id: number; name: string; status: string } | null;
};

export type DuplicateData = {
  duplicate_candidates?: DuplicateCustomerCandidate[];
  allowed_resolutions?: string[];
};

export type IntakeApiResponse = {
  data?: UserData | CustomerIntakeRecord | DuplicateData | QuickAddResult;
  meta?: {
    duplicate_resolution?: string;
    conversion_status?: string;
    customer_created?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
  };
};
