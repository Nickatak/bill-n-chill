"use client";

import { FormEvent, useEffect, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { loadClientSession } from "../../session/client-session";
import { ApiResponse, DuplicateData, LeadContactCandidate, LeadConvertResult, LeadPayload } from "../types";

export function QuickAddConsole() {
  const session = loadClientSession();
  const [token] = useState(session?.token ?? "");
  const [authMessage, setAuthMessage] = useState(
    session
      ? "Using shared session for " + (session.email || "user") + "."
      : "No shared session found. Go to / and login first.",
  );
  const [leadMessage, setLeadMessage] = useState("");
  const [conversionMessage, setConversionMessage] = useState("");
  const [duplicateCandidates, setDuplicateCandidates] = useState<LeadContactCandidate[]>([]);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>("");
  const [pendingLeadPayload, setPendingLeadPayload] = useState<LeadPayload | null>(null);
  const [lastLeadId, setLastLeadId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState("prospect");

  const normalizedBaseUrl = normalizeApiBaseUrl(defaultApiBaseUrl);

  useEffect(() => {
    async function verifySharedSession() {
      if (!token) {
        return;
      }
      setAuthMessage("Checking shared session...");
      try {
        const response = await fetch(`${normalizedBaseUrl}/auth/me/`, {
          headers: { Authorization: `Token ${token}` },
        });
        const payload: ApiResponse = await response.json();
        const userData = payload.data as { email?: string } | undefined;
        if (!response.ok) {
          setAuthMessage("Shared session token is invalid. Go to / and login again.");
          return;
        }
        setAuthMessage("Using shared session for " + (userData?.email || "user") + ".");
      } catch {
        setAuthMessage("Could not reach auth/me endpoint.");
      }
    }

    void verifySharedSession();
    // Intentionally runs once on initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitQuickAdd(
    body: LeadPayload,
    options?: { duplicate_resolution?: string; duplicate_target_id?: number },
  ) {
    const requestBody = {
      ...body,
      ...options,
    };

    const response = await fetch(`${normalizedBaseUrl}/lead-contacts/quick-add/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(requestBody),
    });

    const payload: ApiResponse = await response.json();

    if (response.status === 409 && payload.error?.code === "duplicate_detected") {
      const data = payload.data as DuplicateData;
      const candidates = data.duplicate_candidates ?? [];
      setDuplicateCandidates(candidates);
      setSelectedDuplicateId(candidates[0] ? String(candidates[0].id) : "");
      setPendingLeadPayload(body);
      setLeadMessage("Possible duplicate found. Choose a resolution below.");
      return;
    }

    if (!response.ok) {
      setLeadMessage("Quick Add failed. Check token and required fields.");
      return;
    }

    const result = payload.data as LeadContactCandidate;
    const resolution = payload.meta?.duplicate_resolution ?? "none";
    setLeadMessage(`Lead contact saved (#${result.id}) via resolution: ${resolution}.`);
    setDuplicateCandidates([]);
    setSelectedDuplicateId("");
    setPendingLeadPayload(null);
    setLastLeadId(result.id);
    if (!projectName) {
      setProjectName(`${result.full_name} Project`);
    }
  }

  async function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLeadMessage("Submitting lead contact...");
    const form = event.currentTarget;

    const formData = new FormData(form);
    const body: LeadPayload = {
      full_name: String(formData.get("full_name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      project_address: String(formData.get("project_address") ?? ""),
      email: String(formData.get("email") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      source: String(formData.get("source") ?? "field_manual"),
    };

    try {
      await submitQuickAdd(body);
      if (duplicateCandidates.length === 0) {
        form.reset();
      }
    } catch {
      setLeadMessage("Lead submission failed due to an unexpected UI error.");
    }
  }

  async function resolveDuplicate(resolution: "use_existing" | "merge_existing" | "create_anyway") {
    if (!pendingLeadPayload) {
      setLeadMessage("No pending duplicate payload to resolve.");
      return;
    }

    try {
      if (resolution === "create_anyway") {
        await submitQuickAdd(pendingLeadPayload, { duplicate_resolution: resolution });
        return;
      }

      const targetId = Number(selectedDuplicateId);
      if (!targetId) {
        setLeadMessage("Select a duplicate candidate first.");
        return;
      }

      await submitQuickAdd(pendingLeadPayload, {
        duplicate_resolution: resolution,
        duplicate_target_id: targetId,
      });
    } catch {
      setLeadMessage("Could not resolve duplicate at this time.");
    }
  }

  async function handleConvertLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!lastLeadId) {
      setConversionMessage("Create or resolve a lead contact first.");
      return;
    }

    setConversionMessage("Converting lead to customer + project...");

    try {
      const response = await fetch(
        `${normalizedBaseUrl}/lead-contacts/${lastLeadId}/convert-to-project/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Token ${token}`,
          },
          body: JSON.stringify({
            project_name: projectName,
            project_status: projectStatus,
          }),
        },
      );

      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setConversionMessage("Lead conversion failed.");
        return;
      }

      const result = payload.data as LeadConvertResult;
      const status = payload.meta?.conversion_status ?? "converted";
      setConversionMessage(
        `Conversion ${status}: customer #${result.customer?.id ?? "?"}, project #${result.project?.id ?? "?"}.`,
      );
    } catch {
      setConversionMessage("Could not reach lead conversion endpoint.");
    }
  }

  return (
    <section>
      <h2>Quick Add Contact</h2>
      <p>Use your shared session from /, then capture lead details from the field.</p>
      <p>{authMessage}</p>

      <form onSubmit={handleQuickAdd}>
        <h3>Lead Capture</h3>
        <label>
          Full name
          <input name="full_name" required />
        </label>
        <label>
          Phone
          <input name="phone" required />
        </label>
        <label>
          Project address
          <input name="project_address" required />
        </label>
        <label>
          Email
          <input name="email" type="email" />
        </label>
        <label>
          Source
          <select name="source" defaultValue="field_manual">
            <option value="field_manual">field_manual</option>
            <option value="office_manual">office_manual</option>
            <option value="import">import</option>
            <option value="web_form">web_form</option>
            <option value="referral">referral</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          Notes
          <textarea name="notes" rows={3} />
        </label>
        <button type="submit">Create Lead Contact</button>
      </form>

      {duplicateCandidates.length > 0 ? (
        <div>
          <h3>Duplicate Resolution Required</h3>
          <label>
            Candidate
            <select
              value={selectedDuplicateId}
              onChange={(event) => setSelectedDuplicateId(event.target.value)}
            >
              {duplicateCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  #{candidate.id} - {candidate.full_name} ({candidate.phone})
                </option>
              ))}
            </select>
          </label>
          <div>
            <button type="button" onClick={() => resolveDuplicate("use_existing")}>Use Existing</button>
            <button type="button" onClick={() => resolveDuplicate("merge_existing")}>Merge into Existing</button>
            <button type="button" onClick={() => resolveDuplicate("create_anyway")}>Create Anyway</button>
          </div>
        </div>
      ) : null}

      <p>{leadMessage}</p>

      <form onSubmit={handleConvertLead}>
        <h3>Convert Lead to Project</h3>
        <label>
          Lead ID
          <input
            value={lastLeadId ?? ""}
            onChange={(event) => setLastLeadId(Number(event.target.value) || null)}
            placeholder="Lead ID"
          />
        </label>
        <label>
          Project name
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
        </label>
        <label>
          Project status
          <select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
            <option value="prospect">prospect</option>
            <option value="active">active</option>
            <option value="on_hold">on_hold</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
        <button type="submit">Convert Lead</button>
      </form>
      <p>{conversionMessage}</p>
    </section>
  );
}
