import { redirect } from "next/navigation";

/**
 * Legacy /invoices route — redirects to /projects.
 * Invoices are now project-scoped at /projects/[projectId]/invoices.
 */
export default function InvoicesRedirect() {
  redirect("/projects");
}
