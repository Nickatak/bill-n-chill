import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCombobox } from "../hooks/use-combobox";

interface Fruit {
  id: number;
  name: string;
}

const fruits: Fruit[] = [
  { id: 1, name: "Apple" },
  { id: 2, name: "Banana" },
  { id: 3, name: "Apricot" },
  { id: 4, name: "Cherry" },
];

function setup(overrides: Partial<Parameters<typeof useCombobox<Fruit>>[0]> = {}) {
  const onCommit = vi.fn();
  return renderHook(() =>
    useCombobox<Fruit>({
      items: fruits,
      getLabel: (f) => f.name,
      onCommit,
      ...overrides,
    }),
  );
}

describe("useCombobox", () => {
  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  it("returns all items when query is empty", () => {
    const { result } = setup();
    expect(result.current.filteredItems).toEqual(fruits);
  });

  it("filters items case-insensitively by query", () => {
    const { result } = setup();
    act(() => result.current.handleInput("ap"));
    expect(result.current.filteredItems.map((f) => f.name)).toEqual(["Apple", "Apricot"]);
  });

  it("filters to empty when no match", () => {
    const { result } = setup();
    act(() => result.current.handleInput("zzz"));
    expect(result.current.filteredItems).toEqual([]);
  });

  it("trims whitespace from query before filtering", () => {
    const { result } = setup();
    act(() => result.current.handleInput("  banana  "));
    expect(result.current.filteredItems.map((f) => f.name)).toEqual(["Banana"]);
  });

  // ---------------------------------------------------------------------------
  // Open / Close
  // ---------------------------------------------------------------------------

  it("starts closed", () => {
    const { result } = setup();
    expect(result.current.isOpen).toBe(false);
    expect(result.current.highlightIndex).toBe(-1);
  });

  it("opens with prefill", () => {
    const { result } = setup();
    act(() => result.current.open("App"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.query).toBe("App");
    expect(result.current.highlightIndex).toBe(-1);
  });

  it("close resets highlight and clears query when no selection", () => {
    const { result } = setup();
    act(() => result.current.open("test"));
    act(() => result.current.close(false));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.highlightIndex).toBe(-1);
  });

  it("close preserves query when hasSelection is true", () => {
    const { result } = setup();
    act(() => result.current.open("Apple"));
    act(() => result.current.close(true));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe("Apple");
  });

  // ---------------------------------------------------------------------------
  // handleInput
  // ---------------------------------------------------------------------------

  it("handleInput opens menu and sets highlight to 0 for non-empty query", () => {
    const { result } = setup();
    act(() => result.current.handleInput("ch"));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.query).toBe("ch");
    expect(result.current.highlightIndex).toBe(0);
  });

  it("handleInput sets highlight to -1 for empty query (no synthetic prefix)", () => {
    const { result } = setup();
    act(() => result.current.handleInput(""));
    expect(result.current.highlightIndex).toBe(-1);
  });

  it("handleInput sets highlight to 0 for empty query with syntheticPrefixCount", () => {
    const { result } = setup({ syntheticPrefixCount: 1 });
    act(() => result.current.handleInput(""));
    expect(result.current.highlightIndex).toBe(0);
  });

  it("handleInput with syntheticPrefixCount offsets highlight for non-empty query", () => {
    const { result } = setup({ syntheticPrefixCount: 1 });
    act(() => result.current.handleInput("ap"));
    // Should point to first real item (index 1, after synthetic prefix at 0)
    expect(result.current.highlightIndex).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------

  function keyDown(result: ReturnType<typeof setup>["result"], key: string) {
    act(() =>
      result.current.handleKeyDown({
        key,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>),
    );
  }

  it("ArrowDown opens menu when closed", () => {
    const { result } = setup();
    keyDown(result, "ArrowDown");
    expect(result.current.isOpen).toBe(true);
  });

  it("ArrowDown increments highlight", () => {
    const { result } = setup();
    act(() => result.current.open());
    keyDown(result, "ArrowDown"); // -1 → 0
    expect(result.current.highlightIndex).toBe(0);
    keyDown(result, "ArrowDown"); // 0 → 1
    expect(result.current.highlightIndex).toBe(1);
  });

  it("ArrowDown clamps at last item", () => {
    const { result } = setup();
    act(() => result.current.open());
    // Move past all items
    for (let i = 0; i < fruits.length + 2; i++) keyDown(result, "ArrowDown");
    expect(result.current.highlightIndex).toBe(fruits.length - 1);
  });

  it("ArrowUp opens menu when closed", () => {
    const { result } = setup();
    keyDown(result, "ArrowUp");
    expect(result.current.isOpen).toBe(true);
  });

  it("ArrowUp decrements highlight and clamps at 0", () => {
    const { result } = setup();
    act(() => result.current.open());
    act(() => result.current.setHighlightIndex(2));
    keyDown(result, "ArrowUp"); // 2 → 1
    expect(result.current.highlightIndex).toBe(1);
    keyDown(result, "ArrowUp"); // 1 → 0
    expect(result.current.highlightIndex).toBe(0);
    keyDown(result, "ArrowUp"); // 0 → 0 (clamped)
    expect(result.current.highlightIndex).toBe(0);
  });

  it("Enter commits highlighted item", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useCombobox<Fruit>({ items: fruits, getLabel: (f) => f.name, onCommit }),
    );
    act(() => result.current.open());
    act(() => result.current.setHighlightIndex(2));
    keyDown(result, "Enter");
    expect(onCommit).toHaveBeenCalledWith(fruits[2]);
  });

  it("Enter does nothing when menu is closed", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useCombobox<Fruit>({ items: fruits, getLabel: (f) => f.name, onCommit }),
    );
    keyDown(result, "Enter");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Enter commits null for synthetic prefix option", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useCombobox<Fruit>({
        items: fruits,
        getLabel: (f) => f.name,
        onCommit,
        syntheticPrefixCount: 1,
      }),
    );
    act(() => result.current.open());
    act(() => result.current.setHighlightIndex(0)); // synthetic option
    keyDown(result, "Enter");
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("Enter commits correct item with syntheticPrefixCount offset", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useCombobox<Fruit>({
        items: fruits,
        getLabel: (f) => f.name,
        onCommit,
        syntheticPrefixCount: 1,
      }),
    );
    act(() => result.current.open());
    act(() => result.current.setHighlightIndex(1)); // first real item
    keyDown(result, "Enter");
    expect(onCommit).toHaveBeenCalledWith(fruits[0]);
  });

  it("Escape closes menu", () => {
    const { result } = setup();
    act(() => result.current.open("test"));
    keyDown(result, "Escape");
    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe(""); // cleared because close(false)
  });

  // ---------------------------------------------------------------------------
  // Arrow navigation accounts for syntheticPrefixCount
  // ---------------------------------------------------------------------------

  it("ArrowDown clamps at totalCount including synthetic prefix", () => {
    const { result } = setup({ syntheticPrefixCount: 1 });
    act(() => result.current.open());
    // Total count = 4 items + 1 synthetic = 5
    for (let i = 0; i < 10; i++) keyDown(result, "ArrowDown");
    expect(result.current.highlightIndex).toBe(fruits.length); // 4, which is last (0-indexed in 5 total)
  });

  // ---------------------------------------------------------------------------
  // Outside click
  // ---------------------------------------------------------------------------

  it("closes menu on outside mousedown", () => {
    const { result } = setup();
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);

    // Simulate outside click
    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("does not close menu when clicking inside input ref", () => {
    const { result } = setup();
    act(() => result.current.open());

    // Create a fake element and point the ref to it
    const fakeInput = document.createElement("input");
    document.body.appendChild(fakeInput);
    (result.current.inputRef as { current: HTMLInputElement }).current = fakeInput;

    act(() => {
      fakeInput.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(result.current.isOpen).toBe(true);

    document.body.removeChild(fakeInput);
  });
});
