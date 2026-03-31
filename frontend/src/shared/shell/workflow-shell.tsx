/**
 * Workflow shell region rendered below the app toolbar.
 *
 * Owns three mutually-exclusive states:
 * 1. Hidden entirely on public document routes (customer-facing views).
 * 2. A compact "checking session" / "sign in" hint bar when the user
 *    has no active session.
 * 3. The full workflow navbar + breadcrumbs once authorized.
 */
"use client";

import { isPublicDocumentRoute } from "@/shared/session/public-routes";
import { useSessionAuthorization } from "@/shared/session/session-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WorkflowNavbar } from "./workflow-navbar";
import { WorkflowBreadcrumbs } from "./workflow-breadcrumbs";
import styles from "./auth-hint.module.css";

/**
 * Render the workflow navigation region based on session state.
 *
 * Public document routes (tokenized quote/invoice/CO views) hide
 * the shell completely so customers see a clean read-only page.
 * Unauthenticated users on internal routes see a sign-in hint.
 * Authenticated users get the full navbar and breadcrumb trail.
 */
export function WorkflowShell() {
  const pathname = usePathname();
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const hideShell = isPublicDocumentRoute(pathname);

  // Public document routes never show the workflow shell.
  if (hideShell) {
    return null;
  }

  // Session check still in flight -- show a transient status bar.
  if (isChecking && !isAuthorized) {
    return (
      <>
        <div className={styles.hintSpacer} />
        <div className={styles.bar} role="status" aria-live="polite">
          <div className={styles.inner}>Checking session...</div>
        </div>
      </>
    );
  }

  // No session -- prompt the user to sign in.
  if (!isAuthorized) {
    return (
      <>
        <div className={styles.hintSpacer} />
        <div className={styles.bar} role="note" aria-label="Authentication hint">
          <div className={styles.inner}>
            <span className={styles.hintText}>
              <Link href="/login">Sign in</Link> to unlock workflow actions.
            </span>
            <div className={styles.hintActions}>
              <Link href="/login" className={styles.hintPrimary}>Sign In</Link>
              <Link href="/register" className={styles.hintPrimary}>Get Started</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Fully authorized -- render the workflow navigation.
  return (
    <>
      <div className={styles.spacer} />
      <WorkflowNavbar />
      <WorkflowBreadcrumbs />
    </>
  );
}
