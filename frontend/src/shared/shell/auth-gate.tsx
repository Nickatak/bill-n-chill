"use client";

import { isPublicAuthRoute } from "@/features/session/public-routes";
import { useSessionAuthorization } from "@/features/session/session-authorization";
import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthorized, isChecking } = useSessionAuthorization();
  const isPublicRoute = isPublicAuthRoute(pathname);

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
