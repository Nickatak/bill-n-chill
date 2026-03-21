"use client";

/**
 * Guided onboarding checklist with two workflow tracks.
 *
 * Tracks:
 * - Individual Contractors: org → customer → project → estimate (opt) → invoice → payment
 * - Remodelers / GCs: org → customer → project → estimate → send → CO (opt) → invoice → bill → payment
 *
 * Auto-detects progress by probing list endpoints and localStorage flags.
 * Tab selection persists to localStorage. Optional steps have dashed borders
 * and are excluded from progress calculations.
 *
 * Parent: app/onboarding/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────┐
 * │ Tab bar (Individual / Remodeler)    │
 * ├─────────────────────────────────────┤
 * │ Progress bar + label                │
 * ├─────────────────────────────────────┤
 * │ Step cards (ordered list)           │
 * │   ├── Step 1: Organization          │
 * │   ├── Step 2: Customer              │
 * │   ├── ...                           │
 * │   └── Step N: (varies by track)     │
 * ├─────────────────────────────────────┤
 * │ GuideArrowOverlay                   │
 * └─────────────────────────────────────┘
 *
 * ## State (useState)
 *
 * - completedSteps  — Set of step keys detected as done (API probes + localStorage)
 * - firstProjectId  — first detected project ID for deep-linking step hrefs
 * - loading         — true until progress detection finishes
 * - activeTab       — "individual" | "remodeler"; initialized from localStorage
 *
 * ## Functions
 *
 * - switchTab(tab)
 *     Updates activeTab and persists to localStorage.
 *
 * - checkProgress() (useCallback)
 *     Probes /customers/, /projects/, /invoices/ and checks localStorage
 *     for org-visited. Sets completedSteps and firstProjectId.
 *
 * ## Effect: progress detection
 *
 * Deps: [checkProgress, token]
 *
 * Fires on mount. Calls checkProgress to probe endpoints and detect
 * which onboarding steps the user has already completed.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { defaultApiBaseUrl } from "@/shared/api/base";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import { GuideArrowOverlay } from "@/shared/onboarding/guide-arrow-overlay";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./onboarding-checklist.module.css";

type Step = {
  key: string;
  label: string;
  description: string;
  tip?: string;
  href: string;
  /** Override href when a project ID is available (deep link). */
  dynamicHref?: (projectId: number) => string;
  linkLabel: string;
  optional?: boolean;
};

const SHARED_STEPS: Step[] = [
  {
    key: "organization",
    label: "Set up your organization",
    description: "Your company name, logo, and contact info appear on every document you send.",
    href: "/ops/organization",
    linkLabel: "Organization Settings",
  },
  {
    key: "customer",
    label: "Add your first customer",
    description: "Customer records let you scope projects and send professional documents under their name.",
    href: "/customers",
    linkLabel: "Customers",
  },
  {
    key: "project",
    label: "Create a project",
    description: "Projects keep estimates, change orders, invoices, and payments organized per job.",
    href: "/projects",
    linkLabel: "Projects",
  },
];

const INDIVIDUAL_STEPS: Step[] = [
  ...SHARED_STEPS,
  {
    key: "estimate",
    label: "Build an estimate",
    description: "Optional — formalize scope and pricing when the job needs a written contract.",
    tip: "Open a project to find the Estimates section. You can send estimates directly to your customer for approval.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}`,
    linkLabel: "Projects",
    optional: true,
  },
  {
    key: "invoice",
    label: "Create and send an invoice",
    description: "Bill your customer for completed work — no estimate required. Send it directly so they can review and pay.",
    tip: "Open a project to create invoices. Use the Send button to share a professional link with your customer.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}/invoices`,
    linkLabel: "Projects",
  },
  {
    key: "payment",
    label: "Record a payment",
    description: "When your customer pays, log it here. Payments track against projects so you always know what\u2019s outstanding.",
    tip: "Record payments from the Payments page — select a project and log the payment.",
    href: "/accounting",
    linkLabel: "Accounting",
  },
];

const REMODELER_STEPS: Step[] = [
  ...SHARED_STEPS,
  {
    key: "estimate",
    label: "Build an estimate",
    description: "Define scope, pricing, and terms. Once your customer approves, this becomes your contract baseline and budget.",
    tip: "Open a project to find the Estimates section at the bottom of the project details.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}`,
    linkLabel: "Projects",
  },
  {
    key: "send",
    label: "Send for customer approval",
    description: "Share a professional link so your customer can review, approve, or request changes — all online.",
    tip: "Use the Send button on your estimate. Your customer gets a branded page to review and approve.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}`,
    linkLabel: "Projects",
  },
  {
    key: "change-order",
    label: "Handle a change order",
    description: "Scope changes happen. Change orders adjust your contract and budget so everyone stays aligned.",
    tip: "Open a project\u2019s Change Orders section to add, send, or approve scope changes.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}`,
    linkLabel: "Projects",
    optional: true,
  },
  {
    key: "invoice",
    label: "Create an invoice",
    description: "Bill for completed work. Pull line items from your approved budget, or add direct charges for simpler jobs.",
    tip: "Open a project to create invoices from its Invoices section.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}/invoices`,
    linkLabel: "Projects",
  },
  {
    key: "bill",
    label: "Track a vendor bill",
    description: "When a sub or supplier invoices you, log it here. Bills keep your outgoing costs organized per project.",
    tip: "Vendor bills live on the Bills page. Select a project to add or review bills.",
    href: "/bills",
    linkLabel: "Bills",
  },
  {
    key: "payment",
    label: "Record payments",
    description: "Log money in and out. Payments track against projects so you always know what\u2019s settled.",
    tip: "Record payments from the Payments page — both inbound and outbound.",
    href: "/accounting",
    linkLabel: "Accounting",
  },
];

type WorkflowTab = "individual" | "remodeler";

const TAB_KEY = "onboarding:workflow-tab";

/** localStorage key set when the user visits the organization settings page. */
export const ORG_VISITED_KEY = "onboarding:org-visited";

export function OnboardingChecklist() {
  const { token } = useSharedSessionAuth();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [firstProjectId, setFirstProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WorkflowTab>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === "individual" || saved === "remodeler") return saved;
    }
    return "remodeler";
  });

  function switchTab(tab: WorkflowTab) {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  }

  const steps = activeTab === "individual" ? INDIVIDUAL_STEPS : REMODELER_STEPS;

  const checkProgress = useCallback(async () => {
    if (!token) return;

    const completed = new Set<string>();

    // Organization: marked complete when the user has visited the org settings page.
    if (typeof window !== "undefined" && localStorage.getItem(ORG_VISITED_KEY)) {
      completed.add("organization");
    }

    // Probe list endpoints for existence checks
    const checks: { key: string; endpoint: string }[] = [
      { key: "customer", endpoint: "/customers/" },
      { key: "project", endpoint: "/projects/" },
      { key: "invoice", endpoint: "/invoices/" },
    ];

    let detectedProjectId: number | null = null;

    await Promise.all(
      checks.map(async ({ key, endpoint }) => {
        try {
          const response = await fetch(`${defaultApiBaseUrl}${endpoint}`, {
            headers: buildAuthHeaders(token),
          });
          const payload = await response.json();
          if (response.ok && Array.isArray(payload.data) && payload.data.length > 0) {
            completed.add(key);
            if (key === "project" && payload.data[0]?.id) {
              detectedProjectId = Number(payload.data[0].id);
            }
          }
        } catch {
          // Endpoint unavailable — leave step unchecked
        }
      }),
    );

    setFirstProjectId(detectedProjectId);

    setCompletedSteps(completed);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect -- early return guard
      return;
    }
    void checkProgress();
  }, [checkProgress, token]);

  const requiredSteps = steps.filter((s) => !s.optional);
  const completedCount = requiredSteps.filter((s) => completedSteps.has(s.key)).length;
  const totalSteps = requiredSteps.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  return (
    <div className={styles.checklist}>
      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "individual" ? styles.tabActive : ""}`}
          onClick={() => switchTab("individual")}
        >
          Individual Contractors
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "remodeler" ? styles.tabActive : ""}`}
          onClick={() => switchTab("remodeler")}
        >
          Remodelers / GCs
        </button>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
      </div>
      <p className={styles.progressLabel}>
        {loading ? "Checking progress\u2026" : `${completedCount} of ${totalSteps} steps complete`}
      </p>

      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const isCompleted = completedSteps.has(step.key);
          const resolvedHref =
            step.dynamicHref && firstProjectId ? step.dynamicHref(firstProjectId) : step.href;
          return (
            <li
              key={step.key}
              className={`${styles.step} ${isCompleted ? styles.stepCompleted : ""} ${step.optional ? styles.stepOptional : ""}`}
              data-onboarding-step={step.key}
            >
              <span className={styles.stepNumber}>{isCompleted ? "\u2713" : index + 1}</span>
              <div className={styles.stepContent}>
                <h3 className={styles.stepLabel}>
                  {step.label}
                  {step.optional ? <span className={styles.optionalBadge}>Optional</span> : null}
                </h3>
                <p className={styles.stepDescription}>{step.description}</p>
                {step.tip ? <p className={styles.stepTip}>{step.tip}</p> : null}
                <Link href={resolvedHref} className={styles.stepLink}>
                  {step.linkLabel} &rarr;
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
      <GuideArrowOverlay />
    </div>
  );
}
