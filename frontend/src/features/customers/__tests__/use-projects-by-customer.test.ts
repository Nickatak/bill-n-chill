import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

import { useProjectsByCustomer } from "../hooks/use-projects-by-customer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function projectRow(id: number, customer: number, name = `Project ${id}`) {
  return {
    id,
    customer,
    customer_display_name: `Customer ${customer}`,
    name,
    status: "active",
    contract_value_original: "10000.00",
    contract_value_current: "10000.00",
    accepted_contract_total: "10000.00",
  };
}

function successResponse(projects: ReturnType<typeof projectRow>[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: projects }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProjectsByCustomer", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("groups projects by customer ID", async () => {
    mockFetch.mockReturnValueOnce(
      successResponse([
        projectRow(1, 10),
        projectRow(2, 20),
        projectRow(3, 10),
      ]),
    );

    const { result } = renderHook(() => useProjectsByCustomer("test-token"));

    await waitFor(() => {
      expect(Object.keys(result.current.projectsByCustomer).length).toBe(2);
    });

    expect(result.current.projectsByCustomer[10]).toHaveLength(2);
    expect(result.current.projectsByCustomer[20]).toHaveLength(1);
    expect(result.current.projectsByCustomer[20][0].id).toBe(2);
  });

  it("sorts projects within each group newest-first (by id descending)", async () => {
    mockFetch.mockReturnValueOnce(
      successResponse([
        projectRow(3, 10),
        projectRow(1, 10),
        projectRow(5, 10),
      ]),
    );

    const { result } = renderHook(() => useProjectsByCustomer("test-token"));

    await waitFor(() => {
      expect(result.current.projectsByCustomer[10]).toHaveLength(3);
    });

    const ids = result.current.projectsByCustomer[10].map((p) => p.id);
    expect(ids).toEqual([5, 3, 1]);
  });

  it("returns empty map when API returns no projects", async () => {
    mockFetch.mockReturnValueOnce(successResponse([]));

    const { result } = renderHook(() => useProjectsByCustomer("test-token"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    expect(result.current.projectsByCustomer).toEqual({});
  });

  it("does not fetch when authToken is empty", () => {
    renderHook(() => useProjectsByCustomer(""));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("silently handles fetch failure without throwing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useProjectsByCustomer("test-token"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    expect(result.current.projectsByCustomer).toEqual({});
  });
});
