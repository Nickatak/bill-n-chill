"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isRouteActive, workflowRoutes } from "./nav-routes";

export function WorkflowNavbar() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="workflowNav" aria-label="MVP workflow order">
      <div className="workflowNavInner">
        <div className="workflowNavScroll">
          {workflowRoutes.map((route) => {
            const isActive = isRouteActive(pathname, route);
            return (
              <Link
                key={route.href}
                href={route.href}
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
