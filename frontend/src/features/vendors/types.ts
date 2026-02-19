export type UserData = {
  token?: string;
  email?: string;
};

export type VendorRecord = {
  id: number;
  name: string;
  vendor_type: "trade" | "retail";
  is_canonical: boolean;
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
  vendor_type: "trade" | "retail";
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
