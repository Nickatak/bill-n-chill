import type { UserData } from "@/shared/types/domain";
export type { UserData } from "@/shared/types/domain";

export type ProjectRecord = {
  id: number;
  customer: number;
  customer_display_name: string;
  name: string;
  status: string;
  contract_value_original: string;
  contract_value_current: string;
  accepted_contract_total: string;
};

export type ProjectFinancialSummary = {
  project_id: number;
  contract_value_original: string;
  contract_value_current: string;
  accepted_contract_total: string;
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
    | PortfolioSnapshot
    | ChangeImpactSummary
    | AttentionFeed
    | ProjectTimeline
    | AccountingSyncEventRecord[]
    | AccountingSyncEventRecord;
  meta?: {
    retry_status?: string;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};

export type PortfolioProjectSnapshot = {
  project_id: number;
  project_name: string;
  project_status: string;
  ar_outstanding: string;
  ap_outstanding: string;
  approved_change_orders_total: string;
};

export type PortfolioSnapshot = {
  generated_at: string;
  date_filter: {
    date_from: string;
    date_to: string;
  };
  active_projects_count: number;
  ar_total_outstanding: string;
  ap_total_outstanding: string;
  overdue_invoice_count: number;
  overdue_vendor_bill_count: number;
  projects: PortfolioProjectSnapshot[];
};

export type ChangeImpactProject = {
  project_id: number;
  project_name: string;
  approved_change_order_count: number;
  approved_change_order_total: string;
};

export type ChangeImpactSummary = {
  generated_at: string;
  date_filter: {
    date_from: string;
    date_to: string;
  };
  approved_change_order_count: number;
  approved_change_order_total: string;
  projects: ChangeImpactProject[];
};

export type AttentionFeedItem = {
  kind: string;
  severity: "high" | "medium" | "low";
  label: string;
  detail: string;
  project_id: number;
  project_name: string;
  ui_route: string;
  detail_endpoint: string;
  due_date: string | null;
};

export type AttentionFeed = {
  generated_at: string;
  due_soon_window_days: number;
  item_count: number;
  items: AttentionFeedItem[];
};

export type ProjectTimelineItem = {
  timeline_id: string;
  category: "financial" | "workflow";
  event_type: string;
  occurred_at: string;
  label: string;
  detail: string;
  object_type: string;
  object_id: number;
  ui_route: string;
  detail_endpoint: string;
};

export type ProjectTimeline = {
  project_id: number;
  project_name: string;
  category: "all" | "financial" | "workflow";
  item_count: number;
  items: ProjectTimelineItem[];
};
