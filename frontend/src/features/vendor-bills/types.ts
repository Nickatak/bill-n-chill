export type UserData = {
  token?: string;
  email?: string;
};

export type ProjectRecord = {
  id: number;
  name: string;
  customer_display_name: string;
  status?: string;
};

export type VendorRecord = {
  id: number;
  name: string;
  vendor_type: "trade" | "retail";
  is_canonical: boolean;
  email: string;
  is_active: boolean;
};

export type VendorBillStatus = string;

export type VendorBillRecord = {
  id: number;
  project: number;
  project_name: string;
  vendor: number;
  vendor_name: string;
  bill_number: string;
  status: VendorBillStatus;
  received_date: string | null;
  issue_date: string;
  due_date: string;
  scheduled_for: string | null;
  subtotal: string;
  tax_amount: string;
  shipping_amount: string;
  total: string;
  balance_due: string;
  line_items: VendorBillLineRecord[];
  notes: string;
  created_at: string;
  updated_at: string;
};

export type VendorBillLineRecord = {
  id: number;
  cost_code: number | null;
  cost_code_code: string;
  cost_code_description: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  line_total: string;
};

export type VendorBillLineInput = {
  costCode: number | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

export type VendorBillPayload = {
  projectId: number;
  vendor: number;
  bill_number: string;
  status?: VendorBillStatus;
  received_date?: string | null;
  issue_date: string;
  due_date: string;
  scheduled_for?: string | null;
  subtotal?: string;
  tax_amount?: string;
  shipping_amount?: string;
  total: string;
  notes: string;
  line_items?: VendorBillLineInput[];
};

export type VendorBillPolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  default_create_status: string;
  create_shortcut_statuses: string[];
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | VendorRecord[]
    | VendorBillRecord[]
    | VendorBillRecord
    | VendorBillPolicyContract
    | {
        duplicate_candidates?: VendorBillRecord[];
        allowed_resolutions?: string[];
      };
  meta?: { duplicate_override_used?: boolean };
  error?: { code?: string; message?: string };
};
