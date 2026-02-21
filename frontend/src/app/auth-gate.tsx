"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { clearClientSession, loadClientSession } from "@/features/session/client-session";

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

type AuthGateProps = {
  children: ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  const isPublicRoute =
    pathname === "/" ||
    pathname === "/register" ||
    Boolean(pathname && /^\/estimate\/[^/]+\/?$/.test(pathname));

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (isPublicRoute) {
        if (!cancelled) {
          setIsAuthorized(true);
          setIsChecking(false);
        }
        return;
      }

      const session = loadClientSession();
      if (!session?.token) {
        if (!cancelled) {
          setIsAuthorized(false);
          setIsChecking(false);
          router.replace("/");
        }
        return;
      }

      try {
        const response = await fetch(`${defaultApiBaseUrl}/auth/me/`, {
          headers: { Authorization: `Token ${session.token}` },
        });
        await response.json();
        if (!response.ok) {
          clearClientSession();
          if (!cancelled) {
            setIsAuthorized(false);
            setIsChecking(false);
            router.replace("/");
          }
          return;
        }
        if (!cancelled) {
          setIsAuthorized(true);
          setIsChecking(false);
        }
      } catch {
        if (!cancelled) {
          setIsAuthorized(false);
          setIsChecking(false);
          router.replace("/");
        }
      }
    }

    void verify();

    return () => {
      cancelled = true;
    };
  }, [isPublicRoute, pathname, router]);

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
