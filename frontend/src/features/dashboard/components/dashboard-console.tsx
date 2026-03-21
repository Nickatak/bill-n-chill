"use client";

/**
 * Authenticated dashboard landing page — read-only report hub.
 *
 * Fetches three report endpoints in parallel on mount and renders
 * a portfolio snapshot, an attention feed, and change order impact.
 * No mutations, no form state — purely display.
 *
 * Parent: app/dashboard/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────────┐
 * │ Portfolio (metric cards + project table) │
 * ├─────────────────────────────────────────┤
 * │ Needs Attention (linked feed items)     │
 * ├─────────────────────────────────────────┤
 * │ Change Order Impact (conditional)       │
 * └─────────────────────────────────────────┘
 *
 * ## State (useState)
 *
 * - portfolio     — PortfolioSnapshot from /reports/portfolio/
 * - attentionFeed — AttentionFeed from /reports/attention-feed/
 * - changeImpact  — ChangeImpactSummary from /reports/change-impact/
 * - loading       — true until all three fetches settle
 *
 * ## Effect: data fetch
 *
 * Deps: [token]
 *
 * Fires on mount. Uses Promise.allSettled so each report renders
 * independently — a failed endpoint doesn't block the others.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import {
  ApiResponse,
  AttentionFeed,
  AttentionFeedItem,
  ChangeImpactSummary,
  PortfolioSnapshot,
} from "@/features/projects/types";
import { formatCurrency } from "@/shared/money-format";
import styles from "./dashboard-console.module.css";

function severityClass(severity: AttentionFeedItem["severity"]): string {
  if (severity === "high") return styles.severityHigh;
  if (severity === "medium") return styles.severityMedium;
  return styles.severityLow;
}

export function DashboardConsole() {
  const { token: authToken, authMessage } = useSharedSessionAuth();
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [attentionFeed, setAttentionFeed] = useState<AttentionFeed | null>(null);
  const [changeImpact, setChangeImpact] = useState<ChangeImpactSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  useEffect(() => {
    if (!authToken) return;

    async function loadDashboard() {
      setLoading(true);
      const headers = buildAuthHeaders(authToken);

      const [portfolioRes, attentionRes, changeImpactRes] = await Promise.allSettled([
        fetch(`${normalizedBaseUrl}/reports/portfolio/`, { headers }),
        fetch(`${normalizedBaseUrl}/reports/attention-feed/`, { headers }),
        fetch(`${normalizedBaseUrl}/reports/change-impact/`, { headers }),
      ]);

      if (portfolioRes.status === "fulfilled" && portfolioRes.value.ok) {
        const payload: ApiResponse = await portfolioRes.value.json();
        setPortfolio(payload.data as PortfolioSnapshot);
      }
      if (attentionRes.status === "fulfilled" && attentionRes.value.ok) {
        const payload: ApiResponse = await attentionRes.value.json();
        setAttentionFeed(payload.data as AttentionFeed);
      }
      if (changeImpactRes.status === "fulfilled" && changeImpactRes.value.ok) {
        const payload: ApiResponse = await changeImpactRes.value.json();
        setChangeImpact(payload.data as ChangeImpactSummary);
      }

      setLoading(false);
    }

    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  if (authMessage.startsWith("No shared session")) {
    return <p className={styles.authMessage}>{authMessage}</p>;
  }

  if (loading) {
    return <p className={styles.loadingMessage}>Loading dashboard...</p>;
  }

  const hasAttentionItems = attentionFeed && attentionFeed.item_count > 0;
  const hasChangeImpact = changeImpact && changeImpact.approved_change_orders_count > 0;

  return (
    <div className={styles.dashboard}>
      {/* Portfolio health */}
      {portfolio ? (
        <section className={styles.portfolioSection}>
          <h2 className={styles.sectionTitle}>Portfolio</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Active Projects</span>
              <strong className={styles.metricValue}>{portfolio.active_projects_count}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>AR Outstanding</span>
              <strong className={styles.metricValue}>
                {formatCurrency(Number(portfolio.ar_total_outstanding))}
              </strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>AP Outstanding</span>
              <strong className={styles.metricValue}>
                {formatCurrency(Number(portfolio.ap_total_outstanding))}
              </strong>
            </div>
            <div className={`${styles.metricCard} ${
              portfolio.overdue_invoice_count > 0 ? styles.metricCardWarning : ""
            }`}>
              <span className={styles.metricLabel}>Overdue Invoices</span>
              <strong className={styles.metricValue}>{portfolio.overdue_invoice_count}</strong>
            </div>
            <div className={`${styles.metricCard} ${
              portfolio.overdue_vendor_bill_count > 0 ? styles.metricCardWarning : ""
            }`}>
              <span className={styles.metricLabel}>Overdue Bills</span>
              <strong className={styles.metricValue}>{portfolio.overdue_vendor_bill_count}</strong>
            </div>
          </div>

          {portfolio.projects.length > 0 ? (
            <div className={styles.projectBreakdown}>
              <h3 className={styles.subsectionTitle}>By Project</h3>
              <div className={styles.projectTable}>
                <div className={`${styles.projectRow} ${styles.projectRowHeader}`}>
                  <span>Project</span>
                  <span>AR Outstanding</span>
                  <span>AP Outstanding</span>
                  <span>Approved COs</span>
                </div>
                {portfolio.projects.map((project) => (
                  <Link
                    key={project.project_id}
                    href={`/projects?project=${project.project_id}`}
                    className={styles.projectRow}
                  >
                    <span className={styles.projectName}>{project.project_name}</span>
                    <span>{formatCurrency(Number(project.ar_outstanding))}</span>
                    <span>{formatCurrency(Number(project.ap_outstanding))}</span>
                    <span>{formatCurrency(Number(project.approved_change_orders_total))}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Attention feed */}
      {hasAttentionItems ? (
        <section className={styles.attentionSection}>
          <h2 className={styles.sectionTitle}>
            Needs Attention
            <span className={styles.countBadge}>{attentionFeed.item_count}</span>
          </h2>
          <div className={styles.attentionList}>
            {attentionFeed.items.map((item, index) => (
              <Link
                key={`${item.kind}-${item.detail_endpoint}-${index}`}
                href={item.ui_route}
                className={styles.attentionItem}
              >
                <span className={`${styles.severityBadge} ${severityClass(item.severity)}`}>
                  {item.severity}
                </span>
                <div className={styles.attentionContent}>
                  <strong className={styles.attentionLabel}>{item.label}</strong>
                  <span className={styles.attentionDetail}>
                    {item.project_name} &middot; {item.detail}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className={styles.attentionSection}>
          <h2 className={styles.sectionTitle}>Needs Attention</h2>
          <p className={styles.emptyState}>No items need attention right now.</p>
        </section>
      )}

      {/* Change impact */}
      {hasChangeImpact ? (
        <section className={styles.changeImpactSection}>
          <h2 className={styles.sectionTitle}>Change Order Impact</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Approved COs</span>
              <strong className={styles.metricValue}>{changeImpact.approved_change_orders_count}</strong>
            </div>
            <div className={styles.metricCard}>
              <span className={styles.metricLabel}>Total Contract Growth</span>
              <strong className={styles.metricValue}>
                {formatCurrency(Number(changeImpact.approved_change_orders_total))}
              </strong>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
