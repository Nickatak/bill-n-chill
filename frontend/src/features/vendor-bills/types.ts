import type { UserData } from "@/shared/types/domain";
export type { UserData } from "@/shared/types/domain";

export type ProjectRecord = {
  id: number;
  name: string;
  customer_display_name: string;
  status?: string;
};

export type VendorRecord = {
  id: number;
  name: string;
  email: string;
  is_active: boolean;
};

export type VendorBillStatus = string;
export type VendorBillPaymentStatus = "unpaid" | "partial" | "paid";

export type VendorBillAllocationRecord = {
  id: number;
  payment: number;
  applied_amount: string;
  payment_date: string;
  payment_method: string;
  payment_status: string;
  payment_reference: string;
  created_at: string;
};

export type VendorBillRecord = {
  id: number;
  project: number;
  project_name: string;
  vendor: number;
  vendor_name: string;
  bill_number: string;
  status: VendorBillStatus;
  payment_status: VendorBillPaymentStatus;
  received_date: string | null;
  issue_date: string | null;
  due_date: string | null;
  subtotal: string;
  tax_amount: string;
  shipping_amount: string;
  total: string;
  balance_due: string;
  allocations: VendorBillAllocationRecord[];
  line_items: VendorBillLineRecord[];
  notes: string;
  created_at: string;
  updated_at: string;
};

export type VendorBillLineRecord = {
  id: number;
  cost_code: number | null;
  cost_code_code: string;
  cost_code_name: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
};

export type VendorBillLineInput = {
  description: string;
  quantity: string;
  unit_price: string;
};

export type VendorBillPayload = {
  projectId: number;
  vendor: number;
  bill_number: string;
  received_date?: string | null;
  issue_date: string;
  due_date: string;
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
