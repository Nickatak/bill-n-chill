"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { loadClientSession } from "../../session/client-session";
import styles from "./estimates-console.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiResponse,
  CostCode,
  EstimateLineInput,
  EstimateLineItemRecord,
  EstimateRecord,
  EstimateStatusEventRecord,
  ProjectRecord,
} from "../types";
import { EstimateSheet } from "./estimate-sheet";

type LineSortKey = "quantity" | "costCode" | "unitCost" | "markupPercent" | "amount";

function emptyLine(localId: number, defaultCostCodeId = ""): EstimateLineInput {
  return {
    localId,
    costCodeId: defaultCostCodeId,
    description: "Scope item",
    quantity: "1",
    unit: "ea",
    unitCost: "0",
    markupPercent: "0",
  };
}

export function EstimatesConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking session...");
  const [statusMessage, setStatusMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [costCodes, setCostCodes] = useState<CostCode[]>([]);

  const [estimates, setEstimates] = useState<EstimateRecord[]>([]);
  const [selectedEstimateId, setSelectedEstimateId] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("draft");
  const [statusNote, setStatusNote] = useState("");
  const [statusEvents, setStatusEvents] = useState<EstimateStatusEventRecord[]>([]);

  const [estimateTitle, setEstimateTitle] = useState("Initial Estimate");
  const [taxPercent, setTaxPercent] = useState("0");
  const [lineItems, setLineItems] = useState<EstimateLineInput[]>([emptyLine(1)]);
  const [lineSortKey, setLineSortKey] = useState<LineSortKey | null>(null);
  const [lineSortDirection, setLineSortDirection] = useState<"asc" | "desc">("asc");
  const [nextLineId, setNextLineId] = useState(2);
  const [estimateDate, setEstimateDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitGuard = useRef(false);
  const [openFamilyHistory, setOpenFamilyHistory] = useState<Set<string>>(() => new Set());
  const [showDuplicatePanel, setShowDuplicatePanel] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState("");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const scopedProjectIdParam = searchParams.get("project");
  const scopedProjectId =
    scopedProjectIdParam && /^\d+$/.test(scopedProjectIdParam)
      ? Number(scopedProjectIdParam)
      : null;
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;
  const selectedEstimate =
    estimates.find((estimate) => String(estimate.id) === selectedEstimateId) ?? null;
  const isEditingDraft = Boolean(selectedEstimate && selectedEstimate.status === "draft");
  const isReadOnly = Boolean(selectedEstimate && selectedEstimate.status !== "draft");
  const statusClasses: Record<string, string> = {
    draft: styles.statusDraft,
    sent: styles.statusSent,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    archived: styles.statusArchived,
  };
  const statusOptions = [
    { value: "draft", label: "Draft" },
    { value: "sent", label: "Sent" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ];
  const allowedStatusTransitions: Record<string, string[]> = {
    draft: ["sent"],
    sent: ["approved", "rejected"],
    approved: [],
    rejected: ["draft"],
    archived: [],
  };
  const revisableStatuses = new Set(["sent", "rejected"]);
  const canCreateRevision = Boolean(
    selectedEstimate && revisableStatuses.has(selectedEstimate.status),
  );
  const selectableStatuses = !selectedEstimate
    ? new Set(statusOptions.map((option) => option.value))
    : new Set([
        selectedEstimate.status,
        ...(allowedStatusTransitions[selectedEstimate.status] ?? []),
      ]);

  function toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const lineTotals = useMemo(
    () =>
      lineItems.map((line) => {
        const quantity = toNumber(line.quantity);
        const unitCost = toNumber(line.unitCost);
        const markup = toNumber(line.markupPercent);
        const base = quantity * unitCost;
        return base + base * (markup / 100);
      }),
    [lineItems],
  );

  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const taxRate = toNumber(taxPercent);
  const taxAmount = subtotal * (taxRate / 100);
  const totalAmount = subtotal + taxAmount;
  const estimateFamilies = useMemo(() => {
    const families = new Map<string, EstimateRecord[]>();
    for (const estimate of estimates) {
      const title = (estimate.title || "").trim() || "Untitled";
      const existing = families.get(title);
      if (existing) {
        existing.push(estimate);
      } else {
        families.set(title, [estimate]);
      }
    }
    return Array.from(families.entries()).map(([title, items]) => ({
      title,
      items: [...items].sort((a, b) => a.version - b.version),
    }));
  }, [estimates]);

  function formatMoney(value: number): string {
    return value.toFixed(2);
  }

  function formatDateInput(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  function formatDateFromIso(dateValue?: string): string {
    if (!dateValue) {
      return "";
    }
    const parsed = new Date(dateValue);
    if (Number.isNaN(parsed.getTime())) {
      return "";
    }
    return formatDateInput(parsed);
  }

  function mapLineItemsToInputs(items: EstimateLineItemRecord[] = []): EstimateLineInput[] {
    if (!items.length) {
      return [emptyLine(1)];
    }
    return items.map((item, index) => ({
      localId: index + 1,
      costCodeId: String(item.cost_code ?? ""),
      description: item.description || "",
      quantity: String(item.quantity ?? ""),
      unit: item.unit || "ea",
      unitCost: String(item.unit_cost ?? ""),
      markupPercent: String(item.markup_percent ?? ""),
    }));
  }

  function loadEstimateIntoForm(estimate: EstimateRecord) {
    setEstimateTitle(estimate.title || "Untitled");
    setTaxPercent(String(estimate.tax_percent ?? "0"));
    const mapped = mapLineItemsToInputs(estimate.line_items ?? []);
    setLineItems(mapped);
    setNextLineId(mapped.length + 1);
    const createdDate = formatDateFromIso(estimate.created_at);
    if (createdDate) {
      setEstimateDate(createdDate);
    }
  }

  function handleSelectEstimate(estimate: EstimateRecord) {
    const nextEstimateId = String(estimate.id);
    const isSameEstimate = nextEstimateId === selectedEstimateId;
    setSelectedEstimateId(nextEstimateId);
    setSelectedStatus(estimate.status);
    if (!isSameEstimate) {
      setStatusEvents([]);
    }
    setLineSortKey(null);
    setLineSortDirection("asc");
    loadEstimateIntoForm(estimate);
    setDuplicateTitle(`${estimate.title || "Estimate"} Copy`);
  }

  function startNewEstimate() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setSelectedEstimateId("");
    setSelectedStatus("draft");
    setStatusNote("");
    setStatusEvents([]);
    setEstimateTitle("New Estimate");
    setTaxPercent("0");
    setLineItems([emptyLine(1, defaultCostCodeId)]);
    setLineSortKey(null);
    setLineSortDirection("asc");
    setNextLineId(2);
    setEstimateDate("");
    setDueDate("");
    setShowDuplicatePanel(false);
    setActionMessage("");
  }

  function toggleFamilyHistory(title: string) {
    setOpenFamilyHistory((current) => {
      const next = new Set(current);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }

  useEffect(() => {
    const session = loadClientSession();
    if (!session?.token) {
      setToken("");
      setAuthMessage("No shared session found. Go to / and login first.");
      return;
    }
    setToken(session.token);
    setAuthMessage(`Using shared session for ${session.email || "user"}.`);
  }, []);

  useEffect(() => {
    if (estimateDate) {
      return;
    }
    const today = new Date();
    const due = new Date();
    due.setDate(due.getDate() + 14);
    setEstimateDate(formatDateInput(today));
    setDueDate(formatDateInput(due));
  }, [estimateDate]);

  const loadDependencies = useCallback(async () => {
    setStatusMessage("Loading projects and cost codes...");
    try {
      const [projectsRes, codesRes] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: { Authorization: `Token ${token}` },
        }),
        fetch(`${normalizedBaseUrl}/cost-codes/`, {
          headers: { Authorization: `Token ${token}` },
        }),
      ]);

      const projectsJson: ApiResponse = await projectsRes.json();
      const codesJson: ApiResponse = await codesRes.json();

      if (!projectsRes.ok || !codesRes.ok) {
        setStatusMessage("Failed loading dependencies.");
        return;
      }

      const projectRows = (projectsJson.data as ProjectRecord[]) ?? [];
      const codeRows = ((codesJson.data as CostCode[]) ?? []).filter((code) => code.is_active);
      setProjects(projectRows);
      setCostCodes(codeRows);

      if (projectRows[0]) {
        const scopedMatch = scopedProjectId
          ? projectRows.find((project) => project.id === scopedProjectId)
          : null;
        setSelectedProjectId(String(scopedMatch?.id ?? projectRows[0].id));
      } else {
        setSelectedProjectId("");
      }

      if (codeRows[0]) {
        const defaultCostCodeId = String(codeRows[0].id);
        setLineItems((current) =>
          current.map((line) =>
            line.costCodeId ? line : { ...line, costCodeId: defaultCostCodeId },
          ),
        );
      }

      setStatusMessage(
        `Loaded ${projectRows.length} project(s) and ${codeRows.length} cost code(s).`,
      );
    } catch {
      setStatusMessage("Could not reach dependency endpoints.");
    }
  }, [normalizedBaseUrl, scopedProjectId, token]);

  const loadEstimates = useCallback(async () => {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading estimates...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Failed loading estimates.");
        return;
      }
      const rows = (payload.data as EstimateRecord[]) ?? [];
      setEstimates(rows);
      if (rows[0]) {
        handleSelectEstimate(rows[0]);
      }
      setStatusMessage(`Loaded ${rows.length} estimate version(s).`);
    } catch {
      setStatusMessage("Could not reach estimate endpoint.");
    }
  }, [normalizedBaseUrl, selectedProjectId, token]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadDependencies();
  }, [loadDependencies, token]);

  useEffect(() => {
    if (!token || !selectedProjectId) {
      return;
    }
    void loadEstimates();
  }, [loadEstimates, selectedProjectId, token]);

  useEffect(() => {
    if (!projects.length || !scopedProjectId) {
      return;
    }
    const scopedMatch = projects.find((project) => project.id === scopedProjectId);
    if (!scopedMatch) {
      return;
    }
    const nextId = String(scopedMatch.id);
    if (nextId !== selectedProjectId) {
      setSelectedProjectId(nextId);
    }
  }, [projects, scopedProjectId, selectedProjectId]);

  function addLineItem() {
    const defaultCostCodeId = costCodes[0] ? String(costCodes[0].id) : "";
    setLineItems((current) => [...current, emptyLine(nextLineId, defaultCostCodeId)]);
    setNextLineId((value) => value + 1);
  }

  function duplicateLineItem(localId: number) {
    const target = lineItems.find((line) => line.localId === localId);
    if (!target) {
      return;
    }
    setLineItems((current) => [...current, { ...target, localId: nextLineId }]);
    setNextLineId((value) => value + 1);
  }

  function moveLineItem(localId: number, direction: "up" | "down") {
    setLineItems((current) => {
      const index = current.findIndex((line) => line.localId === localId);
      if (index === -1) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
    setLineSortKey(null);
    setLineSortDirection("asc");
  }

  function removeLineItem(localId: number) {
    setLineItems((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((line) => line.localId !== localId);
    });
  }

  function updateLineItem(
    localId: number,
    key: keyof Omit<EstimateLineInput, "localId">,
    value: string,
  ) {
    setLineItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, [key]: value } : line)),
    );
  }

  function handleSortLineItems(key: LineSortKey) {
    if (isReadOnly) {
      return;
    }
    const nextDirection = lineSortKey === key && lineSortDirection === "asc" ? "desc" : "asc";
    const directionFactor = nextDirection === "asc" ? 1 : -1;

    function lineAmount(line: EstimateLineInput): number {
      const quantity = toNumber(line.quantity);
      const unitCost = toNumber(line.unitCost);
      const markup = toNumber(line.markupPercent);
      const base = quantity * unitCost;
      return base + base * (markup / 100);
    }

    function costCodeLabel(line: EstimateLineInput): string {
      const code = costCodes.find((candidate) => String(candidate.id) === line.costCodeId);
      if (!code) {
        return "";
      }
      return `${code.code} ${code.name}`.toLowerCase();
    }

    setLineItems((current) => {
      const sorted = [...current].sort((a, b) => {
        switch (key) {
          case "quantity":
            return (toNumber(a.quantity) - toNumber(b.quantity)) * directionFactor;
          case "unitCost":
            return (toNumber(a.unitCost) - toNumber(b.unitCost)) * directionFactor;
          case "markupPercent":
            return (toNumber(a.markupPercent) - toNumber(b.markupPercent)) * directionFactor;
          case "amount":
            return (lineAmount(a) - lineAmount(b)) * directionFactor;
          case "costCode":
            return costCodeLabel(a).localeCompare(costCodeLabel(b)) * directionFactor;
          default:
            return 0;
        }
      });
      return sorted;
    });
    setLineSortKey(key);
    setLineSortDirection(nextDirection);
  }

  const canCreateEstimate = useMemo(
    () => Boolean(selectedProjectId) && lineItems.length > 0,
    [lineItems.length, selectedProjectId],
  );

  async function handleCreateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitGuard.current) {
      return;
    }
    if (isReadOnly) {
      setStatusMessage("This estimate is read-only. Clone or add a new draft to edit.");
      return;
    }
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const trimmedTitle = estimateTitle.trim();
    if (!trimmedTitle) {
      setStatusMessage("Estimate title is required.");
      return;
    }

    const hasMissingCostCode = lineItems.some((line) => !line.costCodeId);
    if (hasMissingCostCode) {
      setStatusMessage("Every line item must have a cost code.");
      return;
    }

    if (isEditingDraft && selectedEstimate) {
      setStatusMessage("Saving draft changes...");
      submitGuard.current = true;
      setIsSubmitting(true);
      try {
        const response = await fetch(`${normalizedBaseUrl}/estimates/${selectedEstimate.id}/`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify({
            title: trimmedTitle,
            tax_percent: taxPercent,
            line_items: lineItems.map((line) => ({
              cost_code: Number(line.costCodeId),
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unit_cost: line.unitCost,
              markup_percent: line.markupPercent,
            })),
          }),
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          setStatusMessage("Save draft failed.");
          return;
        }
        const updated = payload.data as EstimateRecord;
        setEstimates((current) =>
          current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
        );
        loadEstimateIntoForm(updated);
        setStatusMessage(`Saved draft estimate #${updated.id}.`);
      } catch {
        setStatusMessage("Could not reach estimate update endpoint.");
      } finally {
        submitGuard.current = false;
        setIsSubmitting(false);
      }
      return;
    }

    setStatusMessage("Creating estimate...");
    submitGuard.current = true;
    setIsSubmitting(true);
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/estimates/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          title: trimmedTitle,
          tax_percent: taxPercent,
          line_items: lineItems.map((line) => ({
            cost_code: Number(line.costCodeId),
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_cost: line.unitCost,
            markup_percent: line.markupPercent,
          })),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Create estimate failed.");
        return;
      }
      const created = payload.data as EstimateRecord;
      setEstimates((current) => [created, ...current]);
      handleSelectEstimate(created);
      setStatusEvents([]);
      setStatusMessage(`Created estimate #${created.id} v${created.version}.`);
      loadEstimateIntoForm(created);
      router.push(`/estimates/post-create?estimate=${created.id}`);
    } catch {
      setStatusMessage("Could not reach estimate create endpoint.");
    } finally {
      submitGuard.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleCloneEstimate() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an existing estimate version before creating a revision.");
      setActionMessage("Select an existing estimate version before creating a revision.");
      return;
    }
    if (!canCreateRevision) {
      setStatusMessage("Revisions are only available for sent or rejected estimates.");
      setActionMessage("Revisions are only available for sent or rejected estimates.");
      return;
    }
    const sourceWasSent = selectedEstimate?.status === "sent";

    setStatusMessage("Cloning estimate version...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/clone-version/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({}),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Clone failed.");
        return;
      }
      const cloned = payload.data as EstimateRecord;
      setEstimates((current) => {
        const updated = current.map((estimate) =>
          sourceWasSent && estimate.id === estimateId
            ? { ...estimate, status: "rejected" }
            : estimate,
        );
        return [cloned, ...updated];
      });
      handleSelectEstimate(cloned);
      setStatusEvents([]);
      setStatusMessage(`Cloned estimate to version ${cloned.version}.`);
      setActionMessage("");
    } catch {
      setStatusMessage("Could not reach clone endpoint.");
    }
  }

  async function handleDuplicateEstimate() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      setActionMessage("Select an existing estimate version before duplicating.");
      return;
    }
    if (!duplicateTitle.trim()) {
      setStatusMessage("Duplicate title is required.");
      return;
    }

    setStatusMessage("Duplicating estimate as a new draft...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/duplicate/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          title: duplicateTitle.trim(),
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        const message = payload.error?.message ?? "Duplicate failed.";
        setStatusMessage(message);
        setActionMessage(message);
        return;
      }
      const duplicated = payload.data as EstimateRecord;
      if (String(duplicated.project) === selectedProjectId) {
        setEstimates((current) => [duplicated, ...current]);
      }
      if (String(duplicated.project) !== selectedProjectId) {
        setSelectedProjectId(String(duplicated.project));
      }
      handleSelectEstimate(duplicated);
      setShowDuplicatePanel(false);
      setStatusEvents([]);
      setStatusMessage(`Duplicated estimate to #${duplicated.id} v${duplicated.version} as draft.`);
      setActionMessage("");
    } catch {
      setStatusMessage("Could not reach duplicate endpoint.");
    }
  }

  async function handleUpdateEstimateStatus() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }

    setStatusMessage("Updating estimate status...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ status: selectedStatus, status_note: statusNote }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Status update failed.");
        return;
      }
      const updated = payload.data as EstimateRecord;
      setEstimates((current) =>
        current.map((estimate) => (estimate.id === updated.id ? updated : estimate)),
      );
      setStatusNote("");
      setStatusMessage(`Updated estimate #${updated.id} to ${updated.status}.`);
    } catch {
      setStatusMessage("Could not reach estimate status endpoint.");
    }
  }

  const loadStatusEvents = useCallback(
    async (options?: { estimateId?: number; quiet?: boolean }) => {
      const estimateId = options?.estimateId ?? Number(selectedEstimateId);
      const quiet = options?.quiet ?? false;
      if (!estimateId) {
        if (!quiet) {
          setStatusMessage("Select an estimate first.");
        }
        return;
      }

      if (!quiet) {
        setStatusMessage("Loading status events...");
      }
      try {
        const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/status-events/`, {
          headers: { Authorization: `Token ${token}` },
        });
        const payload: ApiResponse = await response.json();
        if (!response.ok) {
          if (!quiet) {
            setStatusMessage("Failed loading status events.");
          }
          return;
        }
        const rows = (payload.data as EstimateStatusEventRecord[]) ?? [];
        setStatusEvents(rows);
        if (!quiet) {
          setStatusMessage(`Loaded ${rows.length} status event(s).`);
        }
      } catch {
        if (!quiet) {
          setStatusMessage("Could not reach status events endpoint.");
        }
      }
    },
    [normalizedBaseUrl, selectedEstimateId, token],
  );

  useEffect(() => {
    if (!token || !selectedEstimateId) {
      return;
    }
    void loadStatusEvents({ quiet: true });
  }, [loadStatusEvents, selectedEstimateId, token]);

  return (
    <section className={styles.console}>
      <div className={styles.toolbar}>
        <div>
          <h2>Estimate Builder</h2>
          <p>One-page editor with smart defaults and quick project context.</p>
        </div>
      </div>

      <p className={styles.authMessage}>{authMessage}</p>
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      <div className={styles.estimateSelector}>
        {selectedProject ? (
          <>
            <p className={styles.scopeLabel}>Project Context</p>
            <p className={styles.scopeProjectName}>
              #{selectedProject.id} {selectedProject.name}
            </p>
            <p className={styles.scopeProjectMeta}>
              {selectedProject.customer_display_name} · {selectedProject.status}
            </p>
          </>
        ) : projects.length === 0 ? (
          <p className={styles.inlineHint}>
            No projects yet. Create one from Intake so we can bill against it.
          </p>
        ) : (
          <p className={styles.inlineHint}>
            No project selected. Open estimates from <code>/projects</code>.
          </p>
        )}
      </div>

      <section className={styles.lifecycle}>
        <h3>Estimate Versions & Status</h3>

        <div className={styles.lifecycleActions}>
          <button type="button" onClick={startNewEstimate}>
            Add New Estimate
          </button>
          <button
            type="button"
            onClick={() => {
              if (!selectedEstimate) {
                setStatusMessage("Select an existing estimate version before duplicating.");
                setActionMessage("Select an existing estimate version before duplicating.");
                return;
              }
              setDuplicateTitle(`${selectedEstimate.title || "Estimate"} Copy`);
              setShowDuplicatePanel((current) => !current);
            }}
          >
            Duplicate as New Estimate
          </button>
          <button
            type="button"
            onClick={handleCloneEstimate}
            title={
              selectedEstimate && !canCreateRevision
                ? "Revisions are only available for sent or rejected estimates."
                : undefined
            }
          >
            Create Revision From Selected
          </button>
        </div>
        {actionMessage ? <p className={styles.actionError}>{actionMessage}</p> : null}
        {showDuplicatePanel ? (
          <div className={styles.duplicatePanel}>
            <p className={styles.inlineHint}>
              Duplicating in project{" "}
              {selectedProject
                ? `#${selectedProject.id} - ${selectedProject.name} (${selectedProject.customer_display_name})`
                : "current selection"}.
            </p>
            <label className={styles.lifecycleField}>
              New estimate title
              <input
                value={duplicateTitle}
                onChange={(event) => setDuplicateTitle(event.target.value)}
                placeholder="Estimate title"
              />
            </label>
            <div className={styles.lifecycleActions}>
              <button type="button" onClick={handleDuplicateEstimate}>
                Confirm Duplicate
              </button>
              <button type="button" onClick={() => setShowDuplicatePanel(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className={styles.versionTree}>
          {estimateFamilies.length > 0 ? (
            estimateFamilies.map((family) => {
              const latest = family.items[family.items.length - 1];
              const history = family.items.slice(0, -1).reverse();
              const selectedInFamily = family.items.find(
                (estimate) => String(estimate.id) === selectedEstimateId,
              );
              const isFamilyActive = Boolean(selectedInFamily);
              const isViewingHistory =
                selectedInFamily && String(selectedInFamily.id) !== String(latest.id);
              const isLatestSelected = String(latest.id) === selectedEstimateId;
              const isHistoryOpen = openFamilyHistory.has(family.title);
              const latestTotal = formatMoney(toNumber(latest.grand_total || "0"));
              return (
                <div
                  key={family.title}
                  className={`${styles.familyGroup} ${
                    isFamilyActive ? styles.familyGroupActive : ""
                  }`}
                >
                  <div className={styles.familyRow}>
                    <button
                      type="button"
                      className={`${styles.familyMain} ${
                        isLatestSelected ? styles.familyMainActive : ""
                      }`}
                      onClick={() => handleSelectEstimate(latest)}
                    >
                      <div>
                        <span className={styles.familyTitle}>{family.title}</span>
                        <span className={styles.familyMeta}>
                          Estimate #{latest.id} · v{latest.version}
                        </span>
                      </div>
                      <div className={styles.versionRight}>
                        <span
                          className={`${styles.versionStatus} ${
                            statusClasses[latest.status] ?? ""
                          }`}
                        >
                          {latest.status}
                        </span>
                        <span className={styles.versionAmount}>${latestTotal}</span>
                      </div>
                    </button>
                    {isHistoryOpen && history.length > 0 ? (
                      <div className={styles.historyRow}>
                        {history.map((estimate) => {
                          const total = formatMoney(toNumber(estimate.grand_total || "0"));
                          const isSelected = String(estimate.id) === selectedEstimateId;
                          return (
                            <button
                              key={estimate.id}
                              type="button"
                              className={`${styles.historyCard} ${
                                isSelected ? styles.historyCardActive : ""
                              }`}
                              onClick={() => handleSelectEstimate(estimate)}
                            >
                              <span className={styles.historyVersion}>v{estimate.version}</span>
                              <span className={styles.historyMetaRow}>
                                <span className={styles.historyMeta}>#{estimate.id}</span>
                                <span
                                  className={`${styles.versionStatus} ${
                                    statusClasses[estimate.status] ?? ""
                                  } ${styles.historyStatus}`}
                                >
                                  {estimate.status}
                                </span>
                              </span>
                              <span className={styles.historyAmount}>${total}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.familyFooter}>
                    {history.length > 0 ? (
                      <button
                        type="button"
                        className={styles.historyToggle}
                        onClick={() => toggleFamilyHistory(family.title)}
                      >
                        {isHistoryOpen ? "Hide history" : "Show history"} ({history.length})
                      </button>
                    ) : (
                      <span className={styles.historyEmpty}>No history</span>
                    )}
                    {isViewingHistory ? (
                      <span className={styles.historyNotice}>
                        Viewing v{selectedInFamily?.version}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <p className={styles.inlineHint}>No estimate versions loaded yet.</p>
          )}
        </div>

        <div className={styles.lifecycleGrid}>
          <div className={styles.statusPicker}>
            <span className={styles.lifecycleFieldLabel}>Next status</span>
            <div className={styles.statusPills}>
              {statusOptions.map((option) => {
                const isSelected = selectedStatus === option.value;
                const isSelectable = selectableStatuses.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.statusPill} ${
                      isSelected ? statusClasses[option.value] ?? "" : styles.statusPillInactive
                    } ${isSelected ? styles.statusPillActive : ""} ${
                      !isSelectable ? styles.actionDisabled : ""
                    }`}
                    onClick={() => setSelectedStatus(option.value)}
                    aria-pressed={isSelected}
                    disabled={!isSelectable}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className={styles.lifecycleField}>
            Status note
            <textarea
              className={styles.statusNote}
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="Optional note for this transition"
              rows={3}
            />
          </label>
        </div>
        <div className={styles.lifecycleActions}>
          <button type="button" onClick={handleUpdateEstimateStatus} disabled={!selectedEstimateId}>
            Update Selected Estimate Status
          </button>
        </div>

        {statusEvents.length > 0 ? (
          <div className={styles.statusEvents}>
            <h4>Status Events</h4>
            <div className={styles.statusEventsTableWrap}>
              <table className={styles.statusEventsTable}>
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>By</th>
                    <th>When</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {statusEvents.map((event) => {
                    const fromStatus = event.from_status ?? "created";
                    const fromStatusClass = event.from_status
                      ? statusClasses[event.from_status] ?? ""
                      : styles.statusCreated;
                    const toStatusClass = statusClasses[event.to_status] ?? "";
                    return (
                      <tr key={event.id}>
                        <td>
                          <span className={`${styles.versionStatus} ${fromStatusClass}`}>
                            {fromStatus}
                          </span>
                        </td>
                        <td>
                          <span className={`${styles.versionStatus} ${toStatusClass}`}>
                            {event.to_status}
                          </span>
                        </td>
                        <td>{event.changed_by_email}</td>
                        <td>{new Date(event.changed_at).toLocaleString()}</td>
                        <td>{event.note || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>

      <EstimateSheet
        project={selectedProject}
        estimateId={selectedEstimateId}
        estimateTitle={estimateTitle}
        estimateDate={estimateDate}
        dueDate={dueDate}
        taxPercent={taxPercent}
        lineItems={lineItems}
        lineTotals={lineTotals}
        subtotal={subtotal}
        taxAmount={taxAmount}
        totalAmount={totalAmount}
        costCodes={costCodes}
        canSubmit={canCreateEstimate}
        isSubmitting={isSubmitting}
        isEditingDraft={isEditingDraft}
        readOnly={isReadOnly}
        lineSortKey={lineSortKey}
        lineSortDirection={lineSortDirection}
        onTitleChange={setEstimateTitle}
        onDueDateChange={setDueDate}
        onTaxPercentChange={setTaxPercent}
        onLineItemChange={updateLineItem}
        onAddLineItem={addLineItem}
        onMoveLineItem={moveLineItem}
        onDuplicateLineItem={duplicateLineItem}
        onRemoveLineItem={removeLineItem}
        onSortLineItems={handleSortLineItems}
        onSubmit={handleCreateEstimate}
      />
    </section>
  );
}
