"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import {
  AccountingSyncEventRecord,
  AttentionFeed,
  ApiResponse,
  ChangeImpactSummary,
  FinancialAuditEventRecord,
  PortfolioSnapshot,
  ProjectFinancialSummary,
  ProjectRecord,
} from "@/features/projects/types";
import { formatDateTimeDisplay } from "@/shared/date-format";
import styles from "./financials-auditing-console.module.css";

type AuditGraphLane = {
  key: string;
  label: string;
  objectType: string | null;
  objectId: number | null;
};

type AuditGraphGroup = {
  key: string;
  label: string;
  eventIds: number[];
  startX: number;
  endX: number;
  midX: number;
};

function toLabelCase(value: string): string {
  return value.replaceAll("_", " ");
}

function toAuditGroupKey(createdAt: string): string {
  return createdAt.slice(0, 10);
}

function toAuditGroupLabel(createdAt: string): string {
  const asDate = new Date(createdAt);
  if (Number.isNaN(asDate.getTime())) {
    return createdAt;
  }
  return asDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toAuditObjectKey(objectType: string, objectId: number): string {
  return `${objectType}:${objectId}`;
}

function toAuditLaneKey(objectType: string, objectId: number): string {
  return `branch-${toAuditObjectKey(objectType, objectId)}`;
}

function escapeCsvCell(value: unknown): string {
  const asString = String(value ?? "");
  return `"${asString.replaceAll('"', '""')}"`;
}

function toAuditTrailCsv(rows: FinancialAuditEventRecord[]): string {
  const header = [
    "id",
    "project",
    "event_type",
    "object_type",
    "object_id",
    "from_status",
    "to_status",
    "amount",
    "note",
    "created_by",
    "created_by_email",
    "created_at",
    "metadata_json",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.project,
      row.event_type,
      row.object_type,
      row.object_id,
      row.from_status ?? "",
      row.to_status ?? "",
      row.amount ?? "",
      row.note ?? "",
      row.created_by,
      row.created_by_email ?? "",
      row.created_at,
      JSON.stringify(row.metadata_json ?? {}),
    ]
      .map(escapeCsvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n");
}

function triggerDownload(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

function toAuditRoute(projectId: number, objectType: string, objectId: number): string {
  if (objectType === "estimate") {
    return `/projects/${projectId}/estimates?estimate=${objectId}`;
  }
  if (objectType === "change_order") {
    return `/projects/${projectId}/change-orders`;
  }
  if (objectType === "invoice") {
    return `/invoices?project=${projectId}`;
  }
  if (objectType === "budget") {
    return `/projects/${projectId}/budgets/analytics`;
  }
  return `/financials-auditing?project=${projectId}`;
}

function auditObjectBadgeClass(objectType: string): string {
  if (objectType === "invoice") {
    return styles.auditBadgeInvoice;
  }
  if (objectType === "vendor_bill") {
    return styles.auditBadgeVendorBill;
  }
  if (objectType === "payment") {
    return styles.auditBadgePayment;
  }
  if (objectType === "change_order") {
    return styles.auditBadgeChangeOrder;
  }
  if (objectType === "estimate") {
    return styles.auditBadgeEstimate;
  }
  if (objectType === "budget") {
    return styles.auditBadgeBudget;
  }
  return styles.auditBadgeNeutral;
}

function normalizeStatusToken(status: string | null | undefined): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function auditStatusToneClass(status: string | null | undefined): string {
  const token = normalizeStatusToken(status);
  if (!token) {
    return styles.auditStatusToneNeutral;
  }
  if (token === "draft" || token === "planned" || token === "created") {
    return styles.auditStatusToneDraft;
  }
  if (
    token === "sent" ||
    token === "pending" ||
    token === "pending_approval" ||
    token === "submitted" ||
    token === "open" ||
    token === "scheduled" ||
    token === "received" ||
    token === "in_review" ||
    token === "in_progress"
  ) {
    return styles.auditStatusToneSent;
  }
  if (token === "partial" || token === "partially_paid" || token === "partial_payment") {
    return styles.auditStatusTonePartial;
  }
  if (token === "overdue" || token === "past_due") {
    return styles.auditStatusToneOverdue;
  }
  if (
    token === "approved" ||
    token === "accepted" ||
    token === "paid" ||
    token === "completed" ||
    token === "complete" ||
    token === "converted" ||
    token === "posted" ||
    token === "reconciled" ||
    token === "allocated"
  ) {
    return styles.auditStatusToneApproved;
  }
  if (token === "rejected" || token === "failed" || token === "declined" || token === "denied") {
    return styles.auditStatusToneRejected;
  }
  if (
    token === "void" ||
    token === "voided" ||
    token === "cancelled" ||
    token === "canceled" ||
    token === "archived"
  ) {
    return styles.auditStatusToneVoid;
  }
  return styles.auditStatusToneNeutral;
}

function postActionStatus(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined,
): string | null {
  const toValue = String(toStatus ?? "").trim();
  if (toValue) {
    return toValue;
  }
  const fromValue = String(fromStatus ?? "").trim();
  return fromValue || null;
}

export function FinancialsAuditingConsole() {
  const { token, authMessage } = useSharedSessionAuth();
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project");
  const [statusMessage, setStatusMessage] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [summary, setSummary] = useState<ProjectFinancialSummary | null>(null);
  const [auditEvents, setAuditEvents] = useState<FinancialAuditEventRecord[]>([]);
  const [syncEvents, setSyncEvents] = useState<AccountingSyncEventRecord[]>([]);
  const [syncProvider, setSyncProvider] = useState<"quickbooks_online">("quickbooks_online");
  const [syncObjectType, setSyncObjectType] = useState("invoice");
  const [syncObjectId, setSyncObjectId] = useState("");
  const [syncDirection, setSyncDirection] = useState<"push" | "pull">("push");
  const [syncStatus, setSyncStatus] = useState<"queued" | "success" | "failed">("queued");
  const [syncErrorMessage, setSyncErrorMessage] = useState("");
  const [retryTargetId, setRetryTargetId] = useState("");
  const [reportDateFrom, setReportDateFrom] = useState("");
  const [reportDateTo, setReportDateTo] = useState("");
  const [portfolioSnapshot, setPortfolioSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [changeImpactSummary, setChangeImpactSummary] = useState<ChangeImpactSummary | null>(null);
  const [attentionFeed, setAttentionFeed] = useState<AttentionFeed | null>(null);
  const [auditObjectFilters, setAuditObjectFilters] = useState<string[]>([]);
  const [auditObjectCatalog, setAuditObjectCatalog] = useState<string[]>([]);
  const [auditEventFilter, setAuditEventFilter] = useState<string>("all");
  const [selectedAuditEventId, setSelectedAuditEventId] = useState<number | null>(null);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const hasSelectedProject = Boolean(selectedProjectId);

  const selectedProjectNumericId = Number(selectedProjectId);

  const auditObjectOptions = useMemo(() => {
    const dynamic = [...new Set(auditEvents.map((item) => item.object_type))];
    const merged = [...new Set([...auditObjectCatalog, ...dynamic])];
    return merged.sort();
  }, [auditEvents, auditObjectCatalog]);

  const auditEventOptions = useMemo(() => {
    return [...new Set(auditEvents.map((item) => item.event_type))].sort();
  }, [auditEvents]);

  const visibleAuditEvents = useMemo(() => {
    const rows = auditEvents.filter((item) => {
      const objectMatch =
        auditObjectFilters.length === 0 || auditObjectFilters.includes(item.object_type);
      const eventMatch = auditEventFilter === "all" || item.event_type === auditEventFilter;
      return objectMatch && eventMatch;
    });

    rows.sort((a, b) => {
      const left = new Date(a.created_at).getTime();
      const right = new Date(b.created_at).getTime();
      if (left === right) {
        return a.id - b.id;
      }
      return left - right;
    });

    return rows;
  }, [auditEventFilter, auditEvents, auditObjectFilters]);

  const auditGraphLanes = useMemo(() => {
    const firstSeenByObject = new Map<
      string,
      {
        seenAt: number;
        objectType: string;
        objectId: number;
      }
    >();
    for (const item of visibleAuditEvents) {
      const objectKey = toAuditObjectKey(item.object_type, item.object_id);
      const seenAt = new Date(item.created_at).getTime();
      const existing = firstSeenByObject.get(objectKey);
      if (!existing || seenAt < existing.seenAt) {
        firstSeenByObject.set(objectKey, {
          seenAt,
          objectType: item.object_type,
          objectId: item.object_id,
        });
      }
    }
    const branchLanes: AuditGraphLane[] = [...firstSeenByObject.entries()]
      .sort((left, right) => {
        if (left[1].seenAt !== right[1].seenAt) {
          return left[1].seenAt - right[1].seenAt;
        }
        if (left[1].objectType !== right[1].objectType) {
          return left[1].objectType.localeCompare(right[1].objectType);
        }
        return left[1].objectId - right[1].objectId;
      })
      .map(([, details]) => ({
        key: toAuditLaneKey(details.objectType, details.objectId),
        label: `${toLabelCase(details.objectType)} #${details.objectId}`,
        objectType: details.objectType,
        objectId: details.objectId,
      }));

    return [
      {
        key: "project-main",
        label: selectedProjectNumericId ? `project #${selectedProjectNumericId}` : "project",
        objectType: null,
        objectId: null,
      },
      ...branchLanes,
    ];
  }, [selectedProjectNumericId, visibleAuditEvents]);

  const auditGraphLayout = useMemo(() => {
    const laneGap = 84;
    const laneTop = 74;
    const leftPadding = 220;
    const rightPadding = 96;
    const bottomPadding = 42;
    const eventStep = 88;
    const groupGap = 76;

    const groupedRows: Array<{ key: string; label: string; eventIds: number[] }> = [];
    for (const item of visibleAuditEvents) {
      const key = toAuditGroupKey(item.created_at);
      const label = toAuditGroupLabel(item.created_at);
      const previous = groupedRows[groupedRows.length - 1];
      if (!previous || previous.key !== key) {
        groupedRows.push({ key, label, eventIds: [item.id] });
      } else {
        previous.eventIds.push(item.id);
      }
    }

    const eventXById = new Map<number, number>();
    const groups: AuditGraphGroup[] = [];
    let cursorX = leftPadding;
    for (const group of groupedRows) {
      const startX = cursorX;
      group.eventIds.forEach((eventId, eventIndex) => {
        eventXById.set(eventId, startX + eventIndex * eventStep);
      });
      const endX = startX + (group.eventIds.length - 1) * eventStep;
      groups.push({
        key: group.key,
        label: group.label,
        eventIds: group.eventIds,
        startX,
        endX,
        midX: (startX + endX) / 2,
      });
      cursorX = endX + groupGap;
    }

    const firstX = groups[0]?.startX ?? leftPadding;
    const lastGroup = groups[groups.length - 1];
    const lastX = lastGroup ? lastGroup.endX : firstX;
    const railStartX = firstX - 24;
    const railEndX = lastX + 24;
    const width = Math.max(920, railEndX + rightPadding);
    const height = Math.max(300, laneTop + (auditGraphLanes.length - 1) * laneGap + bottomPadding);

    const laneY = new Map<string, number>();
    auditGraphLanes.forEach((lane, index) => {
      laneY.set(lane.key, laneTop + index * laneGap);
    });

    const branchWindows = new Map<
      string,
      {
        firstX: number;
        lastX: number;
      }
    >();
    visibleAuditEvents.forEach((item) => {
      const x = eventXById.get(item.id);
      if (x === undefined) {
        return;
      }
      const objectKey = toAuditObjectKey(item.object_type, item.object_id);
      const existing = branchWindows.get(objectKey);
      if (!existing) {
        branchWindows.set(objectKey, { firstX: x, lastX: x });
        return;
      }
      branchWindows.set(objectKey, { firstX: existing.firstX, lastX: x });
    });

    return {
      width,
      height,
      laneY,
      railStartX,
      railEndX,
      branchWindows,
      eventXById,
      groups,
    };
  }, [auditGraphLanes, visibleAuditEvents]);

  const latestAuditEvent = useMemo(() => {
    if (auditEvents.length === 0) {
      return null;
    }
    return auditEvents.reduce((latest, current) =>
      new Date(current.created_at).getTime() > new Date(latest.created_at).getTime() ? current : latest,
    );
  }, [auditEvents]);

  const selectedAuditEvent = useMemo(() => {
    if (visibleAuditEvents.length === 0) {
      return null;
    }
    if (selectedAuditEventId === null) {
      return visibleAuditEvents[visibleAuditEvents.length - 1];
    }
    return visibleAuditEvents.find((item) => item.id === selectedAuditEventId) ?? null;
  }, [selectedAuditEventId, visibleAuditEvents]);

  const selectedAuditEventNextStatus = useMemo(() => {
    if (!selectedAuditEvent) {
      return null;
    }
    return postActionStatus(selectedAuditEvent.from_status, selectedAuditEvent.to_status);
  }, [selectedAuditEvent]);

  function normalizeUiRoute(route: string): string {
    if (!route.startsWith("/payments")) {
      return route;
    }
    const queryIndex = route.indexOf("?");
    if (queryIndex === -1) {
      return "/financials-auditing";
    }
    return `/financials-auditing${route.slice(queryIndex)}`;
  }

  async function loadProjects() {
    if (!token) {
      return;
    }
    setStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load projects.");
        return;
      }
      const rows = (payload.data as ProjectRecord[]) ?? [];
      setProjects(rows);
      const preferredProjectId =
        requestedProjectId && /^\d+$/.test(requestedProjectId) ? requestedProjectId : null;
      if (rows[0]) {
        const preferredProject =
          preferredProjectId ? rows.find((row) => String(row.id) === preferredProjectId) : null;
        setSelectedProjectId(String(preferredProject?.id ?? rows[0].id));
      } else {
        setSelectedProjectId("");
      }
      setStatusMessage(`Loaded ${rows.length} project(s).`);
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedProjectId, token]);

  async function loadFinancialSummary() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Loading financial summary...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/financial-summary/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load financial summary.");
        return;
      }
      setSummary(payload.data as ProjectFinancialSummary);
      setStatusMessage("Financial summary loaded.");
    } catch {
      setStatusMessage("Could not reach financial summary endpoint.");
    }
  }

  async function downloadAccountingExport() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Downloading accounting export...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-export/?export_format=csv`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      if (!response.ok) {
        setStatusMessage("Could not download accounting export.");
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `project-${projectId}-accounting-export.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setStatusMessage("Accounting export downloaded.");
    } catch {
      setStatusMessage("Could not reach accounting export endpoint.");
    }
  }

  async function fetchAuditEvents(
    projectId: number,
    objectTypes: string[] = [],
  ): Promise<FinancialAuditEventRecord[] | null> {
    const params = new URLSearchParams();
    objectTypes.forEach((objectType) => params.append("object_type", objectType));
    const path = params.toString()
      ? `${normalizedBaseUrl}/projects/${projectId}/audit-events/?${params.toString()}`
      : `${normalizedBaseUrl}/projects/${projectId}/audit-events/`;
    try {
      const response = await fetch(path, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load audit events.");
        return null;
      }
      return (payload.data as FinancialAuditEventRecord[]) ?? [];
    } catch {
      setStatusMessage("Could not reach project audit events endpoint.");
      return null;
    }
  }

  async function loadAuditEvents(
    projectIdValue?: number,
    options?: { resetFilters?: boolean; objectTypes?: string[] },
  ) {
    const projectId = projectIdValue ?? Number(selectedProjectId);
    if (!projectId) {
      setAuditEvents([]);
      setAuditObjectCatalog([]);
      setSelectedAuditEventId(null);
      if (projectIdValue === undefined) {
        setStatusMessage("Select a project first.");
      }
      return;
    }
    const objectTypes = options?.objectTypes ?? auditObjectFilters;
    const filteredByObjectType = objectTypes.length > 0;
    setStatusMessage(
      filteredByObjectType
        ? `Loading audit events for project #${projectId} (${objectTypes.map(toLabelCase).join(", ")})...`
        : `Loading audit events for project #${projectId}...`,
    );
    const rows = await fetchAuditEvents(projectId, objectTypes);
    if (!rows) {
      return;
    }
    setAuditEvents(rows);
    if (options?.resetFilters) {
      setAuditObjectFilters([]);
      setAuditEventFilter("all");
    }
    if (!filteredByObjectType) {
      setAuditObjectCatalog([...new Set(rows.map((item) => item.object_type))].sort());
    }
    setStatusMessage(
      filteredByObjectType
        ? `Loaded ${rows.length} audit event(s) for selected object filter(s).`
        : `Loaded ${rows.length} audit event(s) for project #${projectId}.`,
    );
  }

  async function downloadAuditTrail(format: "json" | "csv") {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading full audit trail for export...");
    const rows = await fetchAuditEvents(projectId);
    if (!rows) {
      return;
    }

    const orderedRows = [...rows].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

    if (format === "json") {
      const payload = JSON.stringify(
        {
          project_id: projectId,
          exported_at: new Date().toISOString(),
          item_count: orderedRows.length,
          events: orderedRows,
        },
        null,
        2,
      );
      triggerDownload(`project-${projectId}-audit-trail-${timestamp}.json`, payload, "application/json");
      setStatusMessage(`Downloaded ${orderedRows.length} audit event(s) as JSON.`);
      return;
    }

    const csvPayload = toAuditTrailCsv(orderedRows);
    triggerDownload(`project-${projectId}-audit-trail-${timestamp}.csv`, csvPayload, "text/csv");
    setStatusMessage(`Downloaded ${orderedRows.length} audit event(s) as CSV.`);
  }

  async function loadAccountingSyncEvents() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Loading accounting sync events...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-sync-events/`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load sync events.");
        return;
      }
      const rows = (payload.data as AccountingSyncEventRecord[]) ?? [];
      setSyncEvents(rows);
      const failed = rows.find((row) => row.status === "failed");
      setRetryTargetId(failed ? String(failed.id) : "");
      setStatusMessage(`Loaded ${rows.length} sync event(s).`);
    } catch {
      setStatusMessage("Could not reach accounting sync events endpoint.");
    }
  }

  async function createAccountingSyncEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    setStatusMessage("Creating accounting sync event...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/accounting-sync-events/`,
        {
          method: "POST",
          headers: buildAuthHeaders(token, { contentType: "application/json" }),
          body: JSON.stringify({
            provider: syncProvider,
            object_type: syncObjectType,
            object_id: syncObjectId ? Number(syncObjectId) : null,
            direction: syncDirection,
            status: syncStatus,
            error_message: syncErrorMessage,
          }),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not create sync event.");
        return;
      }
      const created = payload.data as AccountingSyncEventRecord;
      setSyncEvents((current) => [created, ...current]);
      if (created.status === "failed") {
        setRetryTargetId(String(created.id));
      }
      setSyncErrorMessage("");
      setStatusMessage(`Created sync event #${created.id}.`);
    } catch {
      setStatusMessage("Could not reach sync event create endpoint.");
    }
  }

  async function retryAccountingSyncEvent() {
    const syncEventId = Number(retryTargetId);
    if (!syncEventId) {
      setStatusMessage("Select a failed sync event to retry.");
      return;
    }
    setStatusMessage("Retrying sync event...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/accounting-sync-events/${syncEventId}/retry/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not retry sync event.");
        return;
      }
      const updated = payload.data as AccountingSyncEventRecord;
      setSyncEvents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setStatusMessage(`Retry result: ${payload.meta?.retry_status ?? "ok"}.`);
    } catch {
      setStatusMessage("Could not reach sync event retry endpoint.");
    }
  }

  async function loadPortfolioSnapshot() {
    setStatusMessage("Loading portfolio snapshot...");
    try {
      const params = new URLSearchParams();
      if (reportDateFrom) {
        params.set("date_from", reportDateFrom);
      }
      if (reportDateTo) {
        params.set("date_to", reportDateTo);
      }
      const response = await fetch(
        `${normalizedBaseUrl}/reports/portfolio/${params.toString() ? `?${params.toString()}` : ""}`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load portfolio snapshot.");
        return;
      }
      setPortfolioSnapshot(payload.data as PortfolioSnapshot);
      setStatusMessage("Portfolio snapshot loaded.");
    } catch {
      setStatusMessage("Could not reach portfolio snapshot endpoint.");
    }
  }

  async function loadChangeImpactSummary() {
    setStatusMessage("Loading change impact summary...");
    try {
      const params = new URLSearchParams();
      if (reportDateFrom) {
        params.set("date_from", reportDateFrom);
      }
      if (reportDateTo) {
        params.set("date_to", reportDateTo);
      }
      const response = await fetch(
        `${normalizedBaseUrl}/reports/change-impact/${params.toString() ? `?${params.toString()}` : ""}`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load change impact summary.");
        return;
      }
      setChangeImpactSummary(payload.data as ChangeImpactSummary);
      setStatusMessage("Change impact summary loaded.");
    } catch {
      setStatusMessage("Could not reach change impact summary endpoint.");
    }
  }

  async function loadAttentionFeed() {
    setStatusMessage("Loading attention feed...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/reports/attention-feed/`, {
        headers: buildAuthHeaders(token),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load attention feed.");
        return;
      }
      setAttentionFeed(payload.data as AttentionFeed);
      setStatusMessage("Attention feed loaded.");
    } catch {
      setStatusMessage("Could not reach attention feed endpoint.");
    }
  }

  useEffect(() => {
    const projectId = Number(selectedProjectId);
    if (!token || !projectId) {
      setAuditEvents([]);
      setAuditObjectCatalog([]);
      setAuditObjectFilters([]);
      setAuditEventFilter("all");
      setSelectedAuditEventId(null);
      return;
    }
    void loadAuditEvents(projectId, { resetFilters: true, objectTypes: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, token]);

  useEffect(() => {
    if (visibleAuditEvents.length === 0) {
      if (selectedAuditEventId !== null) {
        setSelectedAuditEventId(null);
      }
      return;
    }
    const hasSelected = selectedAuditEventId
      ? visibleAuditEvents.some((item) => item.id === selectedAuditEventId)
      : false;
    if (!hasSelected) {
      setSelectedAuditEventId(visibleAuditEvents[visibleAuditEvents.length - 1].id);
    }
  }, [selectedAuditEventId, visibleAuditEvents]);

  function toggleAuditObjectType(objectType: string) {
    const nextFilters = auditObjectFilters.includes(objectType)
      ? auditObjectFilters.filter((value) => value !== objectType)
      : [...auditObjectFilters, objectType];
    setAuditObjectFilters(nextFilters);
    void loadAuditEvents(undefined, { resetFilters: false, objectTypes: nextFilters });
  }

  function resetAuditFilters() {
    setAuditEventFilter("all");
    setAuditObjectFilters([]);
    void loadAuditEvents(undefined, { resetFilters: false, objectTypes: [] });
  }

  return (
    <section className={styles.console}>
      <p className={styles.authMessage}>{authMessage}</p>
      <label>
        Project
        <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              #{project.id} - {project.name} ({project.customer_display_name})
            </option>
          ))}
        </select>
      </label>

      <section>
        <h3>Financial Summary (FIN-01)</h3>
        <p>One-screen view for contract, AR, and AP totals on this project.</p>
        <button type="button" onClick={loadFinancialSummary} disabled={!hasSelectedProject}>
          Load Financial Summary
        </button>
        <button type="button" onClick={downloadAccountingExport} disabled={!hasSelectedProject}>
          Download Accounting Export (CSV)
        </button>

        {summary ? (
          <div>
            <p>
              Contract: eyeball/initial {summary.contract_value_original} | accepted total{" "}
              {summary.accepted_contract_total}
            </p>
            <p>Approved CO total: {summary.approved_change_orders_total}</p>
            <p>
              AR: invoiced {summary.invoiced_to_date} | paid {summary.paid_to_date} | outstanding{" "}
              {summary.ar_outstanding}
            </p>
            <p>
              AP: total {summary.ap_total} | paid {summary.ap_paid} | outstanding{" "}
              {summary.ap_outstanding}
            </p>
            <p>
              Unapplied credit: inbound {summary.inbound_unapplied_credit} | outbound{" "}
              {summary.outbound_unapplied_credit}
            </p>
            <h4>Traceability Links (FIN-02)</h4>
            <p>
              <Link href={normalizeUiRoute(summary.traceability.approved_change_orders.ui_route)}>
                Change orders
              </Link>{" "}
              | <Link href={normalizeUiRoute(summary.traceability.ar_invoices.ui_route)}>Invoices</Link>{" "}
              | <Link href={normalizeUiRoute(summary.traceability.ar_payments.ui_route)}>Payments (AR)</Link>{" "}
              | <Link href={normalizeUiRoute(summary.traceability.ap_vendor_bills.ui_route)}>Vendor bills</Link>{" "}
              | <Link href={normalizeUiRoute(summary.traceability.ap_payments.ui_route)}>Payments (AP)</Link>
            </p>
            <label>
              AR invoice sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ar_invoices.records.length + 1)}
                value={summary.traceability.ar_invoices.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
            <label>
              AR payment allocation sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ar_payments.records.length + 1)}
                value={summary.traceability.ar_payments.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
            <label>
              AP vendor bill sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ap_vendor_bills.records.length + 1)}
                value={summary.traceability.ap_vendor_bills.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
            <label>
              AP payment allocation sources
              <textarea
                readOnly
                rows={Math.min(6, summary.traceability.ap_payments.records.length + 1)}
                value={summary.traceability.ap_payments.records
                  .map((row) => `${row.label} (${row.status}) amount ${row.amount} | ${row.detail_endpoint}`)
                  .join("\n")}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section>
        <h3>Reporting Pack v1</h3>
        <p>Portfolio snapshot + approved change impact rollup.</p>
        <label>
          Date from
          <input
            type="date"
            value={reportDateFrom}
            onChange={(event) => setReportDateFrom(event.target.value)}
          />
        </label>
        <label>
          Date to
          <input
            type="date"
            value={reportDateTo}
            onChange={(event) => setReportDateTo(event.target.value)}
          />
        </label>
        <p>
          <button type="button" onClick={loadPortfolioSnapshot}>
            Load Portfolio Snapshot
          </button>
          <button type="button" onClick={loadChangeImpactSummary}>
            Load Change Impact Summary
          </button>
          <button type="button" onClick={loadAttentionFeed}>
            Load Attention Feed
          </button>
        </p>

        {portfolioSnapshot ? (
          <div>
            <p>
              Active projects: {portfolioSnapshot.active_projects_count} | AR outstanding{" "}
              {portfolioSnapshot.ar_total_outstanding} | AP outstanding{" "}
              {portfolioSnapshot.ap_total_outstanding}
            </p>
            <p>
              Overdue invoices: {portfolioSnapshot.overdue_invoice_count} | Overdue vendor bills:{" "}
              {portfolioSnapshot.overdue_vendor_bill_count}
            </p>
          </div>
        ) : null}

        {changeImpactSummary ? (
          <div>
            <p>
              Approved CO count: {changeImpactSummary.approved_change_order_count} | Approved CO total:{" "}
              {changeImpactSummary.approved_change_order_total}
            </p>
            <label>
              Change impact by project
              <textarea
                readOnly
                rows={Math.min(8, changeImpactSummary.projects.length + 1)}
                value={changeImpactSummary.projects
                  .map(
                    (row) =>
                      `${row.project_name} (#${row.project_id}) | count ${row.approved_change_order_count} | total ${row.approved_change_order_total}`,
                  )
                  .join("\n")}
              />
            </label>
          </div>
        ) : null}

        {attentionFeed ? (
          <div>
            <p>
              Attention items: {attentionFeed.item_count} | due soon window:{" "}
              {attentionFeed.due_soon_window_days} days
            </p>
            <ul>
              {attentionFeed.items.map((item, index) => (
                <li key={`${item.kind}-${item.detail_endpoint}-${index}`}>
                  [{item.severity.toUpperCase()}] {item.label} ({item.project_name}) | {item.detail} |{" "}
                  <Link href={normalizeUiRoute(item.ui_route)}>Open</Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section>
        <h3>Financial Audit Trail (QA-01)</h3>
        <p>Git-style chronological branch graph: main project branch with per-object child branches.</p>

        <div className={styles.auditControlsRow}>
          <label className={styles.auditFilterField}>
            Audit project
            <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
              {projects.map((project) => (
                <option key={`audit-project-${project.id}`} value={project.id}>
                  #{project.id} - {project.name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() =>
              void loadAuditEvents(undefined, {
                resetFilters: false,
                objectTypes: auditObjectFilters,
              })
            }
            disabled={!hasSelectedProject}
          >
            Refresh Trail
          </button>
          <button type="button" onClick={() => void downloadAuditTrail("json")} disabled={!hasSelectedProject}>
            Download Full Trail (JSON)
          </button>
          <button type="button" onClick={() => void downloadAuditTrail("csv")} disabled={!hasSelectedProject}>
            Download Full Trail (CSV)
          </button>
          <button
            type="button"
            onClick={resetAuditFilters}
            disabled={auditObjectFilters.length === 0 && auditEventFilter === "all"}
          >
            Reset Filters
          </button>

          <label className={styles.auditFilterField}>
            Event
            <select value={auditEventFilter} onChange={(event) => setAuditEventFilter(event.target.value)}>
              <option value="all">all events</option>
              {auditEventOptions.map((option) => (
                <option key={option} value={option}>
                  {toLabelCase(option)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className={styles.auditToggleRow}>
          <button
            type="button"
            className={`${styles.auditToggleButton} ${
              auditObjectFilters.length === 0 ? styles.auditToggleButtonActive : ""
            }`}
            onClick={() => {
              setAuditObjectFilters([]);
              void loadAuditEvents(undefined, { resetFilters: false, objectTypes: [] });
            }}
            disabled={!hasSelectedProject}
          >
            all objects
          </button>
          {auditObjectOptions.map((option) => {
            const isActive = auditObjectFilters.includes(option);
            return (
              <button
                key={`audit-object-toggle-${option}`}
                type="button"
                className={`${styles.auditToggleButton} ${isActive ? styles.auditToggleButtonActive : ""}`}
                onClick={() => toggleAuditObjectType(option)}
                disabled={!hasSelectedProject}
              >
                {toLabelCase(option)}
              </button>
            );
          })}
        </div>

        {auditEvents.length > 0 ? (
          <div className={styles.auditSummaryRow}>
            <span className={styles.auditSummaryPill}>loaded {auditEvents.length}</span>
            <span className={styles.auditSummaryPill}>visible {visibleAuditEvents.length}</span>
            <span className={styles.auditSummaryPill}>objects {auditObjectOptions.length}</span>
            <span className={styles.auditSummaryPill}>
              selected object filters{" "}
              {auditObjectFilters.length > 0 ? auditObjectFilters.length : "all"}
            </span>
            <span className={styles.auditSummaryPill}>
              object branches {Math.max(auditGraphLanes.length - 1, 0)}
            </span>
            <span className={styles.auditSummaryPill}>
              latest{" "}
              {latestAuditEvent
                ? formatDateTimeDisplay(latestAuditEvent.created_at, latestAuditEvent.created_at)
                : "-"}
            </span>
          </div>
        ) : null}

        {visibleAuditEvents.length > 0 ? (
          <>
            <div className={styles.auditGraphViewport}>
              <div className={styles.auditGraphCanvas} style={{ minWidth: `${auditGraphLayout.width}px` }}>
                <svg
                  className={styles.auditGraphSvg}
                  viewBox={`0 0 ${auditGraphLayout.width} ${auditGraphLayout.height}`}
                  aria-label="Financial audit working tree graph"
                >
                  {auditGraphLayout.groups.map((group, index) => (
                    <g key={`graph-group-${group.key}-${index}`}>
                      <rect
                        x={group.startX - 30}
                        y={8}
                        width={group.endX - group.startX + 60}
                        height={32}
                        className={styles.auditGraphGroupHeader}
                        rx={8}
                      />
                      <text x={group.midX} y={29} className={styles.auditGraphGroupLabel} textAnchor="middle">
                        {group.label} ({group.eventIds.length})
                      </text>
                    </g>
                  ))}

                  {auditGraphLayout.groups.slice(0, -1).map((group, index) => {
                    const nextGroup = auditGraphLayout.groups[index + 1];
                    if (!nextGroup) {
                      return null;
                    }
                    const boundaryX = group.endX + (nextGroup.startX - group.endX) / 2;
                    return (
                      <line
                        key={`graph-group-divider-${group.key}`}
                        x1={boundaryX}
                        y1={52}
                        x2={boundaryX}
                        y2={auditGraphLayout.height - 18}
                        className={styles.auditGraphGroupDivider}
                      />
                    );
                  })}

                  {auditGraphLanes.map((lane) => {
                    const y = auditGraphLayout.laneY.get(lane.key);
                    if (y === undefined) {
                      return null;
                    }
                    return (
                      <g key={`graph-lane-${lane.key}`}>
                        <line
                          x1={auditGraphLayout.railStartX}
                          y1={y}
                          x2={auditGraphLayout.railEndX}
                          y2={y}
                          className={
                            lane.objectType === null ? styles.auditGraphMainRail : styles.auditGraphBranchRail
                          }
                        />
                        <text
                          x={18}
                          y={y + 5}
                          className={
                            lane.objectType === null ? styles.auditGraphMainLabel : styles.auditGraphBranchLabel
                          }
                        >
                          {lane.label}
                        </text>
                      </g>
                    );
                  })}

                  {auditGraphLanes
                    .filter((lane) => lane.objectType !== null)
                    .map((lane) => {
                      if (!lane.objectType || lane.objectId === null) {
                        return null;
                      }
                      const objectKey = toAuditObjectKey(lane.objectType, lane.objectId);
                      const branchWindow = auditGraphLayout.branchWindows.get(objectKey);
                      const mainY = auditGraphLayout.laneY.get("project-main");
                      const branchY = auditGraphLayout.laneY.get(lane.key);
                      if (!branchWindow || mainY === undefined || branchY === undefined) {
                        return null;
                      }
                      return (
                        <line
                          key={`graph-start-${objectKey}`}
                          x1={branchWindow.firstX}
                          y1={mainY}
                          x2={branchWindow.firstX}
                          y2={branchY}
                          className={styles.auditGraphBranchStart}
                        />
                      );
                    })}

                  {visibleAuditEvents.map((item) => {
                    const x = auditGraphLayout.eventXById.get(item.id);
                    const mainY = auditGraphLayout.laneY.get("project-main");
                    const laneKey = toAuditLaneKey(item.object_type, item.object_id);
                    const branchY = auditGraphLayout.laneY.get(laneKey);
                    if (x === undefined || mainY === undefined || branchY === undefined) {
                      return null;
                    }
                    return (
                      <g key={`graph-node-${item.id}`}>
                        <circle cx={x} cy={mainY} r={4.5} className={styles.auditGraphMainNode} />
                      </g>
                    );
                  })}
                </svg>

                {visibleAuditEvents.map((item) => {
                  const x = auditGraphLayout.eventXById.get(item.id);
                  const y = auditGraphLayout.laneY.get(toAuditLaneKey(item.object_type, item.object_id));
                  if (x === undefined || y === undefined) {
                    return null;
                  }
                  const isSelected = item.id === selectedAuditEvent?.id;
                  const nextStatus = postActionStatus(item.from_status, item.to_status);
                  return (
                    <button
                      key={`graph-hotspot-${item.id}`}
                      type="button"
                      className={`${styles.auditGraphNodeButton} ${
                        isSelected ? styles.auditGraphNodeButtonActive : ""
                      }`}
                      style={{ left: `${x}px`, top: `${y}px` }}
                      onClick={() => setSelectedAuditEventId(item.id)}
                      title={`${toLabelCase(item.object_type)} #${item.object_id} • ${
                        nextStatus ? toLabelCase(nextStatus) : toLabelCase(item.event_type)
                      }`}
                    >
                      <span className={styles.auditGraphNodeMeta}>
                        {nextStatus ? (
                          <span className={styles.auditTransitionRow}>
                            <span className={`${styles.auditStatusChip} ${auditStatusToneClass(nextStatus)}`}>
                              {toLabelCase(nextStatus)}
                            </span>
                          </span>
                        ) : (
                          <span className={`${styles.auditStatusChip} ${styles.auditStatusToneNeutral}`}>
                            {toLabelCase(item.event_type)}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedAuditEvent ? (
              <article className={styles.auditInspector}>
                <div className={styles.auditInspectorTop}>
                  <span
                    className={`${styles.auditBadge} ${styles.auditBadgeObject} ${auditObjectBadgeClass(
                      selectedAuditEvent.object_type,
                    )}`}
                  >
                    {toLabelCase(selectedAuditEvent.object_type)}
                  </span>
                  {selectedAuditEvent.amount ? (
                    <span className={`${styles.auditBadge} ${styles.auditBadgeAmount}`}>
                      ${selectedAuditEvent.amount}
                    </span>
                  ) : null}
                </div>
                <p>
                  Object #{selectedAuditEvent.object_id} | at{" "}
                  {formatDateTimeDisplay(selectedAuditEvent.created_at, selectedAuditEvent.created_at)}
                </p>
                {selectedAuditEventNextStatus ? (
                  <>
                    <p>State:</p>
                    <p>
                      <span className={styles.auditTransitionRow}>
                        <span
                          className={`${styles.auditStatusChip} ${auditStatusToneClass(
                            selectedAuditEventNextStatus,
                          )}`}
                        >
                          {toLabelCase(selectedAuditEventNextStatus)}
                        </span>
                      </span>
                    </p>
                  </>
                ) : (
                  <p>
                    Event:{" "}
                    <span className={`${styles.auditStatusChip} ${styles.auditStatusToneNeutral}`}>
                      {toLabelCase(selectedAuditEvent.event_type)}
                    </span>
                  </p>
                )}
                <p>
                  Actor: user #{selectedAuditEvent.created_by}
                  {selectedAuditEvent.created_by_email ? ` (${selectedAuditEvent.created_by_email})` : ""}
                </p>
                {selectedAuditEvent.note ? <p>Note: {selectedAuditEvent.note}</p> : null}
                {selectedProjectNumericId ? (
                  <Link
                    href={normalizeUiRoute(
                      toAuditRoute(
                        selectedProjectNumericId,
                        selectedAuditEvent.object_type,
                        selectedAuditEvent.object_id,
                      ),
                    )}
                    className={styles.auditOpenLink}
                  >
                    Open Source Record
                  </Link>
                ) : null}
              </article>
            ) : null}
          </>
        ) : auditEvents.length > 0 ? (
          <p className={styles.auditEmptyState}>No audit events match the current filters.</p>
        ) : (
          <p className={styles.auditEmptyState}>
            Select a project to render its working-tree audit graph.
          </p>
        )}
      </section>

      <section>
        <h3>Accounting Sync Events (ACC-02)</h3>
        <p>Track sync status and safely retry failed events.</p>
        <button type="button" onClick={loadAccountingSyncEvents} disabled={!hasSelectedProject}>
          Load Sync Events
        </button>

        <form onSubmit={createAccountingSyncEvent}>
          <label>
            Provider
            <select value={syncProvider} onChange={() => setSyncProvider("quickbooks_online")}>
              <option value="quickbooks_online">quickbooks_online</option>
            </select>
          </label>
          <label>
            Object type
            <input value={syncObjectType} onChange={(event) => setSyncObjectType(event.target.value)} required />
          </label>
          <label>
            Object id
            <input value={syncObjectId} onChange={(event) => setSyncObjectId(event.target.value)} />
          </label>
          <label>
            Direction
            <select value={syncDirection} onChange={(event) => setSyncDirection(event.target.value as "push" | "pull")}>
              <option value="push">push</option>
              <option value="pull">pull</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={syncStatus}
              onChange={(event) => setSyncStatus(event.target.value as "queued" | "success" | "failed")}
            >
              <option value="queued">queued</option>
              <option value="success">success</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label>
            Error message
            <input value={syncErrorMessage} onChange={(event) => setSyncErrorMessage(event.target.value)} />
          </label>
          <button type="submit" disabled={!hasSelectedProject}>
            Create Sync Event
          </button>
        </form>

        {syncEvents.length > 0 ? (
          <label>
            Failed event to retry
            <select value={retryTargetId} onChange={(event) => setRetryTargetId(event.target.value)}>
              <option value="">Select failed event</option>
              {syncEvents
                .filter((item) => item.status === "failed" || item.status === "queued")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.id} {item.object_type} ({item.status}) retries:{item.retry_count}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <button type="button" onClick={retryAccountingSyncEvent} disabled={!retryTargetId}>
          Retry Selected Sync Event
        </button>

        {syncEvents.length > 0 ? (
          <label>
            Sync event log
            <textarea
              readOnly
              rows={Math.min(8, syncEvents.length + 1)}
              value={syncEvents
                .map(
                  (item) =>
                    `#${item.id} ${item.provider} ${item.object_type}:${item.object_id ?? "-"} ${item.direction} ${item.status} retries=${item.retry_count} error="${item.error_message}"`,
                )
                .join("\n")}
            />
          </label>
        ) : null}
      </section>

      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}
    </section>
  );
}
