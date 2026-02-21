"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, workflowRoutes } from "./nav-routes";

export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";
  const pathProjectMatch = pathname.match(/^\/projects\/(\d+)(?:\/|$)/);
  const projectId = pathProjectMatch?.[1] ?? null;

  return (
    <nav className="workflowNav" aria-label="MVP workflow order">
      <div className="workflowNavInner">
        <div className="workflowNavScroll">
          {workflowRoutes.map((route) => {
            const isActive = isRouteActive(pathname, route);
            const href =
              route.href === "/change-orders" && projectId
                ? `/projects/${encodeURIComponent(projectId)}/change-orders`
                : route.href;
            return (
              <Link
                key={route.href}
                href={href}
                className={`workflowLink ${isActive ? "isActive" : ""}`}
              >
                {route.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
