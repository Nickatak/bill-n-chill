export type UserData = {
  token?: string;
  email?: string;
};

export type ProjectRecord = {
  id: number;
  name: string;
  customer_display_name: string;
};

export type PaymentDirection = "inbound" | "outbound";
export type PaymentMethod = "ach" | "card" | "check" | "wire" | "cash" | "other";
export type PaymentStatus = "pending" | "settled" | "failed" | "void";
export type PaymentAllocationTargetType = "invoice" | "vendor_bill";

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

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | PaymentRecord[]
    | PaymentRecord
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
