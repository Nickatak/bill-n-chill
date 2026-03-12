import type { UserData } from "@/shared/types/domain";
export type { UserData } from "@/shared/types/domain";

export type ProjectRecord = {
  id: number;
  name: string;
  customer_display_name: string;
  status: string;
};

export type PaymentDirection = string; // "inbound" | "outbound"
export type PaymentMethod = string; // "ach" | "card" | "check" | "wire" | "cash" | "other"
export type PaymentStatus = string; // "pending" | "settled" | "void" ("failed" removed — sync deferred)
export type PaymentAllocationTargetType = "invoice" | "vendor_bill";

/** Generic allocation target shape accepted by PaymentRecorder. */
export type AllocationTarget = {
  id: number;
  label: string;
  balanceDue: string;
};

export type PaymentAllocationRecord = {
  id: number;
  payment: number;
  target_type: PaymentAllocationTargetType;
  target_id: number;
  invoice: number | null;
  vendor_bill: number | null;
  applied_amount: string;
  created_at: string;
};

export type PaymentRecord = {
  id: number;
  project: number;
  project_name: string;
  direction: PaymentDirection;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: string;
  payment_date: string;
  reference_number: string;
  notes: string;
  allocated_total: string;
  unapplied_amount: string;
  allocations: PaymentAllocationRecord[];
  created_at: string;
  updated_at: string;
};

export type InvoiceRecord = {
  id: number;
  invoice_number: string;
  status: string;
  total: string;
  balance_due: string;
};

export type VendorBillRecord = {
  id: number;
  bill_number: string;
  status: string;
  total: string;
  balance_due: string;
};

export type PaymentAllocateResult = {
  payment: PaymentRecord;
  created_allocations: PaymentAllocationRecord[];
};

export type PaymentPolicyContract = {
  policy_version: string;
  status_labels: Record<string, string>;
  statuses: string[];
  directions: string[];
  methods: string[];
  default_create_status: string;
  default_create_direction: string;
  default_create_method: string;
  allowed_status_transitions: Record<string, string[]>;
  terminal_statuses: string[];
  allocation_target_by_direction: Record<string, PaymentAllocationTargetType>;
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | PaymentRecord[]
    | PaymentRecord
    | PaymentPolicyContract
    | InvoiceRecord[]
    | VendorBillRecord[]
    | PaymentAllocateResult;
  meta?: {
    allocated_total?: string;
    unapplied_amount?: string;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};
