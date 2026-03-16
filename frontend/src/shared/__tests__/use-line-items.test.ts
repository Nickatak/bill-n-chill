import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLineItems } from "../hooks/use-line-items";

interface TestLine {
  localId: number;
  description: string;
  amount: string;
}

const createEmpty = (localId: number): TestLine => ({
  localId,
  description: "",
  amount: "0",
});

function setup(initialItems?: TestLine[]) {
  return renderHook(() => useLineItems<TestLine>({ createEmpty, initialItems }));
}

describe("useLineItems", () => {
  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  it("starts with a single empty line when no initialItems", () => {
    const { result } = setup();
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].localId).toBe(1);
    expect(result.current.nextId).toBe(2);
  });

  it("starts with provided initialItems", () => {
    const initial = [
      { localId: 5, description: "A", amount: "100" },
      { localId: 8, description: "B", amount: "200" },
    ];
    const { result } = setup(initial);
    expect(result.current.items).toEqual(initial);
    expect(result.current.nextId).toBe(9); // max(5,8) + 1
  });

  // ---------------------------------------------------------------------------
  // add
  // ---------------------------------------------------------------------------

  it("appends a new empty line and increments nextId", () => {
    const { result } = setup();
    let newId: number;
    act(() => { newId = result.current.add(); });
    expect(newId!).toBe(2);
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[1].localId).toBe(2);
    expect(result.current.nextId).toBe(3);
  });

  it("successive adds get incrementing IDs", () => {
    const { result } = setup();
    act(() => { result.current.add(); });
    act(() => { result.current.add(); });
    expect(result.current.items.map((i) => i.localId)).toEqual([1, 2, 3]);
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------

  it("removes a line by localId", () => {
    const { result } = setup();
    act(() => { result.current.add(); }); // [1, 2]
    act(() => { result.current.remove(1); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].localId).toBe(2);
  });

  it("refuses to remove the last item", () => {
    const { result } = setup();
    act(() => { result.current.remove(1); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].localId).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  it("patches a field on a specific line", () => {
    const { result } = setup();
    act(() => { result.current.update(1, { description: "Updated" }); });
    expect(result.current.items[0].description).toBe("Updated");
    expect(result.current.items[0].amount).toBe("0"); // untouched
  });

  it("patches multiple fields at once", () => {
    const { result } = setup();
    act(() => { result.current.update(1, { description: "New", amount: "500" }); });
    expect(result.current.items[0].description).toBe("New");
    expect(result.current.items[0].amount).toBe("500");
  });

  it("does nothing for non-existent localId", () => {
    const { result } = setup();
    const before = result.current.items[0];
    act(() => { result.current.update(999, { description: "nope" }); });
    expect(result.current.items[0]).toEqual(before);
  });

  // ---------------------------------------------------------------------------
  // move
  // ---------------------------------------------------------------------------

  it("moves a line down", () => {
    const { result } = setup();
    act(() => { result.current.add(); });
    act(() => { result.current.add(); }); // [1, 2, 3]
    act(() => { result.current.move(1, "down"); }); // [2, 1, 3]
    expect(result.current.items.map((i) => i.localId)).toEqual([2, 1, 3]);
  });

  it("moves a line up", () => {
    const { result } = setup();
    act(() => { result.current.add(); });
    act(() => { result.current.add(); }); // [1, 2, 3]
    act(() => { result.current.move(3, "up"); }); // [1, 3, 2]
    expect(result.current.items.map((i) => i.localId)).toEqual([1, 3, 2]);
  });

  it("clamps at top when moving first item up", () => {
    const { result } = setup();
    act(() => { result.current.add(); }); // [1, 2]
    act(() => { result.current.move(1, "up"); });
    expect(result.current.items.map((i) => i.localId)).toEqual([1, 2]);
  });

  it("clamps at bottom when moving last item down", () => {
    const { result } = setup();
    act(() => { result.current.add(); }); // [1, 2]
    act(() => { result.current.move(2, "down"); });
    expect(result.current.items.map((i) => i.localId)).toEqual([1, 2]);
  });

  it("does nothing for non-existent localId", () => {
    const { result } = setup();
    act(() => { result.current.add(); }); // [1, 2]
    act(() => { result.current.move(999, "down"); });
    expect(result.current.items.map((i) => i.localId)).toEqual([1, 2]);
  });

  // ---------------------------------------------------------------------------
  // duplicate
  // ---------------------------------------------------------------------------

  it("duplicates a line with a new localId", () => {
    const { result } = setup();
    act(() => { result.current.update(1, { description: "Original", amount: "500" }); });
    act(() => { result.current.duplicate(1); });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[1].description).toBe("Original");
    expect(result.current.items[1].amount).toBe("500");
    expect(result.current.items[1].localId).toBe(2);
    expect(result.current.nextId).toBe(3);
  });

  it("does not add a line when duplicating non-existent localId", () => {
    const { result } = setup();
    act(() => { result.current.duplicate(999); });
    expect(result.current.items).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------

  it("resets to a single empty line with localId=1", () => {
    const { result } = setup();
    act(() => { result.current.add(); });
    act(() => { result.current.add(); });
    act(() => { result.current.update(1, { description: "modified" }); });
    act(() => { result.current.reset(); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].localId).toBe(1);
    expect(result.current.items[0].description).toBe(""); // fresh empty
    expect(result.current.nextId).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // setItems / setNextId (escape hatches for hydration)
  // ---------------------------------------------------------------------------

  it("setItems replaces the entire array", () => {
    const { result } = setup();
    act(() => {
      result.current.setItems([
        { localId: 10, description: "Hydrated", amount: "999" },
      ]);
      result.current.setNextId(11);
    });
    expect(result.current.items[0].description).toBe("Hydrated");
    expect(result.current.nextId).toBe(11);
  });
});
