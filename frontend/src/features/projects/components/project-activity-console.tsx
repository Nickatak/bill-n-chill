"use client";

/**
 * Filterable timeline of audit and workflow events for a single project.
 * Queries the unified project timeline endpoint which merges quote,
 * invoice, change order, payment, and vendor bill audit records.
 *
 * Parent: app/projects/[projectId]/audit-trail/page.tsx
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { formatDateTimeDisplay } from "@/shared/date-format";
import type { ApiResponse, ProjectTimeline, ProjectTimelineItem } from "@/features/projects/types";
import styles from "./project-activity-console.module.css";

type ProjectActivityConsoleProps = {
  projectId: number;
};

type TimelineCategory = "all" | "financial" | "workflow";

const CATEGORY_OPTIONS: { value: TimelineCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "workflow", label: "Workflow" },
  { value: "financial", label: "Financial" },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  quote_status: "Quote",
  invoice_status: "Invoice",
  change_order_decision: "Change Order",
  payment_record: "Payment",
  vendor_bill_status: "Vendor Bill",
};

function eventTypeBadgeClass(eventType: string): string {
  switch (eventType) {
    case "quote_status":
      return styles.badgeQuote;
    case "invoice_status":
      return styles.badgeInvoice;
    case "change_order_decision":
      return styles.badgeCo;
    case "payment_record":
      return styles.badgePayment;
    case "vendor_bill_status":
      return styles.badgeVendorBill;
    default:
      return styles.badgeDefault;
  }
}

export function ProjectActivityConsole({ projectId }: ProjectActivityConsoleProps) {
  const { token: authToken } = useSharedSessionAuth();
  const [category, setCategory] = useState<TimelineCategory>("all");
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  async function loadTimeline(cat: TimelineCategory) {
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/timeline/?category=${cat}`,
        { headers: buildAuthHeaders(authToken) },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setError(payload.error?.message ?? "Could not load timeline.");
        return;
      }
      setTimeline(payload.data as ProjectTimeline);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authToken) {
      void loadTimeline(category);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, projectId, category]);

  function renderItem(item: ProjectTimelineItem) {
    const badgeLabel = EVENT_TYPE_LABELS[item.event_type] ?? item.event_type;
    return (
      <li key={item.timeline_id} className={styles.item}>
        <div className={styles.itemHeader}>
          <span className={`${styles.badge} ${eventTypeBadgeClass(item.event_type)}`}>
            {badgeLabel}
          </span>
          <span className={styles.timestamp}>{formatDateTimeDisplay(item.occurred_at)}</span>
        </div>
        <p className={styles.itemLabel}>{item.label}</p>
        {item.detail ? <p className={styles.itemDetail}>{item.detail}</p> : null}
        <Link className={styles.itemLink} href={item.ui_route}>
          View →
        </Link>
      </li>
    );
  }

  return (
    <div className={styles.console}>
      <div className={styles.filterBar}>
        {CATEGORY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`${styles.pill} ${category === opt.value ? styles.pillActive : ""}`}
            onClick={() => setCategory(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className={styles.statusMessage}>Loading timeline…</p>
      ) : error ? (
        <p className={styles.errorMessage}>{error}</p>
      ) : timeline && timeline.items.length === 0 ? (
        <p className={styles.emptyState}>No events found for this filter.</p>
      ) : timeline ? (
        <ul className={styles.list}>
          {timeline.items.map(renderItem)}
        </ul>
      ) : null}
    </div>
  );
}
