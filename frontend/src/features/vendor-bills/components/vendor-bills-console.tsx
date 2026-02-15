"use client";

import { FormEvent, useMemo, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import {
  ApiResponse,
  ProjectRecord,
  UserData,
  VendorBillPayload,
  VendorBillRecord,
  VendorRecord,
} from "../types";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function dueDateIsoDate(daysFromNow = 30) {
  const current = new Date();
  current.setDate(current.getDate() + daysFromNow);
  return current.toISOString().slice(0, 10);
}

export function VendorBillsConsole() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [vendors, setVendors] = useState<VendorRecord[]>([]);
  const [vendorBills, setVendorBills] = useState<VendorBillRecord[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedVendorBillId, setSelectedVendorBillId] = useState("");

  const [newVendorId, setNewVendorId] = useState("");
  const [newBillNumber, setNewBillNumber] = useState("");
  const [newIssueDate, setNewIssueDate] = useState(todayIsoDate());
  const [newDueDate, setNewDueDate] = useState(dueDateIsoDate());
  const [newTotal, setNewTotal] = useState("0.00");
  const [newNotes, setNewNotes] = useState("");

  const [vendorId, setVendorId] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [issueDate, setIssueDate] = useState(todayIsoDate());
  const [dueDate, setDueDate] = useState(dueDateIsoDate());
  const [total, setTotal] = useState("0.00");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<
    "draft" | "received" | "approved" | "scheduled" | "paid" | "void"
  >("draft");
  const [duplicateOverrideOnSave, setDuplicateOverrideOnSave] = useState(false);

  const [duplicateCandidates, setDuplicateCandidates] = useState<VendorBillRecord[]>([]);
  const [pendingCreatePayload, setPendingCreatePayload] = useState<VendorBillPayload | null>(null);

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(apiBaseUrl), [apiBaseUrl]);

  function hydrate(item: VendorBillRecord) {
    setVendorId(String(item.vendor));
    setBillNumber(item.bill_number);
    setIssueDate(item.issue_date);
    setDueDate(item.due_date);
    setTotal(item.total);
    setNotes(item.notes);
    setStatus(item.status);
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthMessage("Logging in...");

    try {
      const response = await fetch(`${normalizedBaseUrl}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload: ApiResponse = await response.json();
      const user = payload.data as UserData;
      if (!response.ok || !user?.token) {
        setAuthMessage("Login failed.");
        return;
      }
      setToken(user.token);
      setAuthMessage(`Logged in as ${user.email ?? email}.`);
    } catch {
      setAuthMessage("Could not reach login endpoint.");
    }
  }

  async function loadDependencies() {
    setStatusMessage("Loading projects and vendors...");

    try {
      const [projectsResponse, vendorsResponse] = await Promise.all([
        fetch(`${normalizedBaseUrl}/projects/`, {
          headers: { Authorization: `Token ${token}` },
        }),
        fetch(`${normalizedBaseUrl}/vendors/`, {
          headers: { Authorization: `Token ${token}` },
        }),
      ]);

      const projectsPayload: ApiResponse = await projectsResponse.json();
      const vendorsPayload: ApiResponse = await vendorsResponse.json();
      if (!projectsResponse.ok || !vendorsResponse.ok) {
        setStatusMessage("Could not load projects/vendors.");
        return;
      }

      const projectRows = (projectsPayload.data as ProjectRecord[]) ?? [];
      const vendorRows = (vendorsPayload.data as VendorRecord[]) ?? [];
      const activeVendors = vendorRows.filter((row) => row.is_active);
      setProjects(projectRows);
      setVendors(vendorRows);

      if (projectRows[0]) {
        setSelectedProjectId(String(projectRows[0].id));
      }
      if (activeVendors[0]) {
        setNewVendorId(String(activeVendors[0].id));
      } else if (vendorRows[0]) {
        setNewVendorId(String(vendorRows[0].id));
      }

      setStatusMessage(`Loaded ${projectRows.length} project(s) and ${vendorRows.length} vendor(s).`);
    } catch {
      setStatusMessage("Could not reach projects/vendors endpoints.");
    }
  }

  async function loadVendorBills() {
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }

    setStatusMessage("Loading vendor bills...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/vendor-bills/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Could not load vendor bills.");
        return;
      }

      const rows = (payload.data as VendorBillRecord[]) ?? [];
      setVendorBills(rows);
      if (rows[0]) {
        setSelectedVendorBillId(String(rows[0].id));
        hydrate(rows[0]);
      } else {
        setSelectedVendorBillId("");
      }
      setStatusMessage(`Loaded ${rows.length} vendor bill(s).`);
    } catch {
      setStatusMessage("Could not reach vendor-bills endpoint.");
    }
  }

  async function createVendorBill(
    payloadBody: VendorBillPayload,
    options?: { duplicate_override?: boolean },
  ) {
    const response = await fetch(
      `${normalizedBaseUrl}/projects/${payloadBody.projectId}/vendor-bills/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          vendor: payloadBody.vendor,
          bill_number: payloadBody.bill_number,
          issue_date: payloadBody.issue_date,
          due_date: payloadBody.due_date,
          total: payloadBody.total,
          notes: payloadBody.notes,
          ...options,
        }),
      },
    );
    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const duplicateData = payload.data as { duplicate_candidates?: VendorBillRecord[] };
      setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
      setPendingCreatePayload(payloadBody);
      setStatusMessage("Possible duplicate vendor bill found by vendor + bill number.");
      return;
    }

    if (!response.ok) {
      setStatusMessage(payload.error?.message ?? "Create vendor bill failed.");
      return;
    }

    const created = payload.data as VendorBillRecord;
    setVendorBills((current) => [created, ...current]);
    setSelectedVendorBillId(String(created.id));
    hydrate(created);
    setNewBillNumber("");
    setNewTotal("0.00");
    setNewNotes("");
    setDuplicateCandidates([]);
    setPendingCreatePayload(null);
    setStatusMessage(`Created vendor bill #${created.id}.`);
  }

  async function handleCreateVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    const vendor = Number(newVendorId);
    if (!projectId) {
      setStatusMessage("Select a project first.");
      return;
    }
    if (!vendor) {
      setStatusMessage("Select a vendor first.");
      return;
    }

    setStatusMessage("Creating vendor bill...");
    await createVendorBill({
      projectId,
      vendor,
      bill_number: newBillNumber,
      issue_date: newIssueDate,
      due_date: newDueDate,
      total: newTotal,
      notes: newNotes,
    });
  }

  async function handleCreateAnyway() {
    if (!pendingCreatePayload) {
      setStatusMessage("No duplicate candidate payload to resolve.");
      return;
    }

    setStatusMessage("Creating duplicate vendor bill by override...");
    await createVendorBill(pendingCreatePayload, { duplicate_override: true });
  }

  function handleSelectVendorBill(id: string) {
    setSelectedVendorBillId(id);
    const selected = vendorBills.find((row) => String(row.id) === id);
    if (!selected) return;

    hydrate(selected);
    setDuplicateOverrideOnSave(false);
  }

  async function handleSaveVendorBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const vendorBillId = Number(selectedVendorBillId);
    const vendor = Number(vendorId);
    if (!vendorBillId) {
      setStatusMessage("Select a vendor bill first.");
      return;
    }
    if (!vendor) {
      setStatusMessage("Select a vendor first.");
      return;
    }

    setStatusMessage("Saving vendor bill...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/vendor-bills/${vendorBillId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          vendor,
          bill_number: billNumber,
          issue_date: issueDate,
          due_date: dueDate,
          total,
          notes,
          status,
          duplicate_override: duplicateOverrideOnSave,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (response.status === 409 && payload.error?.code === "duplicate_detected") {
        const duplicateData = payload.data as { duplicate_candidates?: VendorBillRecord[] };
        setDuplicateCandidates(duplicateData.duplicate_candidates ?? []);
        setStatusMessage(
          "Possible duplicate vendor bill found. Enable override and save again if intentional.",
        );
        return;
      }
      if (!response.ok) {
        setStatusMessage(payload.error?.message ?? "Save vendor bill failed.");
        return;
      }

      const updated = payload.data as VendorBillRecord;
      setVendorBills((current) =>
        current.map((vendorBill) => (vendorBill.id === updated.id ? updated : vendorBill)),
      );
      setDuplicateCandidates([]);
      setStatusMessage(`Saved vendor bill #${updated.id}.`);
    } catch {
      setStatusMessage("Could not reach vendor bill detail endpoint.");
    }
  }

  return (
    <section>
      <h2>Vendor Bill Intake and Lifecycle</h2>
      <p>Record AP bills from vendors, detect duplicates, and progress payment workflow status.</p>

      <label>
        API base URL
        <input value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} />
      </label>

      <form onSubmit={handleLogin}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit">Login</button>
      </form>

      <label>
        Auth token
        <input value={token} onChange={(event) => setToken(event.target.value)} />
      </label>
      <p>{authMessage}</p>

      <button type="button" onClick={loadDependencies}>
        Load Projects + Vendors
      </button>

      {projects.length > 0 ? (
        <label>
          Project
          <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={handleCreateVendorBill}>
        <h3>Create Vendor Bill</h3>
        <label>
          Vendor
          <select value={newVendorId} onChange={(event) => setNewVendorId(event.target.value)} required>
            <option value="">Select vendor</option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                #{vendor.id} - {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bill number
          <input
            value={newBillNumber}
            onChange={(event) => setNewBillNumber(event.target.value)}
            required
          />
        </label>
        <label>
          Issue date
          <input
            type="date"
            value={newIssueDate}
            onChange={(event) => setNewIssueDate(event.target.value)}
            required
          />
        </label>
        <label>
          Due date
          <input
            type="date"
            value={newDueDate}
            onChange={(event) => setNewDueDate(event.target.value)}
            required
          />
        </label>
        <label>
          Total
          <input
            value={newTotal}
            onChange={(event) => setNewTotal(event.target.value)}
            inputMode="decimal"
            required
          />
        </label>
        <label>
          Notes
          <textarea value={newNotes} onChange={(event) => setNewNotes(event.target.value)} />
        </label>
        <button type="submit" disabled={!selectedProjectId || !newVendorId}>
          Create Vendor Bill
        </button>
      </form>

      {duplicateCandidates.length > 0 ? (
        <>
          <p>Duplicate candidates:</p>
          <ul>
            {duplicateCandidates.map((candidate) => (
              <li key={candidate.id}>
                #{candidate.id} {candidate.vendor_name} / {candidate.bill_number} ({candidate.status})
              </li>
            ))}
          </ul>
          {pendingCreatePayload ? (
            <button type="button" onClick={handleCreateAnyway}>
              Create Anyway
            </button>
          ) : null}
        </>
      ) : null}

      <button type="button" onClick={loadVendorBills} disabled={!selectedProjectId}>
        Load Vendor Bills for Selected Project
      </button>

      {vendorBills.length > 0 ? (
        <label>
          Vendor bill
          <select
            value={selectedVendorBillId}
            onChange={(event) => handleSelectVendorBill(event.target.value)}
          >
            {vendorBills.map((vendorBill) => (
              <option key={vendorBill.id} value={vendorBill.id}>
                #{vendorBill.id} {vendorBill.vendor_name} / {vendorBill.bill_number} ({vendorBill.status})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form onSubmit={handleSaveVendorBill}>
        <h3>Edit Vendor Bill</h3>
        <label>
          Vendor
          <select value={vendorId} onChange={(event) => setVendorId(event.target.value)} required>
            <option value="">Select vendor</option>
            {vendors.map((vendorRow) => (
              <option key={vendorRow.id} value={vendorRow.id}>
                #{vendorRow.id} - {vendorRow.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bill number
          <input value={billNumber} onChange={(event) => setBillNumber(event.target.value)} required />
        </label>
        <label>
          Issue date
          <input
            type="date"
            value={issueDate}
            onChange={(event) => setIssueDate(event.target.value)}
            required
          />
        </label>
        <label>
          Due date
          <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required />
        </label>
        <label>
          Total
          <input value={total} onChange={(event) => setTotal(event.target.value)} inputMode="decimal" required />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) =>
              setStatus(
                event.target.value as
                  | "draft"
                  | "received"
                  | "approved"
                  | "scheduled"
                  | "paid"
                  | "void",
              )
            }
          >
            <option value="draft">draft</option>
            <option value="received">received</option>
            <option value="approved">approved</option>
            <option value="scheduled">scheduled</option>
            <option value="paid">paid</option>
            <option value="void">void</option>
          </select>
        </label>
        <label>
          Allow duplicate vendor + bill number on save
          <input
            type="checkbox"
            checked={duplicateOverrideOnSave}
            onChange={(event) => setDuplicateOverrideOnSave(event.target.checked)}
          />
        </label>
        <button type="submit" disabled={!selectedVendorBillId}>
          Save Vendor Bill
        </button>
      </form>

      <p>{statusMessage}</p>
    </section>
  );
}
