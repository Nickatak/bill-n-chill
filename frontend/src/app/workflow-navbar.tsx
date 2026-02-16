"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const workflowRoutes = [
  { href: "/intake/quick-add", label: "1 Intake" },
  { href: "/projects", label: "2 Projects" },
  { href: "/cost-codes", label: "3 Cost Codes" },
  { href: "/estimates", label: "4 Estimates" },
  { href: "/budgets", label: "5 Budgets" },
  { href: "/change-orders", label: "6 Change Orders" },
  { href: "/invoices", label: "7 Invoices" },
  { href: "/vendors", label: "8 Vendors" },
  { href: "/vendor-bills", label: "9 Vendor Bills" },
  { href: "/payments", label: "10 Payments" },
];

export function WorkflowNavbar() {
  const pathname = usePathname();

  return (
    <nav className="workflowNav" aria-label="MVP workflow order">
      <div className="workflowNavInner">
        <div className="workflowNavScroll">
          <Link
            href="/"
            className={`workflowLink ${pathname === "/" ? "isActive" : ""}`}
          >
            Home
          </Link>
          {workflowRoutes.map((route) => {
            const isActive = pathname === route.href;
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
