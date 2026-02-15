export type UserData = {
  token?: string;
  email?: string;
};

export type ProjectRecord = {
  id: number;
  customer: number;
  customer_display_name: string;
  name: string;
  status: string;
  contract_value_original: string;
  contract_value_current: string;
  start_date_planned: string | null;
  end_date_planned: string | null;
};

export type ProjectFinancialSummary = {
  project_id: number;
  contract_value_original: string;
  contract_value_current: string;
  approved_change_orders_total: string;
  invoiced_to_date: string;
  paid_to_date: string;
  ar_outstanding: string;
  ap_total: string;
  ap_paid: string;
  ap_outstanding: string;
  inbound_unapplied_credit: string;
  outbound_unapplied_credit: string;
  traceability: {
    approved_change_orders: ProjectTraceabilityBucket;
    ar_invoices: ProjectTraceabilityBucket;
    ar_payments: ProjectTraceabilityBucket;
    ap_vendor_bills: ProjectTraceabilityBucket;
    ap_payments: ProjectTraceabilityBucket;
  };
};

export type AccountingSyncEventRecord = {
  id: number;
  project: number;
  project_name: string;
  provider: "quickbooks_online";
  object_type: string;
  object_id: number | null;
  direction: "push" | "pull";
  status: "queued" | "success" | "failed";
  external_id: string;
  error_message: string;
  retry_count: number;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FinancialAuditEventRecord = {
  id: number;
  project: number;
  event_type:
    | "estimate_status_changed"
    | "budget_converted"
    | "change_order_updated"
    | "invoice_updated"
    | "vendor_bill_updated"
    | "payment_updated"
    | "payment_allocated"
    | "invoice_scope_override";
  object_type: string;
  object_id: number;
  from_status: string;
  to_status: string;
  amount: string | null;
  note: string;
  metadata_json: Record<string, unknown>;
  created_by: number;
  created_at: string;
};

export type ProjectTraceabilityRecord = {
  id: number;
  label: string;
  status: string;
  amount: string;
  detail_endpoint: string;
};

export type ProjectTraceabilityBucket = {
  ui_route: string;
  list_endpoint: string;
  total: string;
  records: ProjectTraceabilityRecord[];
};

export type ApiResponse = {
  data?:
    | UserData
    | ProjectRecord[]
    | ProjectRecord
    | ProjectFinancialSummary
    | AccountingSyncEventRecord[]
    | AccountingSyncEventRecord
    | FinancialAuditEventRecord[];
  meta?: {
    retry_status?: string;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};
