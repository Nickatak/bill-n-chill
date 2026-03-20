import { buildAuthHeaders } from "@/shared/session/auth-headers";
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
  token: string;
  normalizedBaseUrl: string;
  canMutate: boolean;
  rows: CustomerRow[];
  setStatusMessage: (message: string) => void;
};

export function useProjectCreator({
  token,
  normalizedBaseUrl,
  canMutate,
  rows,
  setStatusMessage,
}: UseProjectCreatorOptions) {
  const router = useRouter();

  const [customerId, setCustomerId] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectSiteAddress, setProjectSiteAddress] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatusValue>("prospect");

  const customer =
    customerId === null
      ? null
      : rows.find((entry) => entry.id === customerId) ?? null;

  /** Open the project creation modal, pre-filling name and address from the customer. */
  function open(target: CustomerRow) {
    setCustomerId(target.id);
    setProjectName(`${target.display_name} Project`);
    setProjectSiteAddress(target.billing_address ?? "");
    setProjectStatus("prospect");
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
  }

  /** POST a new project under the selected customer, then navigate to its workspace. */
  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMutate) {
      setStatusMessage("Your role is read-only for project creation.");
      return;
    }
    if (!customerId) {
      setStatusMessage("Select a customer first.");
      return;
    }
    if (!projectName.trim()) {
      setStatusMessage("Project name is required.");
      return;
    }
    if (!projectSiteAddress.trim()) {
      setStatusMessage("Site address is required.");
      return;
    }

    setStatusMessage("");
    try {
      const response = await fetch(`${normalizedBaseUrl}/customers/${customerId}/projects/`, {
        method: "POST",
        headers: buildAuthHeaders(token, { contentType: "application/json" }),
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
        setStatusMessage(
          payload.error?.message ?? fieldMessage ?? "Could not create project for this customer.",
        );
        return;
      }

      const createdProject = payload.data?.project;
      if (!createdProject) {
        setStatusMessage("Project created, but response payload was incomplete.");
        close();
        return;
      }

      close();
      setStatusMessage(`Created project #${createdProject.id}. Opening project workspace...`);
      router.push(`/projects?project=${createdProject.id}`);
    } catch {
      setStatusMessage("Could not reach customer project creation endpoint.");
    }
  }

  return {
    isOpen,
    customer,
    projectName,
    setProjectName,
    projectSiteAddress,
    setProjectSiteAddress,
    projectStatus,
    setProjectStatus,
    open,
    close,
    handleCreate,
  };
}
