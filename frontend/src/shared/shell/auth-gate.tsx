/**
 * Client-side authentication gate that wraps the entire app tree.
 *
 * Renders children immediately for public routes (login, public document
 * views). For protected routes, blocks rendering until the session check
 * completes and redirects unauthenticated users to the home page.
 */
"use client";

import { isPublicAuthRoute } from "@/features/session/public-routes";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

type AuthGateProps = {
  children: ReactNode;
};

/**
 * Prevent unauthenticated access to protected routes.
 *
 * Public routes bypass the gate entirely so tokenized customer links
 * (estimates, invoices, change orders) render without a session.
 * Protected routes show nothing until the session check resolves,
 * then either render children or redirect to home.
 */
export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const isPublicRoute = isPublicAuthRoute(pathname);

  // Redirect to home when the session check finishes and the user is not authorized.
  // Skipped for public routes and while the check is still in progress.
  useEffect(() => {
    if (isPublicRoute || isChecking || isAuthorized) {
      return;
    }
    router.replace("/");
  }, [isAuthorized, isChecking, isPublicRoute, router]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  if (isChecking) {
    return null;
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
}
