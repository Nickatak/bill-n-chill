"use client";

/**
 * Guided onboarding checklist — single unified track.
 *
 * Three top-level steps (org → customer → project), then a project
 * subsection that reveals once a project is detected. Sub-steps cover
 * the full billing workflow: quotes, COs, invoices, bills, payments.
 *
 * Auto-detects progress by probing list endpoints and localStorage flags.
 * Optional steps have dashed borders and are excluded from progress.
 * Guide arrows only fire for top-level steps (sub-steps are implicitly
 * "inside Projects").
 *
 * Parent: app/onboarding/page.tsx
 *
 * ## Page layout
 *
 * ┌─────────────────────────────────────┐
 * │ Progress bar + label                │
 * ├─────────────────────────────────────┤
 * │ Step 1: Organization               │
 * │ Step 2: Customer                   │
 * │ Step 3: Project                    │
 * │   ┌─ Sub-steps (revealed) ───────┐ │
 * │   │  Build a quote (opt)     │ │
 * │   │  Send for approval (opt)     │ │
 * │   │  Handle a change order (opt) │ │
 * │   │  Create an invoice           │ │
 * │   │  Track a vendor bill (opt)   │ │
 * │   │  Record a payment            │ │
 * │   └──────────────────────────────┘ │
 * ├─────────────────────────────────────┤
 * │ GuideArrowOverlay                   │
 * └─────────────────────────────────────┘
 *
 * ## State (useState)
 *
 * - completedSteps  — Set of step keys detected as done (API probes + localStorage)
 * - firstProjectId  — first detected project ID for deep-linking step hrefs
 * - loading         — true until progress detection finishes
 *
 * ## Functions
 *
 * - checkProgress() (useCallback)
 *     Probes /customers/, /projects/, /invoices/ and checks localStorage
 *     for org-visited. Sets completedSteps and firstProjectId.
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

/** Top-level steps — these get guide arrows pointing to nav targets. */
const TOP_LEVEL_STEPS: Step[] = [
  {
    key: "organization",
    label: "Set up your organization",
    description:
      "Your company name, logo, and contact info appear on every document you send.",
    href: "/ops/organization",
    linkLabel: "Organization Settings",
  },
  {
    key: "customer",
    label: "Add your first customer",
    description:
      "Customer records let you scope projects and send professional documents under their name.",
    href: "/customers",
    linkLabel: "Customers",
  },
  {
    key: "project",
    label: "Create a project",
    description:
      "Projects keep quotes, change orders, invoices, and payments organized per job.",
    href: "/projects",
    linkLabel: "Projects",
  },
];

/** Sub-steps nested under "Create a project" — revealed once a project exists. */
const PROJECT_SUB_STEPS: Step[] = [
  {
    key: "quote",
    label: "Build & send a quote",
    description:
      "Define scope and pricing, then share a professional link so your customer can review and approve.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}/quotes`,
    linkLabel: "Quotes",
    optional: true,
  },
  {
    key: "change-order",
    label: "Handle a change order",
    description:
      "Scope changes happen. Change orders adjust your contract and budget so everyone stays aligned.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}/change-orders`,
    linkLabel: "Change Orders",
    optional: true,
  },
  {
    key: "invoice",
    label: "Create an invoice & record payment",
    description:
      "Bill for completed work, then log the payment when your customer pays. Always know what\u2019s outstanding.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}/invoices`,
    linkLabel: "Invoices",
  },
  {
    key: "bill",
    label: "Track expenses",
    description:
      "When a sub or supplier invoices you, log it here. Expenses stay organized per project so you always know your costs.",
    href: "/projects",
    dynamicHref: (pid) => `/projects/${pid}/bills`,
    linkLabel: "Bills",
    optional: true,
  },
];

/** localStorage key set when the user visits the organization settings page. */
export const ORG_VISITED_KEY = "onboarding:org-visited";

/** All steps that count toward progress (required top-level + required sub-steps). */
const ALL_REQUIRED_KEYS = [
  ...TOP_LEVEL_STEPS.filter((s) => !s.optional),
  ...PROJECT_SUB_STEPS.filter((s) => !s.optional),
].map((s) => s.key);

export function OnboardingChecklist() {
  const { token: authToken } = useSharedSessionAuth();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [firstProjectId, setFirstProjectId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const checkProgress = useCallback(async () => {
    if (!authToken) return;

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
            headers: buildAuthHeaders(authToken),
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
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setLoading(false); // eslint-disable-line react-hooks/set-state-in-effect -- early return guard
      return;
    }
    void checkProgress();
  }, [checkProgress, authToken]);

  const hasProject = firstProjectId !== null;
  const completedCount = ALL_REQUIRED_KEYS.filter((k) => completedSteps.has(k)).length;
  const totalSteps = ALL_REQUIRED_KEYS.length;
  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  return (
    <div className={styles.checklist}>
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
      </div>
      <p className={styles.progressLabel}>
        {loading ? "Checking progress\u2026" : `${completedCount} of ${totalSteps} steps complete`}
      </p>

      <ol className={styles.steps}>
        {TOP_LEVEL_STEPS.map((step, index) => {
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

              {/* Project sub-steps — nested inside the project step card */}
              {step.key === "project" && (
                <div className={`${styles.subSection} ${hasProject ? styles.subSectionRevealed : ""}`}>
                  <p className={styles.subSectionHeader}>
                    {hasProject ? "Inside your project" : "Complete this step to unlock"}
                  </p>
                  <ol className={styles.subSteps}>
                    {PROJECT_SUB_STEPS.map((sub) => {
                      const subCompleted = completedSteps.has(sub.key);
                      const subHref =
                        sub.dynamicHref && firstProjectId
                          ? sub.dynamicHref(firstProjectId)
                          : sub.href;
                      return (
                        <li
                          key={sub.key}
                          className={`${styles.subStep} ${subCompleted ? styles.subStepCompleted : ""} ${sub.optional ? styles.subStepOptional : ""} ${!hasProject ? styles.subStepLocked : ""}`}
                        >
                          <div className={styles.subStepContent}>
                            <h4 className={styles.subStepLabel}>
                              {sub.label}
                              {sub.optional ? (
                                <span className={styles.optionalBadge}>Optional</span>
                              ) : null}
                            </h4>
                            <p className={styles.subStepDescription}>{sub.description}</p>
                            {hasProject ? (
                              <Link href={subHref} className={styles.stepLink}>
                                {sub.linkLabel} &rarr;
                              </Link>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <GuideArrowOverlay />
    </div>
  );
}
