import type { UserData } from "@/shared/types/domain";
export type { UserData } from "@/shared/types/domain";

export type VendorRecord = {
  id: number;
  name: string;
  email: string;
  phone: string;
  tax_id_last4: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type VendorPayload = {
  name: string;
  email: string;
  phone: string;
  tax_id_last4: string;
  notes: string;
};

export type ApiResponse = {
  data?:
    | UserData
    | VendorRecord[]
    | VendorRecord
    | {
        duplicate_candidates?: VendorRecord[];
      };
  error?: { code?: string; message?: string };
};
