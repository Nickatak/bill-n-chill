"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { defaultApiBaseUrl, normalizeApiBaseUrl } from "../api";
import { loadClientSession } from "../../session/client-session";
import { ApiResponse, DuplicateData, LeadContactCandidate, LeadConvertResult, LeadPayload } from "../types";
import styles from "./quick-add-console.module.css";

type LeadFieldErrors = {
  full_name?: string;
  phone?: string;
  project_address?: string;
  project_name?: string;
};

type SubmitIntent = "contact_only" | "contact_and_project";

type PendingSubmission = {
  payload: LeadPayload;
  intent: SubmitIntent;
  projectName: string;
  projectStatus: string;
};

export function QuickAddConsole() {
  const session = loadClientSession();
  const fullNameRef = useRef<HTMLInputElement>(null);

  const [token] = useState(session?.token ?? "");
  const [authMessage, setAuthMessage] = useState(
    session
      ? "Using shared session for " + (session.email || "user") + "."
      : "No shared session found. Go to / and login first.",
  );

  const [leadMessage, setLeadMessage] = useState("");
  const [conversionMessage, setConversionMessage] = useState("");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [initialContractValue, setInitialContractValue] = useState("");
  const [source, setSource] = useState("field_manual");
  const [notes, setNotes] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState("prospect");
  const [fieldErrors, setFieldErrors] = useState<LeadFieldErrors>({});

  const [duplicateCandidates, setDuplicateCandidates] = useState<LeadContactCandidate[]>([]);
  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string>("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);

  const [lastLead, setLastLead] = useState<LeadContactCandidate | null>(null);

  const normalizedBaseUrl = useMemo(() => normalizeApiBaseUrl(defaultApiBaseUrl), []);

  useEffect(() => {
    fullNameRef.current?.focus();
  }, []);

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
  }, [normalizedBaseUrl, token]);

  function validateLeadFields(payload: LeadPayload, intent: SubmitIntent): LeadFieldErrors {
    const nextErrors: LeadFieldErrors = {};
    const contactValue = payload.phone.trim();

    if (!payload.full_name.trim()) {
      nextErrors.full_name = "Full name is required.";
    }

    if (!contactValue) {
      nextErrors.phone = "Provide a valid phone number or email address.";
    } else {
      const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue);
      const digits = contactValue.replace(/\D/g, "");
      const looksLikePhone = /^[0-9+\-().\s]+$/.test(contactValue) && digits.length >= 7 && digits.length <= 15;
      if (!looksLikeEmail && !looksLikePhone) {
        nextErrors.phone = "Contact must be a valid phone number or email address.";
      }
    }

    if (!payload.project_address.trim()) {
      nextErrors.project_address = "Project address is required.";
    }
    if (intent === "contact_and_project" && !projectName.trim()) {
      nextErrors.project_name = "Project name is required when creating project + contact.";
    }
    return nextErrors;
  }

  async function convertLeadToProject(leadId: number, name: string, status: string): Promise<void> {
    setConversionMessage("Converting lead to customer + project...");

    const response = await fetch(`${normalizedBaseUrl}/lead-contacts/${leadId}/convert-to-project/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify({
        project_name: name,
        project_status: status,
      }),
    });

    const payload: ApiResponse = await response.json();
    if (!response.ok) {
      setConversionMessage(payload.error?.message ?? "Lead conversion failed.");
      return;
    }

    const result = payload.data as LeadConvertResult;
    const resultStatus = payload.meta?.conversion_status ?? "converted";
    setConversionMessage(
      `Conversion ${resultStatus}: customer #${result.customer?.id ?? "?"}, project #${result.project?.id ?? "?"}.`,
    );
  }

  async function submitQuickAdd(
    body: LeadPayload,
    submission: PendingSubmission,
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
      setPendingSubmission(submission);
      setLeadMessage("Possible duplicate found. Choose a resolution below.");
      return;
    }

    if (!response.ok) {
      setLeadMessage(payload.error?.message ?? "Quick Add failed. Check token and required fields.");
      return;
    }

    const result = payload.data as LeadContactCandidate;
    const resolution = payload.meta?.duplicate_resolution ?? "none";
    setLeadMessage(`Lead contact saved (#${result.id}) via resolution: ${resolution}.`);
    setDuplicateCandidates([]);
    setSelectedDuplicateId("");
    setPendingSubmission(null);
    setLastLead(result);

    if (submission.intent === "contact_and_project") {
      await convertLeadToProject(result.id, submission.projectName, submission.projectStatus);
    } else {
      setConversionMessage("");
    }

    setFullName("");
    setPhone("");
    setProjectAddress("");
    setInitialContractValue("");
    setSource("field_manual");
    setNotes("");
    setFieldErrors({});
    fullNameRef.current?.focus();
  }

  async function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nativeEvent = event.nativeEvent as SubmitEvent;
    const submitter = nativeEvent.submitter as HTMLButtonElement | null;
    const intent: SubmitIntent = submitter?.value === "contact_and_project"
      ? "contact_and_project"
      : "contact_only";

    setLeadMessage(intent === "contact_only" ? "Submitting lead contact..." : "Creating contact + project...");

    if (!token) {
      setLeadMessage("No shared session token found. Go to / and sign in.");
      return;
    }

    const body: LeadPayload = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      project_address: projectAddress.trim(),
      email: "",
      initial_contract_value: initialContractValue.trim() ? initialContractValue.trim() : null,
      notes: notes.trim(),
      source: source.trim() || "field_manual",
    };

    const submission: PendingSubmission = {
      payload: body,
      intent,
      projectName: projectName.trim() || `${fullName.trim()} Project`,
      projectStatus,
    };

    const nextErrors = validateLeadFields(body, intent);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setLeadMessage("Fix the required fields and submit again.");
      return;
    }

    try {
      await submitQuickAdd(body, submission);
    } catch {
      setLeadMessage("Lead submission failed due to an unexpected UI error.");
    }
  }

  async function resolveDuplicate(resolution: "use_existing" | "merge_existing" | "create_anyway") {
    if (!pendingSubmission) {
      setLeadMessage("No pending duplicate payload to resolve.");
      return;
    }

    try {
      if (resolution === "create_anyway") {
        await submitQuickAdd(pendingSubmission.payload, pendingSubmission, { duplicate_resolution: resolution });
        return;
      }

      const targetId = Number(selectedDuplicateId);
      if (!targetId) {
        setLeadMessage("Select a duplicate candidate first.");
        return;
      }

      await submitQuickAdd(pendingSubmission.payload, pendingSubmission, {
        duplicate_resolution: resolution,
        duplicate_target_id: targetId,
      });
    } catch {
      setLeadMessage("Could not resolve duplicate at this time.");
    }
  }

  return (
    <section className={styles.section}>
      <h2>Quick Add Contact</h2>
      <p>Use one form for both capture-only and capture-with-project actions.</p>
      <p>{authMessage}</p>

      <form className={styles.formGrid} onSubmit={handleQuickAdd}>
        <h3>Lead Capture + Optional Project</h3>

        <label className={styles.field}>
          Full name
          <input
            ref={fullNameRef}
            name="full_name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            required
          />
          {fieldErrors.full_name ? <p className={styles.errorText}>{fieldErrors.full_name}</p> : null}
        </label>

        <label className={styles.field}>
          Phone (or email)
          <input
            name="phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            inputMode="text"
            autoComplete="off"
            placeholder="(555) 123-4567 or name@example.com"
          />
          {fieldErrors.phone ? <p className={styles.errorText}>{fieldErrors.phone}</p> : null}
        </label>

        <label className={styles.field}>
          Project address
          <input
            name="project_address"
            value={projectAddress}
            onChange={(event) => setProjectAddress(event.target.value)}
            autoComplete="street-address"
            required
          />
          {fieldErrors.project_address ? (
            <p className={styles.errorText}>{fieldErrors.project_address}</p>
          ) : null}
        </label>

        <label className={styles.field}>
          Project name (required for Create Contact + Project)
          <input
            name="project_name"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Bathroom Remodel"
          />
          {fieldErrors.project_name ? <p className={styles.errorText}>{fieldErrors.project_name}</p> : null}
        </label>

        <label className={styles.field}>
          Project status
          <select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
            <option value="prospect">prospect</option>
            <option value="active">active</option>
            <option value="on_hold">on_hold</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>

        <details className={styles.optionalDetails}>
          <summary>Optional details</summary>
          <div className={styles.optionalBody}>
            <label className={styles.field}>
              Initial contract value
              <input
                name="initial_contract_value"
                value={initialContractValue}
                onChange={(event) => setInitialContractValue(event.target.value)}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                placeholder="25000.00"
              />
            </label>
            <label className={styles.field}>
              Notes
              <textarea
                name="notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              Source
              <select name="source" value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="field_manual">field_manual</option>
                <option value="office_manual">office_manual</option>
                <option value="import">import</option>
                <option value="web_form">web_form</option>
                <option value="referral">referral</option>
                <option value="other">other</option>
              </select>
            </label>
          </div>
        </details>

        <div className={styles.stickyActions}>
          <div className={styles.inlineActions}>
            <button type="submit" value="contact_only">Create Contact Only</button>
            <button type="submit" value="contact_and_project">Create Contact + Project</button>
          </div>
        </div>
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
                  #{candidate.id} - {candidate.full_name} ({candidate.phone || candidate.email})
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

      {lastLead ? (
        <div className={styles.summaryCard}>
          <p className={styles.summaryTitle}>Lead created</p>
          <p className={styles.summaryText}>
            #{lastLead.id} - {lastLead.full_name} ({lastLead.phone || lastLead.email})
          </p>
        </div>
      ) : null}

      <p>{conversionMessage}</p>
      {conversionMessage.includes("customer #") ? (
        <div className={styles.inlineActions}>
          <Link className={styles.secondaryLink} href="/projects">
            Go to Projects
          </Link>
        </div>
      ) : null}
    </section>
  );
}
