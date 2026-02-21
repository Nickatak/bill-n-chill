export type MemoryEntry = {
  id: string;
  date: string;
  title: string;
  type: "decision" | "bugfix" | "seed-data" | "routing" | "planning";
  notes: string[];
};

export const opsMetaMemoryLog: MemoryEntry[] = [
  {
    id: "2026-02-21-change-orders-scoped-route",
    date: "2026-02-21",
    title: "Change Orders moved to project-scoped route",
    type: "routing",
    notes: [
      "Change orders now live at /projects/{projectId}/change-orders.",
      "Legacy direct access still exists, but primary navigation is project-scoped.",
    ],
  },
  {
    id: "2026-02-21-change-orders-navbar-removal",
    date: "2026-02-21",
    title: "Top-level Change Orders nav removed",
    type: "decision",
    notes: [
      "Since change orders are now context-scoped, the global navbar item was removed.",
      "Project context remains the primary entry point for CO operations.",
    ],
  },
  {
    id: "2026-02-21-estimate-semantic-history",
    date: "2026-02-21",
    title: "Estimate semantic history requested in seed data",
    type: "seed-data",
    notes: [
      "A semantic estimate history chain was requested (not just status events).",
      "Intent is to make revision lineage obvious for testing and UX validation.",
    ],
  },
  {
    id: "2026-02-21-project-reselect-labels-bug",
    date: "2026-02-21",
    title: "Project double-select quick-view label bug",
    type: "bugfix",
    notes: [
      "Re-selecting the same project produced placeholder labels D-- / S-- / A--.",
      "Issue was tracked and addressed as part of project/estimate quick-view hardening.",
    ],
  },
];

