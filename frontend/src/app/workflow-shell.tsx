"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { clearClientSession, loadClientSession } from "@/features/session/client-session";
import { WorkflowNavbar } from "./workflow-navbar";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function WorkflowShell() {
  const pathname = usePathname();
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function verify() {
      const session = loadClientSession();
      if (!session?.token) {
        setIsAuthorized(false);
        setIsChecking(false);
        return;
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: { Authorization: `Token ${session.token}` },
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
  }, [pathname]);

  if (isChecking) {
    return (
      <div className="authHintBar" role="status" aria-live="polite">
        <div className="authHintInner">Checking session...</div>
      </div>
    );
  }

  if (isAuthorized) {
    return <WorkflowNavbar />;
  }

  return (
    <div className="authHintBar" role="note" aria-label="Authentication hint">
      <div className="authHintInner">
        Sign in on <Link href="/">Home</Link> to unlock workflow actions.
      </div>
    </div>
  );
}
