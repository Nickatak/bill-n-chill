import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

import type { ProjectRecord } from "@/features/projects/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock("@/shared/phone-format", () => ({
  formatPhone: (v: string) => v,
}));

import { CustomersList } from "../components/customers-list";
import type { CustomerRow } from "../types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeCustomer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 1,
    display_name: "Jane Doe",
    phone: "5551234567",
    email: "jane@example.com",
    billing_address: "123 Main St",
    is_archived: false,
    project_count: 2,
    active_project_count: 1,
    created_at: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 1,
    name: "Kitchen Remodel",
    customer: 1,
    customer_display_name: "Jane Doe",
    status: "active",
    site_address: "123 Main St",
    contract_value: "25000.00",
    invoiced_total: "0.00",
    paid_total: "0.00",
    balance_due: "25000.00",
    cost_to_date: "0.00",
    profit: "25000.00",
    profit_margin: "100.0",
    ...overrides,
  } as ProjectRecord;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockOnEdit = vi.fn();
const mockOnCreateProject = vi.fn();

function renderList(props: {
  rows?: CustomerRow[];
  filteredRows?: CustomerRow[];
  query?: string;
  projectsByCustomer?: Record<number, ProjectRecord[]>;
}) {
  const rows = props.rows ?? [makeCustomer()];
  return render(
    <CustomersList
      rows={rows}
      filteredRows={props.filteredRows ?? rows}
      query={props.query ?? ""}
      projectsByCustomer={props.projectsByCustomer ?? {}}
      onEdit={mockOnEdit}
      onCreateProject={mockOnCreateProject}
    />,
  );
}

// ---------------------------------------------------------------------------
// CustomersList
// ---------------------------------------------------------------------------

describe("CustomersList", () => {
  afterEach(() => {
    cleanup();
    mockOnEdit.mockClear();
    mockOnCreateProject.mockClear();
  });

  it("renders customer rows", () => {
    renderList({});
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("calls onEdit when customer name is clicked", () => {
    renderList({});
    fireEvent.click(screen.getByText("Jane Doe"));
    expect(mockOnEdit).toHaveBeenCalledWith("1");
  });

  it("shows empty state when no customers match filters", () => {
    renderList({ filteredRows: [] });
    expect(screen.getByText("No customers match the current filters.")).toBeInTheDocument();
  });

  it("shows search empty state when query has no results", () => {
    renderList({ rows: [], filteredRows: [], query: "nonexistent" });
    expect(screen.getByText("No customers matched your search.")).toBeInTheDocument();
  });

  it("shows first-time empty state when no customers at all", () => {
    renderList({ rows: [], filteredRows: [] });
    expect(screen.getByText(/No customers yet. Use the Quick Add form/)).toBeInTheDocument();
  });

  it("expands project accordion on toggle click", () => {
    const projects = [
      makeProject({ id: 1, name: "Kitchen Remodel", status: "active" }),
      makeProject({ id: 2, name: "Deck Build", status: "prospect" }),
    ];
    renderList({ projectsByCustomer: { 1: projects } });

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    // Project names render as "#1 Kitchen Remodel" inside link spans
    expect(screen.getByText(/Kitchen Remodel/)).toBeInTheDocument();
    expect(screen.getByText(/Deck Build/)).toBeInTheDocument();
  });

  it("shows project status summary pills", () => {
    const projects = [
      makeProject({ id: 1, status: "active" }),
      makeProject({ id: 2, status: "active" }),
      makeProject({ id: 3, status: "prospect" }),
    ];
    renderList({ projectsByCustomer: { 1: projects } });

    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getByText("1 prospect")).toBeInTheDocument();
  });

  it("filters projects by status when filter chip is toggled", () => {
    const projects = [
      makeProject({ id: 1, name: "Active Job", status: "active" }),
      makeProject({ id: 2, name: "Prospect Lead", status: "prospect" }),
    ];
    renderList({ projectsByCustomer: { 1: projects } });

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/Active Job/)).toBeInTheDocument();
    expect(screen.getByText(/Prospect Lead/)).toBeInTheDocument();

    // Toggle off "prospect" filter
    fireEvent.click(screen.getByRole("button", { name: /prospect \(1\)/i, pressed: true }));
    expect(screen.getByText(/Active Job/)).toBeInTheDocument();
    expect(screen.queryByText(/Prospect Lead/)).not.toBeInTheDocument();
  });

  it("calls onCreateProject when add project button is clicked", () => {
    const customer = makeCustomer();
    renderList({ rows: [customer] });
    fireEvent.click(screen.getByRole("button", { name: /add new project for jane doe/i }));
    expect(mockOnCreateProject).toHaveBeenCalledWith(customer);
  });

  it("renders archived customers with inactive styling class", () => {
    const { container } = renderList({ rows: [makeCustomer({ is_archived: true })] });
    expect(container.querySelector(".gridRowInactive")).toBeInTheDocument();
  });
});
