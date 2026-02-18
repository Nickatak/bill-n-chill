"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { loadClientSession } from "../../session/client-session";
import styles from "./estimates-console.module.css";
import { useRouter } from "next/navigation";
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
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("Checking session...");
  const [statusMessage, setStatusMessage] = useState("");

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
  const [nextLineId, setNextLineId] = useState(2);
  const [estimateDate, setEstimateDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitGuard = useRef(false);
  const [openFamilyHistory, setOpenFamilyHistory] = useState<Set<string>>(() => new Set());

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
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
    { value: "archived", label: "Archived" },
  ];

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
    setSelectedEstimateId(String(estimate.id));
    setSelectedStatus(estimate.status);
    setStatusEvents([]);
    loadEstimateIntoForm(estimate);
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
    setNextLineId(2);
    setEstimateDate("");
    setDueDate("");
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
        setSelectedProjectId(String(projectRows[0].id));
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
  }, [normalizedBaseUrl, token]);

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
      setStatusMessage("Select an estimate first.");
      return;
    }

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
      setEstimates((current) => [cloned, ...current]);
      handleSelectEstimate(cloned);
      setStatusEvents([]);
      setStatusMessage(`Cloned estimate to version ${cloned.version}.`);
    } catch {
      setStatusMessage("Could not reach clone endpoint.");
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

  async function loadStatusEvents() {
    const estimateId = Number(selectedEstimateId);
    if (!estimateId) {
      setStatusMessage("Select an estimate first.");
      return;
    }

    setStatusMessage("Loading status events...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/estimates/${estimateId}/status-events/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Failed loading status events.");
        return;
      }
      const rows = (payload.data as EstimateStatusEventRecord[]) ?? [];
      setStatusEvents(rows);
      setStatusMessage(`Loaded ${rows.length} status event(s).`);
    } catch {
      setStatusMessage("Could not reach status events endpoint.");
    }
  }

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
        {projects.length > 0 ? (
          <label className={styles.lifecycleField}>
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  #{project.id} - {project.name} ({project.customer_display_name})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.inlineHint}>
            No projects yet. Create one from Intake so we can bill against it.
          </p>
        )}
      </div>

      <section className={styles.lifecycle}>
        <h3>Estimate Versions & Status</h3>

        <div className={styles.lifecycleActions}>
          <button type="button" onClick={startNewEstimate}>
            Add New Estimate
          </button>
          <button type="button" onClick={handleCloneEstimate} disabled={!selectedEstimateId}>
            Clone Selected Estimate Version
          </button>
        </div>

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
                      className={styles.familyMain}
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
                          return (
                            <button
                              key={estimate.id}
                              type="button"
                              className={styles.historyCard}
                              onClick={() => handleSelectEstimate(estimate)}
                            >
                              <span className={styles.historyVersion}>v{estimate.version}</span>
                              <span className={styles.historyMeta}>
                                #{estimate.id} · {estimate.status}
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
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.statusPill} ${
                      isSelected ? statusClasses[option.value] ?? "" : styles.statusPillInactive
                    } ${isSelected ? styles.statusPillActive : ""}`}
                    onClick={() => setSelectedStatus(option.value)}
                    aria-pressed={isSelected}
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
          <button type="button" onClick={loadStatusEvents} disabled={!selectedEstimateId}>
            Load Status Events
          </button>
        </div>

        {statusEvents.length > 0 ? (
          <div className={styles.statusEvents}>
            <h4>Status Events</h4>
            <ul>
              {statusEvents.map((event) => (
                <li key={event.id}>
                  {event.from_status ?? "none"} -&gt; {event.to_status} by {event.changed_by_email} at{" "}
                  {new Date(event.changed_at).toLocaleString()}
                  {event.note ? ` (${event.note})` : ""}
                </li>
              ))}
            </ul>
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
        onTitleChange={setEstimateTitle}
        onDueDateChange={setDueDate}
        onTaxPercentChange={setTaxPercent}
        onLineItemChange={updateLineItem}
        onAddLineItem={addLineItem}
        onMoveLineItem={moveLineItem}
        onDuplicateLineItem={duplicateLineItem}
        onRemoveLineItem={removeLineItem}
        onSubmit={handleCreateEstimate}
      />
    </section>
  );
}
