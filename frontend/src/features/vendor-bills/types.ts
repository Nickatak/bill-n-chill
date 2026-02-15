export type UserData = {
  token?: string;
  email?: string;
};

export type ProjectRecord = {
  id: number;
  name: string;
  customer_display_name: string;
};

export type VendorRecord = {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
};

export type VendorBillRecord = {
  id: number;
  project: number;
  project_name: string;
  vendor: number;
  vendor_name: string;
  bill_number: string;
  status: "draft" | "received" | "approved" | "scheduled" | "paid" | "void";
  issue_date: string;
  due_date: string;
  total: string;
  balance_due: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type VendorBillPayload = {
  projectId: number;
  vendor: number;
  bill_number: string;
  issue_date: string;
  due_date: string;
  total: string;
  notes: string;
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | VendorRecord[]
    | VendorBillRecord[]
    | VendorBillRecord
    | {
        duplicate_candidates?: VendorBillRecord[];
        allowed_resolutions?: string[];
      };
  meta?: { duplicate_override_used?: boolean };
  error?: { code?: string; message?: string };
};
