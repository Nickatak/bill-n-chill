"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { clearClientSession } from "@/features/session/client-session";
import { useSharedSessionAuth } from "@/features/session/use-shared-session";
import { WorkflowNavbar } from "./workflow-navbar";
import { WorkflowBreadcrumbs } from "./workflow-breadcrumbs";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function WorkflowShell() {
  const pathname = usePathname();
  const { token } = useSharedSessionAuth();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const hideShell = Boolean(pathname && /^\/estimate\/[^/]+\/?$/.test(pathname));

  useEffect(() => {
    async function verify() {
      if (hideShell) {
        setIsAuthorized(false);
        setIsChecking(false);
        return;
      }

      if (!token) {
        setIsAuthorized(false);
        setIsChecking(false);
        return;
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: { Authorization: `Token ${token}` },
        });
        await response.json();
        if (!response.ok) {
          clearClientSession();
          setIsAuthorized(false);
          setIsChecking(false);
          return;
        }
        setIsAuthorized(true);
      } catch {
        setIsAuthorized(false);
      } finally {
        setIsChecking(false);
      }
    }

    void verify();
  }, [hideShell, pathname, token]);

  if (hideShell) {
    return null;
  }

  if (isChecking) {
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
