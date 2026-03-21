"use client";

/**
 * Global onboarding banner shown on authenticated workflow pages until
 * the user completes or dismisses onboarding.
 *
 * Rendered inside PageShell so it sits within the max-width container
 * and flows naturally above page content. Only visible on whitelisted
 * routes — excluded from onboarding itself, auth pages, public document
 * pages, and dev-only routes.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSharedSessionAuth } from "@/shared/session/use-shared-session";
import styles from "./onboarding-banner.module.css";

/** Routes (exact or prefix) where the banner should appear. */
const SHOW_EXACT = new Set(["/customers", "/accounting", "/cost-codes", "/vendors"]);
const SHOW_PREFIX = ["/projects", "/ops/"];

function shouldShow(pathname: string): boolean {
  if (SHOW_EXACT.has(pathname)) return true;
  return SHOW_PREFIX.some((prefix) => pathname.startsWith(prefix));
}

export function OnboardingBanner() {
  const pathname = usePathname() ?? "";
  const { organization } = useSharedSessionAuth();

  if (!organization || organization.onboardingCompleted) return null;
  if (!shouldShow(pathname)) return null;

  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        New here? Follow the getting started guide to set up your workspace.
      </span>
      <Link href="/onboarding" className={styles.link}>
        Get Started
      </Link>
    </div>
  );
}
