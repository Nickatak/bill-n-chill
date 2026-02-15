export type UserData = {
  token?: string;
  email?: string;
  id?: number;
};

export type LeadContactCandidate = {
  id: number;
  full_name: string;
  phone: string;
  project_address: string;
  email: string;
  notes: string;
  source: string;
  created_at: string;
};

export type LeadPayload = {
  full_name: string;
  phone: string;
  project_address: string;
  email: string;
  notes: string;
  source: string;
};

export type LeadConvertResult = {
  lead_contact?: LeadContactCandidate;
  customer?: { id: number; display_name: string };
  project?: { id: number; name: string; status: string };
};

export type DuplicateData = {
  duplicate_candidates?: LeadContactCandidate[];
  allowed_resolutions?: string[];
};

export type ApiResponse = {
  data?: UserData | LeadContactCandidate | DuplicateData | LeadConvertResult;
  meta?: {
    duplicate_resolution?: string;
    conversion_status?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
};
