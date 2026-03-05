"use client";

/**
 * Guided onboarding checklist with two workflow tracks:
 * - Individual Contractors: org → customer → project → invoice (direct)
 * - Remodelers / GCs: org → customer → project → estimate → send → invoice
 *
 * Auto-detects progress by probing list endpoints and localStorage flags.
 * Tab selection persists to localStorage.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { GuideArrowOverlay } from "@/shared/onboarding/guide-arrow-overlay";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Step = {
  key: string;
  label: string;
  description: string;
  href: string;
  linkLabel: string;
  optional?: boolean;
};

const SHARED_STEPS: Step[] = [
  {
    key: "organization",
    label: "Set up your organization",
    description: "Name your company and configure your organization profile.",
    href: "/ops/organization",
    linkLabel: "Organization Settings",
  },
  {
    key: "customer",
    label: "Add your first customer",
    description: "Create a customer record so you can scope projects and send documents.",
    href: "/customers",
    linkLabel: "Customers",
  },
  {
    key: "project",
    label: "Create a project",
    description: "Projects group estimates, change orders, and invoices under one job.",
    href: "/projects",
    linkLabel: "Projects",
  },
];

const INDIVIDUAL_STEPS: Step[] = [
  ...SHARED_STEPS,
  {
    key: "estimate",
    label: "Build an estimate",
    description: "Optional — formalize scope and pricing if the job needs a contract baseline.",
    href: "/projects",
    linkLabel: "Projects",
    optional: true,
  },
  {
    key: "invoice",
    label: "Create an invoice",
    description: "Invoice your customer directly for completed work — no estimate required.",
    href: "/invoices",
    linkLabel: "Invoices",
  },
];

const REMODELER_STEPS: Step[] = [
  ...SHARED_STEPS,
  {
    key: "estimate",
    label: "Build an estimate",
    description: "Define scope and pricing. Once approved, the estimate becomes your contract baseline.",
    href: "/projects",
    linkLabel: "Projects",
  },
  {
    key: "send",
    label: "Send for customer approval",
    description: "Share a link so your customer can review, approve, or request changes.",
    href: "/projects",
    linkLabel: "Projects",
  },
  {
    key: "invoice",
    label: "Create an invoice",
    description: "Bill for your work. Invoice from your budget or add direct line items for simpler jobs.",
    href: "/invoices",
    linkLabel: "Invoices",
  },
];

type WorkflowTab = "individual" | "remodeler";

const TAB_KEY = "onboarding:workflow-tab";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

/** localStorage key set when the user visits the organization settings page. */
export const ORG_VISITED_KEY = "onboarding:org-visited";

export function OnboardingChecklist() {
  const { token } = useSharedSessionAuth();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [activeGuideStep, setActiveGuideStep] = useState<string | null>(null);
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
    setActiveGuideStep(null);
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

    await Promise.all(
      checks.map(async ({ key, endpoint }) => {
        try {
          const response = await fetch(`${defaultApiBaseUrl}${endpoint}`, {
            headers: buildAuthHeaders(token),
          });
          const payload = await response.json();
          if (response.ok && Array.isArray(payload.data) && payload.data.length > 0) {
            completed.add(key);
          }
        } catch {
          // Endpoint unavailable — leave step unchecked
        }
      }),
    );

    setCompletedSteps(completed);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
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
          return (
            <li
              key={step.key}
              className={`${styles.step} ${isCompleted ? styles.stepCompleted : ""} ${step.optional ? styles.stepOptional : ""}`}
              data-onboarding-step={step.key}
              onMouseEnter={() => setActiveGuideStep(step.key)}
              onMouseLeave={() => setActiveGuideStep(null)}
            >
              <span className={styles.stepNumber}>{isCompleted ? "\u2713" : index + 1}</span>
              <div className={styles.stepContent}>
                <h3 className={styles.stepLabel}>
                  {step.label}
                  {step.optional ? <span className={styles.optionalBadge}>Optional</span> : null}
                </h3>
                <p className={styles.stepDescription}>{step.description}</p>
                <Link href={step.href} className={styles.stepLink}>
                  {step.linkLabel} &rarr;
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
      <GuideArrowOverlay activeStep={activeGuideStep} />
    </div>
  );
}
