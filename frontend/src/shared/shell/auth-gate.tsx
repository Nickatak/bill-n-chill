/**
 * Client-side authentication gate that wraps the entire app tree.
 *
 * Renders children immediately for public routes (login, register, public
 * document views). For protected routes, blocks rendering until the session
 * check completes and redirects unauthenticated users to /login.
 */
"use client";

import { isPublicAuthRoute } from "@/shared/session/public-routes";
import { useSessionAuthorization } from "@/shared/session/session-authorization";
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
 * then either render children or redirect to /login.
 */
export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const isPublicRoute = isPublicAuthRoute(pathname);

  // Redirect to /login when the session check finishes and the user is not authorized.
  // Skipped for public routes and while the check is still in progress.
  useEffect(() => {
    if (isPublicRoute || isChecking || isAuthorized) {
      return;
    }
    router.replace("/login");
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
