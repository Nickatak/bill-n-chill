"use client";

import { buildAuthHeaders } from "@/features/session/auth-headers";
import Link from "next/link";
import { useEffect, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import { ApiResponse, ProjectTimeline } from "@/features/projects/types";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { formatDateTimeDisplay } from "@/shared/date-format";
import styles from "./project-activity-console.module.css";

type ProjectActivityConsoleProps = {
  projectId: number;
};

export function ProjectActivityConsole({ projectId }: ProjectActivityConsoleProps) {
  const { token, authMessage } = useSharedSessionAuth();
  const [statusMessage, setStatusMessage] = useState("");
  const [category, setCategory] = useState<"all" | "financial" | "workflow">("all");
  const [timeline, setTimeline] = useState<ProjectTimeline | null>(null);

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  async function loadTimeline(nextCategory: "all" | "financial" | "workflow") {
    if (!token) {
      return;
    }
    setStatusMessage("Loading project timeline...");
    try {
      const response = await fetch(
        `${normalizedBaseUrl}/projects/${projectId}/timeline/?category=${nextCategory}`,
        {
          headers: buildAuthHeaders(token),
        },
      );
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load project timeline.");
        return;
      }
      const data = payload.data as ProjectTimeline;
      setTimeline(data);
      setStatusMessage(`Loaded ${data.item_count} timeline event(s).`);
    } catch {
      setStatusMessage("Could not reach project timeline endpoint.");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadTimeline(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectId]);

  return (
    <section className={styles.console}>
      <p className={styles.authMessage}>{authMessage}</p>
      <p className={styles.intro}>
        Timeline combines finance audit rows and workflow status events for project #{projectId}.
      </p>
      <label className={styles.filterField}>
        <span>Category</span>
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as "all" | "financial" | "workflow")}
        >
          <option value="all">all</option>
          <option value="financial">financial</option>
          <option value="workflow">workflow</option>
        </select>
      </label>
      <p className={styles.actions}>
        <button type="button" onClick={() => loadTimeline(category)} disabled={!token}>
          Load Timeline
        </button>
      </p>
      {timeline ? (
        <div className={styles.timelineCard}>
          <p className={styles.timelineSummary}>
            Project: {timeline.project_name} | Category: {timeline.category} | Items:{" "}
            {timeline.item_count}
          </p>
          {timeline.items.length > 0 ? (
            <ul className={styles.timelineList}>
              {timeline.items.map((item) => (
                <li key={item.timeline_id} className={styles.timelineItem}>
                  <div className={styles.timelineTopRow}>
                    <span className={styles.categoryBadge}>{item.category}</span>
                    <span>{formatDateTimeDisplay(item.occurred_at, item.occurred_at)}</span>
                  </div>
                  <p className={styles.timelineLabel}>{item.label}</p>
                  {item.detail ? <p className={styles.timelineDetail}>{item.detail}</p> : null}
                  <Link className={styles.openLink} href={item.ui_route}>
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyState}>No timeline events matched this filter.</p>
          )}
        </div>
      ) : null}
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}
    </section>
  );
}
