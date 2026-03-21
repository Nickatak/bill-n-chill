/**
 * Project creation modal lifecycle hook.
 *
 * Owns the create-project modal state: open/close, form fields, POST
 * mutation, and navigation to the new project workspace on success.
 * Pre-fills project name and site address from the selected customer.
 *
 * Consumer: CustomersConsole (composed alongside useCustomerListFetch).
 *
 * ## State (useState)
 *
 * - customerId         — ID of the customer the project is being created for
 * - isOpen             — modal visibility flag
 * - projectName        — editable project name (pre-filled from customer)
 * - projectSiteAddress — editable site address (pre-filled from billing address)
 * - projectStatus      — "prospect" | "active"
 *
 * ## Functions
 *
 * - open(customer)
 *     Pre-fills form from the CustomerRow and shows the modal.
 *
 * - close()
 *     Hides the modal.
 *
 * - handleCreate(event)
 *     POSTs the project, then navigates to the project workspace.
 */

import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import { useBackdropDismiss } from "@/shared/hooks/use-backdrop-dismiss";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import type { ProjectRecord } from "@/features/projects/types";
import type { CustomerRow } from "../types";

type ProjectStatusValue = "prospect" | "active";

type ProjectCreateApiResponse = {
  data?: {
    project?: ProjectRecord;
  };
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
};

type UseProjectCreatorOptions = {
  authToken: string;
  canMutate: boolean;
  customerRows: CustomerRow[];
  setStatusMessage: (message: string) => void;
};

/**
 * Manage the create-project modal lifecycle: open, populate, POST, navigate.
 *
 * @param options - Auth token, RBAC flag, and list state handles from the console.
 * @returns Modal state, form fields + setters, and lifecycle helpers.
 */
export function useProjectCreator({
  authToken,
  canMutate,
  customerRows,
  setStatusMessage,
}: UseProjectCreatorOptions) {
  const router = useRouter();

  // --- State ---

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectSiteAddress, setProjectSiteAddress] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");
  const [formMessage, setFormMessage] = useState("");

  const customer =
    customerId === null
      ? null
      : customerRows.find((entry) => entry.id === customerId) ?? null;

  // --- Functions ---

  /** Open the project creation modal, pre-filling name and address from the customer. */
  function open(target: CustomerRow) {
    setCustomerId(target.id);
    setProjectName(`${target.display_name} Project`);
    setProjectSiteAddress(target.billing_address ?? "");
    setProjectStatus("prospect");
    setFormMessage("");
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  const backdropDismiss = useBackdropDismiss(close);

  /** POST a new project under the selected customer, then navigate to its workspace. */
  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      setFormMessage("Your role is read-only for project creation.");
      return;
    }
    if (!customerId) {
      setFormMessage("Select a customer first.");
      return;
    }
    if (!projectName.trim()) {
      setFormMessage("Project name is required.");
      return;
    }
    if (!projectSiteAddress.trim()) {
      setFormMessage("Site address is required.");
      return;
    }

    setFormMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}/customers/${customerId}/projects/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          name: projectName,
          site_address: projectSiteAddress,
          status: projectStatus,
        }),
      });
      const payload: ProjectCreateApiResponse = await response.json();
      if (!response.ok) {
        const fieldMessage = payload.error?.fields
          ? Object.values(payload.error.fields).flat()[0]
          : undefined;
        setFormMessage(
          payload.error?.message ?? fieldMessage ?? "Could not create project for this customer.",
        );
        return;
      }

      const createdProject = payload.data?.project;
      if (!createdProject) {
        setFormMessage("Project created, but response payload was incomplete.");
        close();
        return;
      }

      close();
      setStatusMessage(`Created project #${createdProject.id}. Opening project workspace...`);
      router.push(`/projects?project=${createdProject.id}`);
    } catch {
      setFormMessage("Could not reach customer project creation endpoint.");
    }
  }

  // --- Return bag ---

  return {
    // State
    isOpen,
    customer,
    projectName,
    projectSiteAddress,
    projectStatus,
    formMessage,
    backdropDismiss,

    // Setters
    setProjectName,
    setProjectSiteAddress,
    setProjectStatus,

    // Helpers
    open,
    close,
    handleCreate,
  };
}
