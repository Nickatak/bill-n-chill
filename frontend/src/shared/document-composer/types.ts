import type { FormEvent, ReactNode } from "react";

export type DocumentKind = "estimate" | "change_order" | "invoice";

export type ComposerStatusPolicy = {
  statuses: string[];
  statusLabels: Record<string, string>;
  defaultCreateStatus: string;
  defaultStatusFilters: string[];
  allowedTransitions: Record<string, string[]>;
  terminalStatuses: string[];
};

export type ComposerStatusEvent = {
  id: number | string;
  fromStatus: string | null;
  toStatus: string;
  note?: string;
  actorEmail?: string | null;
  occurredAt: string;
  canonicalAction?: string;
};

export type ComposerLineDraft = {
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

export type ComposerTotals = {
  subtotal: number;
  taxPercent?: number;
  taxAmount?: number;
  total: number;
  metadata?: Record<string, number | string>;
};

export type ComposerMetaField = {
  key: string;
  label: string;
  value: string;
  readonly?: boolean;
  tone?: "default" | "muted" | "positive" | "warning" | "danger";
};

export type ComposerAction = {
  id: string;
  label: string;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  onClick: () => void | Promise<void>;
};

export type ComposerSectionSlot =
  | "header"
  | "meta"
  | "line_items"
  | "totals"
  | "status"
  | "status_events"
  | "context"
  | "footer";

export type ComposerSectionConfig = {
  slot: ComposerSectionSlot;
  title?: string;
  visible?: boolean;
};

export type ComposerRenderContext<TDocument> = {
  kind: DocumentKind;
  document: TDocument | null;
};

export type ComposerRenderers<TDocument> = Partial<
  Record<ComposerSectionSlot, (context: ComposerRenderContext<TDocument>) => ReactNode>
>;

export type DocumentComposerAdapter<TDocument, TLine extends ComposerLineDraft, TFormState> = {
  kind: DocumentKind;
  statusPolicy: ComposerStatusPolicy;
  getDocumentId: (document: TDocument | null) => string | null;
  getDocumentTitle: (document: TDocument | null) => string;
  getDocumentStatus: (document: TDocument | null) => string;
  getMetaFields: (document: TDocument | null) => ComposerMetaField[];
  getStatusEvents: (document: TDocument | null) => ComposerStatusEvent[];
  getDraftLines: (form: TFormState) => TLine[];
  getTotals: (form: TFormState) => ComposerTotals;
  toCreatePayload: (form: TFormState) => Record<string, unknown>;
  toUpdatePayload: (form: TFormState, current: TDocument) => Record<string, unknown>;
};

export type DocumentComposerProps<TDocument, TLine extends ComposerLineDraft, TFormState> = {
  adapter: DocumentComposerAdapter<TDocument, TLine, TFormState>;
  document: TDocument | null;
  formState: TFormState;
  readOnly?: boolean;
  className?: string;
  sectionClassName?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  sections?: ComposerSectionConfig[];
  actions?: ComposerAction[];
  renderers?: ComposerRenderers<TDocument>;
};
