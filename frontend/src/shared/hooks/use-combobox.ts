"use client";

import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";

export interface UseComboboxOptions<T> {
  /** Full list of items to filter against. */
  items: T[];
  /** Extract a searchable text label from an item. */
  getLabel: (item: T) => string;
  /** Called when an item is committed (selected via Enter, click, etc.). */
  onCommit: (item: T | null) => void;
  /**
   * Number of "synthetic" options rendered before the real items list
   * (e.g. a "No project" option). Offsets highlight indices accordingly.
   * @default 0
   */
  syntheticPrefixCount?: number;
}

export interface UseComboboxReturn<T> {
  /** Current search query string. */
  query: string;
  /** Set the search query (use for controlled input). */
  setQuery: (value: string) => void;
  /** Whether the dropdown menu is open. */
  isOpen: boolean;
  /** Index of the highlighted option (-1 = none). Includes synthetic prefix offset. */
  highlightIndex: number;
  /** Set the highlight index directly (e.g. on mouse enter). */
  setHighlightIndex: (index: number) => void;
  /** Filtered items based on query. */
  filteredItems: T[];
  /** Ref to attach to the input element. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Ref to attach to the menu container element. */
  menuRef: RefObject<HTMLDivElement | null>;
  /** Open the menu and optionally pre-fill the query. */
  open: (prefill?: string) => void;
  /** Close the menu and reset highlight. Clears query if nothing is selected. */
  close: (hasSelection: boolean) => void;
  /** Handle input value changes — opens menu and updates highlight. */
  handleInput: (value: string) => void;
  /** Keyboard handler for the input — arrow keys, Enter, Escape. */
  handleKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Generic combobox state and interaction hook.
 *
 * Manages query filtering, keyboard navigation (ArrowUp/Down, Enter, Escape),
 * highlight tracking, and outside-click dismissal. The consumer owns rendering
 * and selection state — this hook only manages the combobox interaction pattern.
 */
export function useCombobox<T>(options: UseComboboxOptions<T>): UseComboboxReturn<T> {
  const { items, getLabel, onCommit, syntheticPrefixCount = 0 } = options;

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Filter items by query
  const filteredItems = query.trim()
    ? items.filter((item) => getLabel(item).toLowerCase().includes(query.trim().toLowerCase()))
    : items;

  function open(prefill = "") {
    setQuery(prefill);
    setIsOpen(true);
    setHighlightIndex(-1);
  }

  function close(hasSelection: boolean) {
    setIsOpen(false);
    setHighlightIndex(-1);
    if (!hasSelection) setQuery("");
  }

  function handleInput(value: string) {
    setQuery(value);
    setIsOpen(true);
    // When typing, highlight the first real item (after any synthetic prefix)
    setHighlightIndex(value.trim() ? syntheticPrefixCount : (syntheticPrefixCount > 0 ? 0 : -1));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const totalCount = filteredItems.length + syntheticPrefixCount;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) { open(); return; }
      setHighlightIndex((i) => (i < totalCount - 1 ? i + 1 : i));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) { open(); return; }
      setHighlightIndex((i) => (i > 0 ? i - 1 : 0));
      return;
    }
    if (event.key === "Enter" && isOpen) {
      event.preventDefault();
      const realIndex = highlightIndex - syntheticPrefixCount;
      if (syntheticPrefixCount > 0 && highlightIndex < syntheticPrefixCount) {
        // A synthetic option was selected — commit null to let the consumer handle it
        onCommit(null);
      } else if (realIndex >= 0 && filteredItems[realIndex]) {
        onCommit(filteredItems[realIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close(false);
    }
  }

  // Dismiss menu on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (
        inputRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) return;
      setIsOpen(false);
      setHighlightIndex(-1);
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  return {
    query,
    setQuery,
    isOpen,
    highlightIndex,
    setHighlightIndex,
    filteredItems,
    inputRef,
    menuRef,
    open,
    close,
    handleInput,
    handleKeyDown,
  };
}
