"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const workflowRoutes = [
  { href: "/intake/quick-add", label: "1 Intake" },
  { href: "/projects", label: "2 Projects" },
  { href: "/estimates-placeholder", label: "3 Estimates" },
  { href: "/budgets-placeholder", label: "4 Budgets" },
  { href: "/change-orders", label: "5 Change Orders" },
  { href: "/invoices", label: "6 Invoices" },
  { href: "/vendor-bills-placeholder", label: "7 Vendor Bills" },
  { href: "/expenses-placeholder", label: "8 Expenses" },
  { href: "/payments", label: "9 Payments" },
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
            const isActive =
              route.href === "/estimates-placeholder"
                ? pathname === "/estimates-placeholder" ||
                  pathname === "/estimates" ||
                  pathname.startsWith("/estimates/")
                : route.href === "/budgets-placeholder"
                  ? pathname === "/budgets-placeholder" || pathname === "/budgets"
                : route.href === "/vendor-bills-placeholder"
                  ? pathname === "/vendor-bills-placeholder" || pathname === "/vendor-bills"
                : route.href === "/expenses-placeholder"
                  ? pathname === "/expenses-placeholder" || pathname === "/expenses"
                : pathname === route.href;
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
