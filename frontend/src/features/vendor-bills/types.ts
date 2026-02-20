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
  vendor_type: "trade" | "retail";
  is_canonical: boolean;
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
  status: "planned" | "received" | "approved" | "scheduled" | "paid" | "void";
  issue_date: string;
  due_date: string;
  scheduled_for: string | null;
  total: string;
  balance_due: string;
  allocations?: VendorBillAllocationRecord[];
  notes: string;
  created_at: string;
  updated_at: string;
};

export type VendorBillAllocationRecord = {
  id: number;
  vendor_bill: number;
  budget_line: number;
  budget_line_cost_code: string;
  budget_line_description: string;
  amount: string;
  note: string;
  created_at: string;
};

export type VendorBillAllocationInput = {
  budget_line: number;
  amount: string;
  note: string;
};

export type VendorBillPayload = {
  projectId: number;
  vendor: number;
  bill_number: string;
  status?: "planned" | "received" | "approved" | "scheduled" | "paid" | "void";
  issue_date: string;
  due_date: string;
  scheduled_for?: string | null;
  total: string;
  notes: string;
  allocations?: VendorBillAllocationInput[];
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
