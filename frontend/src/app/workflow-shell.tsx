"use client";

import { isPublicDocumentRoute } from "@/features/session/public-routes";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WorkflowNavbar } from "./workflow-navbar";
import { WorkflowBreadcrumbs } from "./workflow-breadcrumbs";

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
        <div className="workflowShellSpacer" />
        <div className="authHintBar" role="status" aria-live="polite">
          <div className="authHintInner">Checking session...</div>
        </div>
      </>
    );
  }

  if (!isAuthorized) {
    return (
      <>
        <div className="workflowShellSpacer" />
        <div className="authHintBar" role="note" aria-label="Authentication hint">
          <div className="authHintInner">
            Sign in on <Link href="/">Home</Link> to unlock workflow actions.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="workflowShellSpacer" />
      <WorkflowNavbar />
      <WorkflowBreadcrumbs />
    </>
  );
}
