"use client";

import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WorkflowNavbar } from "./workflow-navbar";
import { WorkflowBreadcrumbs } from "./workflow-breadcrumbs";
import styles from "./auth-hint.module.css";

export function WorkflowShell() {
  const pathname = usePathname();
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const hideShell = isPublicDocumentRoute(pathname);

  if (hideShell) {
    return null;
  }

  if (isChecking && !isAuthorized) {
    return (
      <>
        <div className={styles.spacer} />
        <div className={styles.bar} role="status" aria-live="polite">
          <div className={styles.inner}>Checking session...</div>
        </div>
      </>
    );
  }

  if (!isAuthorized) {
    return (
      <>
        <div className={styles.spacer} />
        <div className={styles.bar} role="note" aria-label="Authentication hint">
          <div className={styles.inner}>
            Sign in on <Link href="/">Home</Link> to unlock workflow actions.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.spacer} />
      <WorkflowNavbar />
      <WorkflowBreadcrumbs />
    </>
  );
}
