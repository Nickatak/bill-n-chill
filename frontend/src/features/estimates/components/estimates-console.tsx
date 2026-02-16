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
  EstimateRecord,
  EstimateStatusEventRecord,
  ProjectRecord,
} from "../types";

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

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);
  const selectedProject =
    projects.find((project) => String(project.id) === selectedProjectId) ?? null;

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
  const orderedEstimates = useMemo(
    () => [...estimates].sort((a, b) => a.version - b.version),
    [estimates],
  );

  function formatMoney(value: number): string {
    return value.toFixed(2);
  }

  function formatDateInput(date: Date): string {
    return date.toISOString().slice(0, 10);
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
        setSelectedEstimateId(String(rows[0].id));
        setSelectedStatus(rows[0].status);
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
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    const hasMissingCostCode = lineItems.some((line) => !line.costCodeId);
    if (hasMissingCostCode) {
      setStatusMessage("Every line item must have a cost code.");
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
          title: estimateTitle,
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
      setSelectedEstimateId(String(created.id));
      setSelectedStatus(created.status);
      setStatusEvents([]);
      setStatusMessage(`Created estimate #${created.id} v${created.version}.`);
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
      setSelectedEstimateId(String(cloned.id));
      setSelectedStatus(cloned.status);
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
        <div className={styles.toolbarActions}>
          <button type="button" className={styles.secondaryButton} onClick={loadDependencies}>
            Reload Projects + Cost Codes
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={loadEstimates}
            disabled={!selectedProjectId}
          >
            Reload Estimates
          </button>
        </div>
      </div>

      <p className={styles.authMessage}>{authMessage}</p>
      {statusMessage ? <p className={styles.statusMessage}>{statusMessage}</p> : null}

      <form className={styles.sheet} onSubmit={handleCreateEstimate}>
        <div className={styles.sheetHeader}>
          <div className={styles.fromBlock}>
            <span className={styles.blockLabel}>From</span>
            <p className={styles.blockText}>Your Company</p>
            <p className={styles.blockMuted}>Your Address 1234</p>
            <p className={styles.blockMuted}>City, ST 12345</p>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.logoBox}>Upload Logo</div>
            <div className={styles.sheetTitle}>Estimate</div>
          </div>
        </div>

        <div className={styles.partyGrid}>
          <div className={styles.toBlock}>
            <span className={styles.blockLabel}>To</span>
            {projects.length > 0 ? (
              <label className={styles.inlineField}>
                Project
                <select
                  className={styles.fieldSelect}
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
            <div className={styles.metaLine}>
              <span>Customer</span>
              <span>{selectedProject?.customer_display_name ?? "Customer name"}</span>
            </div>
            <div className={styles.metaLine}>
              <span>Status</span>
              <span>{selectedProject?.status ?? "-"}</span>
            </div>
          </div>

          <div className={styles.metaBlock}>
            <div className={styles.metaTitle}>Estimate Details</div>
            <label className={styles.inlineField}>
              Estimate title
              <input
                className={styles.fieldInput}
                value={estimateTitle}
                onChange={(event) => setEstimateTitle(event.target.value)}
                required
              />
            </label>
            <div className={styles.metaLine}>
              <span>Estimate #</span>
              <span>{selectedEstimateId ? `#${selectedEstimateId}` : "Draft"}</span>
            </div>
            <div className={styles.metaLine}>
              <span>Estimate date</span>
              <input
                className={styles.fieldInput}
                type="date"
                value={estimateDate}
                readOnly
                aria-readonly="true"
              />
            </div>
            <div className={styles.metaLine}>
              <span>Due date</span>
              <input
                className={styles.fieldInput}
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
          </div>
        </div>

        {costCodes.length === 0 ? (
          <p className={styles.inlineHint}>
            Cost codes are required for line items. Create them on the Cost Codes page.
          </p>
        ) : null}

        <div className={styles.lineTable}>
          <div className={styles.lineHeader}>
            <span>Qty</span>
            <span>Description</span>
            <span>Cost Code</span>
            <span>Unit</span>
            <span>Unit Price</span>
            <span>Markup</span>
            <span>Amount</span>
            <span>Actions</span>
          </div>
          {lineItems.map((line, index) => (
            <div key={line.localId} className={styles.lineRow}>
              <input
                className={styles.lineInput}
                aria-label="Quantity"
                value={line.quantity}
                onChange={(event) => updateLineItem(line.localId, "quantity", event.target.value)}
                inputMode="decimal"
                required
              />
              <input
                className={styles.lineInput}
                aria-label="Description"
                value={line.description}
                onChange={(event) =>
                  updateLineItem(line.localId, "description", event.target.value)
                }
                required
              />
              <select
                className={styles.lineSelect}
                aria-label="Cost code"
                value={line.costCodeId}
                onChange={(event) => updateLineItem(line.localId, "costCodeId", event.target.value)}
                required
              >
                <option value="">Select</option>
                {costCodes.map((code) => (
                  <option key={code.id} value={code.id}>
                    {code.code} - {code.name}
                  </option>
                ))}
              </select>
              <input
                className={styles.lineInput}
                aria-label="Unit"
                value={line.unit}
                onChange={(event) => updateLineItem(line.localId, "unit", event.target.value)}
                required
              />
              <input
                className={styles.lineInput}
                aria-label="Unit cost"
                value={line.unitCost}
                onChange={(event) => updateLineItem(line.localId, "unitCost", event.target.value)}
                inputMode="decimal"
                required
              />
              <div className={styles.percentField}>
                <input
                  className={styles.lineInput}
                  aria-label="Markup percent"
                  value={line.markupPercent}
                  onChange={(event) =>
                    updateLineItem(line.localId, "markupPercent", event.target.value)
                  }
                  inputMode="decimal"
                  required
                />
                <span className={styles.percentSuffix}>%</span>
              </div>
              <div className={styles.amountCell}>${formatMoney(lineTotals[index] || 0)}</div>
              <div className={styles.lineActionsCell}>
                <button
                  type="button"
                  className={styles.smallButton}
                  onClick={() => moveLineItem(line.localId, "up")}
                  disabled={index === 0}
                >
                  Up
                </button>
                <button
                  type="button"
                  className={styles.smallButton}
                  onClick={() => moveLineItem(line.localId, "down")}
                  disabled={index === lineItems.length - 1}
                >
                  Down
                </button>
                <button
                  type="button"
                  className={styles.smallButton}
                  onClick={() => duplicateLineItem(line.localId)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={() => removeLineItem(line.localId)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.lineActions}>
          <button type="button" className={styles.secondaryButton} onClick={addLineItem}>
            Add Line Item
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={!canCreateEstimate || isSubmitting}
          >
            {isSubmitting ? "Creating..." : "Create Estimate"}
          </button>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>${formatMoney(subtotal)}</span>
          </div>
          <div className={styles.summaryRow}>
            <span>Sales Tax</span>
            <div className={styles.summaryTaxLine}>
              <input
                className={styles.summaryTaxInput}
                value={taxPercent}
                onChange={(event) => setTaxPercent(event.target.value)}
                inputMode="decimal"
                aria-label="Sales tax percent"
              />
              <span className={styles.summaryTaxSuffix}>%</span>
              <span>${formatMoney(taxAmount)}</span>
            </div>
          </div>
          <div className={`${styles.summaryRow} ${styles.summaryTotal}`}>
            <span>Total</span>
            <span>${formatMoney(totalAmount)}</span>
          </div>
        </div>

        <div className={styles.terms}>
          <h4>Terms and Conditions</h4>
          <p>Payment is due within 14 days of project completion.</p>
          <p>All checks to be made out to __________________.</p>
          <p>Thank you for your business.</p>
        </div>

        <div className={styles.footer}>
          <span>Tel: +1 234 567 8901</span>
          <span>Email: company@email.com</span>
          <span>Web: company.com</span>
        </div>
      </form>

      <section className={styles.lifecycle}>
        <h3>Estimate Versions & Status</h3>

        {estimates.length > 0 ? (
          <label className={styles.lifecycleField}>
            Estimate version
            <select
              value={selectedEstimateId}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedEstimateId(nextId);
                const selected = estimates.find((estimate) => String(estimate.id) === nextId);
                if (selected) setSelectedStatus(selected.status);
                setStatusEvents([]);
              }}
            >
              {estimates.map((estimate) => (
                <option key={estimate.id} value={estimate.id}>
                  #{estimate.id} v{estimate.version} - {estimate.title} ({estimate.status})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className={styles.inlineHint}>No estimate versions loaded yet.</p>
        )}

        <div className={styles.lifecycleActions}>
          <button type="button" onClick={handleCloneEstimate} disabled={!selectedEstimateId}>
            Clone Selected Estimate Version
          </button>
        </div>

        <div className={styles.versionTree}>
          {orderedEstimates.length > 0 ? (
            orderedEstimates.map((estimate) => {
              const isActive = String(estimate.id) === selectedEstimateId;
              const total = formatMoney(toNumber(estimate.grand_total || "0"));
              return (
                <div key={estimate.id} className={styles.timelineRow}>
                  <div className={styles.timelineColumn}>
                    <span
                      className={`${styles.timelineDot} ${isActive ? styles.timelineDotActive : ""}`}
                    />
                    <span className={styles.timelineLine} />
                  </div>
                  <button
                    type="button"
                    className={`${styles.versionNode} ${isActive ? styles.versionNodeActive : ""}`}
                    onClick={() => {
                      setSelectedEstimateId(String(estimate.id));
                      setSelectedStatus(estimate.status);
                      setStatusEvents([]);
                    }}
                  >
                    <div>
                      <span className={styles.versionTitle}>
                        v{estimate.version} {estimate.title || "Untitled"}
                      </span>
                      <span className={styles.versionMeta}>Estimate #{estimate.id}</span>
                    </div>
                    <div className={styles.versionRight}>
                      <span className={styles.versionStatus}>{estimate.status}</span>
                      <span className={styles.versionAmount}>${total}</span>
                    </div>
                  </button>
                </div>
              );
            })
          ) : (
            <p className={styles.inlineHint}>No estimate versions loaded yet.</p>
          )}
        </div>

        <div className={styles.lifecycleGrid}>
          <label className={styles.lifecycleField}>
            Next status
            <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value)}>
              <option value="draft">draft</option>
              <option value="sent">sent</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className={styles.lifecycleField}>
            Status note
            <input
              value={statusNote}
              onChange={(event) => setStatusNote(event.target.value)}
              placeholder="Optional note for this transition"
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
    </section>
  );
}
