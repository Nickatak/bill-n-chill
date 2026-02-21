"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/features/projects/api";
import { ApiResponse, ProjectTimeline } from "@/features/projects/types";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { formatDateTimeDisplay } from "@/shared/date-format";

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
          headers: { Authorization: `Token ${token}` },
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
    <section>
      <p>{authMessage}</p>
      <p>
        Timeline combines finance audit rows and workflow status events for project #{projectId}.
      </p>
      <label>
        Category
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as "all" | "financial" | "workflow")}
        >
          <option value="all">all</option>
          <option value="financial">financial</option>
          <option value="workflow">workflow</option>
        </select>
      </label>
      <p>
        <button type="button" onClick={() => loadTimeline(category)} disabled={!token}>
          Load Timeline
        </button>
      </p>
      {timeline ? (
        <div>
          <p>
            Project: {timeline.project_name} | Category: {timeline.category} | Items:{" "}
            {timeline.item_count}
          </p>
          {timeline.items.length > 0 ? (
            <ul>
              {timeline.items.map((item) => (
                <li key={item.timeline_id}>
                  [{item.category}] {item.label} |{" "}
                  {formatDateTimeDisplay(item.occurred_at, item.occurred_at)}
                  {item.detail ? ` | ${item.detail}` : ""} | <Link href={item.ui_route}>Open</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>No timeline events matched this filter.</p>
          )}
        </div>
      ) : null}
      <p>{statusMessage}</p>
    </section>
  );
}
