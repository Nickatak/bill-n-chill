import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useCreatorFlash } from "../hooks/use-creator-flash";

describe("useCreatorFlash", () => {
  it("returns a ref and a flash function", () => {
    const { result } = renderHook(() => useCreatorFlash());
    expect(result.current.ref).toBeDefined();
    expect(result.current.ref.current).toBeNull();
    expect(typeof result.current.flash).toBe("function");
  });

  it("flash() adds and removes the animation class on the ref element", () => {
    const { result } = renderHook(() => useCreatorFlash());

    const el = document.createElement("div");
    (result.current.ref as { current: HTMLDivElement }).current = el;

    const addSpy = vi.spyOn(el.classList, "add");
    const removeSpy = vi.spyOn(el.classList, "remove");

    act(() => result.current.flash());

    // Should have removed (reflow reset) then added the class
    expect(removeSpy).toHaveBeenCalled();
    expect(addSpy).toHaveBeenCalled();
  });

  it("does not throw when ref is null", () => {
    const { result } = renderHook(() => useCreatorFlash());
    expect(() => {
      act(() => result.current.flash());
    }).not.toThrow();
  });

  it("flash is stable across renders", () => {
    const { result, rerender } = renderHook(() => useCreatorFlash());
    const first = result.current.flash;
    rerender();
    expect(result.current.flash).toBe(first);
  });

  it("successive flashes increment the internal counter", () => {
    const { result } = renderHook(() => useCreatorFlash());
    const el = document.createElement("div");
    (result.current.ref as { current: HTMLDivElement }).current = el;

    const addSpy = vi.spyOn(el.classList, "add");

    act(() => result.current.flash());
    act(() => result.current.flash());

    // Should have been called twice (once per flash)
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
