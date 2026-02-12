"use client";

import { FormEvent, useMemo, useState } from "react";

type UserData = {
  token?: string;
  email?: string;
};

type ProjectRecord = {
  id: number;
  customer: number;
  customer_display_name: string;
  name: string;
  status: string;
  contract_value_original: string;
  contract_value_current: string;
  start_date_planned: string | null;
  end_date_planned: string | null;
};

type ApiResponse = {
  data?: UserData | ProjectRecord[] | ProjectRecord;
};

const defaultApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function ProjectsConsole() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState("");

  const [projectName, setProjectName] = useState("");
  const [projectStatus, setProjectStatus] = useState("prospect");
  const [contractOriginal, setContractOriginal] = useState("0.00");
  const [contractCurrent, setContractCurrent] = useState("0.00");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const normalizedBaseUrl = useMemo(
    () => apiBaseUrl.trim().replace(/\/$/, ""),
    [apiBaseUrl],
  );
  const hasSelectedProject = Boolean(selectedProjectId);

  function hydrateForm(project: ProjectRecord) {
    setProjectName(project.name);
    setProjectStatus(project.status);
    setContractOriginal(project.contract_value_original);
    setContractCurrent(project.contract_value_current);
    setStartDate(project.start_date_planned ?? "");
    setEndDate(project.end_date_planned ?? "");
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

  async function loadProjects() {
    setStatusMessage("Loading projects...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/`, {
        headers: { Authorization: `Token ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Could not load projects.");
        return;
      }
      const items = (payload.data as ProjectRecord[]) ?? [];
      setProjects(items);
      if (items[0]) {
        setSelectedProjectId(String(items[0].id));
        hydrateForm(items[0]);
        setStatusMessage(`Loaded ${items.length} project(s).`);
      } else {
        setSelectedProjectId("");
        setStatusMessage(
          "No projects found for this user. Create one from Intake -> Convert Lead to Project.",
        );
      }
    } catch {
      setStatusMessage("Could not reach projects endpoint.");
    }
  }

  async function handleSelectProject(projectId: string) {
    setSelectedProjectId(projectId);
    const item = projects.find((project) => String(project.id) === projectId);
    if (item) {
      hydrateForm(item);
    }
  }

  async function handleSaveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const projectId = Number(selectedProjectId);
    if (!projectId) {
      setStatusMessage(
        "No project selected. Load projects first, then pick one from the project dropdown.",
      );
      return;
    }

    setStatusMessage("Saving project profile...");
    try {
      const response = await fetch(`${normalizedBaseUrl}/projects/${projectId}/`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({
          name: projectName,
          status: projectStatus,
          contract_value_original: contractOriginal,
          contract_value_current: contractCurrent,
          start_date_planned: startDate || null,
          end_date_planned: endDate || null,
        }),
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok) {
        setStatusMessage("Save failed. Check values and auth token.");
        return;
      }

      const updated = payload.data as ProjectRecord;
      setProjects((current) =>
        current.map((project) => (project.id === updated.id ? updated : project)),
      );
      setStatusMessage(`Project #${updated.id} saved.`);
    } catch {
      setStatusMessage("Could not reach project detail endpoint.");
    }
  }

  return (
    <section>
      <h2>Project Profile Editor</h2>
      <p>Load project shells and update baseline profile fields.</p>

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

      <button type="button" onClick={loadProjects}>
        Load Projects
      </button>

      {projects.length > 0 ? (
        <label>
          Project
          <select
            value={selectedProjectId}
            onChange={(event) => handleSelectProject(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                #{project.id} - {project.name} ({project.customer_display_name})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {projects.length === 0 ? (
        <p>
          No projects yet. Go to <code>/intake/quick-add</code>, create a lead, and convert it to
          a project shell.
        </p>
      ) : null}

      <form onSubmit={handleSaveProject}>
        <h3>Project Profile</h3>
        <label>
          Project name
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} required />
        </label>
        <label>
          Status
          <select value={projectStatus} onChange={(event) => setProjectStatus(event.target.value)}>
            <option value="prospect">prospect</option>
            <option value="active">active</option>
            <option value="on_hold">on_hold</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
          </select>
        </label>
        <label>
          Contract value (original)
          <input
            value={contractOriginal}
            onChange={(event) => setContractOriginal(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          Contract value (current)
          <input
            value={contractCurrent}
            onChange={(event) => setContractCurrent(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <label>
          Planned start date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          Planned end date
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <button type="submit" disabled={!hasSelectedProject}>
          Save Project Profile
        </button>
      </form>

      <p>{statusMessage}</p>
    </section>
  );
}
