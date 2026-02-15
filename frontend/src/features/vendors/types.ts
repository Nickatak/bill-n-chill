export type UserData = {
  token?: string;
  email?: string;
};

export type VendorRecord = {
  id: number;
  name: string;
  email: string;
  phone: string;
  tax_id_last4: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type VendorPayload = {
  name: string;
  email: string;
  phone: string;
  tax_id_last4: string;
  notes: string;
  is_active: boolean;
};

export type ApiResponse = {
  data?:
    | UserData
    | VendorRecord[]
    | VendorRecord
    | {
        duplicate_candidates?: VendorRecord[];
        allowed_resolutions?: string[];
      };
  meta?: { duplicate_override_used?: boolean };
  error?: { code?: string; message?: string };
};
