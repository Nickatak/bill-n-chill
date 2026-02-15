export type UserData = { token?: string; email?: string };

export type ProjectRecord = { id: number; name: string; customer_display_name: string };

export type CostCode = { id: number; code: string; name: string; is_active: boolean };

export type InvoiceRecord = {
  id: number;
  project: number;
  customer: number;
  customer_display_name: string;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  subtotal: string;
  tax_percent: string;
  tax_total: string;
  total: string;
  balance_due: string;
};

export type InvoiceLineInput = {
  localId: number;
  costCodeId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
};

export type ApiResponse = {
  data?: UserData | ProjectRecord[] | CostCode[] | InvoiceRecord | InvoiceRecord[];
  error?: { code?: string; message?: string };
};
