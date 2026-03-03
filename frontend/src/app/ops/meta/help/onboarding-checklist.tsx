"use client";

/**
 * Guided onboarding checklist. Auto-detects progress by probing existing
 * list endpoints (customers, projects, invoices) and the session org profile.
 * Steps that can't be auto-detected yet remain unchecked until the user
 * navigates through them.
 */

import { buildAuthHeaders } from "@/features/session/auth-headers";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Step = {
  key: string;
  label: string;
  description: string;
  href: string;
  linkLabel: string;
};

const STEPS: Step[] = [
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
    description: "Bill against your contract. Line items pull from your approved estimate and budget.",
    href: "/invoices",
    linkLabel: "Invoices",
  },
];

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function OnboardingChecklist() {
  const { token, organization } = useSharedSessionAuth();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const checkProgress = useCallback(async () => {
    if (!token) return;

    const completed = new Set<string>();

    // Organization: check if display name is set to something meaningful
    if (organization?.displayName && organization.displayName !== "Organization") {
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
  }, [token, organization]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    void checkProgress();
  }, [checkProgress, token]);

  const completedCount = completedSteps.size;
  const totalSteps = STEPS.length;
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
        {STEPS.map((step, index) => {
          const isCompleted = completedSteps.has(step.key);
          return (
            <li key={step.key} className={`${styles.step} ${isCompleted ? styles.stepCompleted : ""}`}>
              <span className={styles.stepNumber}>{isCompleted ? "\u2713" : index + 1}</span>
              <div className={styles.stepContent}>
                <h3 className={styles.stepLabel}>{step.label}</h3>
                <p className={styles.stepDescription}>{step.description}</p>
                <Link href={step.href} className={styles.stepLink}>
                  {step.linkLabel} &rarr;
                </Link>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
