import type { FormEvent, ReactNode } from "react";

export type DocumentKind = "quote" | "change_order" | "invoice";

export type CreatorStatusPolicy = {
  statuses: string[];
  statusLabels: Record<string, string>;
  defaultCreateStatus: string;
  defaultStatusFilters: string[];
  allowedTransitions: Record<string, string[]>;
  terminalStatuses: string[];
};

export type CreatorStatusEvent = {
  id: number | string;
  fromStatus: string | null;
  toStatus: string;
  note?: string;
  actorEmail?: string | null;
  occurredAt: string;
  canonicalAction?: string;
};

export type CreatorLineDraft = {
  localId: number;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  costCodeId?: string;
  markupPercent?: string;
  amountDelta?: string;
  daysDelta?: string;
};

export type CreatorTotals = {
  subtotal: number;
  taxPercent?: number;
  taxAmount?: number;
  total: number;
  metadata?: Record<string, number | string>;
};

export type CreatorMetaField = {
  key: string;
  label: string;
  value: string;
  readonly?: boolean;
  tone?: "default" | "muted" | "positive" | "warning" | "danger";
};

export type CreatorAction = {
  id: string;
  label: string;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  onClick: () => void | Promise<void>;
};

export type OrganizationBrandingDefaults = {
  display_name: string;
  logo_url: string;
  billing_address: string;
  help_email: string;
};

export type CreatorSectionSlot =
  | "header"
  | "meta"
  | "line_items"
  | "totals"
  | "status"
  | "status_events"
  | "context"
  | "footer";

export type CreatorSectionConfig = {
  slot: CreatorSectionSlot;
  title?: string;
  visible?: boolean;
};

export type CreatorRenderContext<TDocument> = {
  kind: DocumentKind;
  document: TDocument | null;
};

export type CreatorRenderers<TDocument> = Partial<
  Record<CreatorSectionSlot, (context: CreatorRenderContext<TDocument>) => ReactNode>
>;

export type DocumentCreatorAdapter<TDocument, TLine extends CreatorLineDraft, TFormState> = {
  kind: DocumentKind;
  statusPolicy: CreatorStatusPolicy;
  getDocumentId: (document: TDocument | null) => string | null;
  getDocumentTitle: (document: TDocument | null) => string;
  getDocumentStatus: (document: TDocument | null) => string;
  getMetaFields: (document: TDocument | null) => CreatorMetaField[];
  getStatusEvents: (document: TDocument | null) => CreatorStatusEvent[];
  getDraftLines: (form: TFormState) => TLine[];
  getTotals: (form: TFormState) => CreatorTotals;
  toCreatePayload: (form: TFormState) => Record<string, unknown>;
  toUpdatePayload: (form: TFormState, current: TDocument) => Record<string, unknown>;
};

export type DocumentCreatorProps<TDocument, TLine extends CreatorLineDraft, TFormState> = {
  adapter: DocumentCreatorAdapter<TDocument, TLine, TFormState>;
  document: TDocument | null;
  formState: TFormState;
  readOnly?: boolean;
  className?: string;
  sectionClassName?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  sections?: CreatorSectionConfig[];
  actions?: CreatorAction[];
  renderers?: CreatorRenderers<TDocument>;
};
