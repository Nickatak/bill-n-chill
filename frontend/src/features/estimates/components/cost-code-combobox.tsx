/**
 * Accessible combobox for selecting a cost code.
 *
 * Used on line-item rows in estimate, invoice, and change-order composers.
 * Supports keyboard navigation, type-ahead filtering, an optional "no cost
 * code" empty selection, and portal-rendered dropdown positioning so the
 * menu isn't clipped by overflow-hidden ancestors.
 */

"use client";

import Link from "next/link";
import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./cost-code-combobox.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CostCodeOption = {
  id: number;
  code: string;
  name: string;
};

type CostCodeComboboxProps = {
  costCodes: CostCodeOption[];
  value: string;
  onChange: (nextValue: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  allowEmptySelection?: boolean;
  emptySelectionLabel?: string;
  placeholder?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the display label shown in the input when an option is selected. */
function labelForCostCode(option: CostCodeOption): string {
  return `${option.code} - ${option.name}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render a searchable combobox for cost code selection.
 *
 * The dropdown is rendered into a portal so it can overflow parent containers
 * (e.g. table cells). Position is recalculated on scroll/resize to stay
 * anchored to the input.
 */
export function CostCodeCombobox({
  costCodes,
  value,
  onChange,
  ariaLabel,
  disabled = false,
  allowEmptySelection = false,
  emptySelectionLabel = "No cost code",
  placeholder = "Type to search cost codes",
}: CostCodeComboboxProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const hasOptions = costCodes.length > 0;
  const disabledState = disabled || !hasOptions;
  const selectedOption = costCodes.find((option) => String(option.id) === value) ?? null;

  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });

  /** Filter the option list by the current search query. */
  const filteredOptions = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) {
      return costCodes;
    }
    return costCodes.filter((option) =>
      `${option.code} ${option.name}`.toLowerCase().includes(needle),
    );
  }, [costCodes, searchQuery]);

  /** Close the menu and optionally reset the search query when nothing is selected. */
  function closeMenu({ clearQueryIfUnselected = false }: { clearQueryIfUnselected?: boolean } = {}) {
    setIsOpen(false);
    setHighlightedIndex(-1);
    if (clearQueryIfUnselected && !selectedOption) {
      setSearchQuery("");
    }
  }

  // Dismiss the menu when the user clicks outside the combobox or its portal menu.
  useEffect(() => {
    function handleOutsideMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        !rootRef.current ||
        !target ||
        rootRef.current.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
      setHighlightedIndex(-1);
      if (!selectedOption) {
        setSearchQuery("");
      }
    }

    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () => document.removeEventListener("mousedown", handleOutsideMouseDown);
  }, [selectedOption]);

  /** Measure the input's bounding rect and update the portal menu position. */
  function syncMenuPosition() {
    if (!inputRef.current) {
      return;
    }
    const rect = inputRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }

  // Keep the portal menu anchored to the input during scroll and resize.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    syncMenuPosition();

    function handleViewportChange() {
      syncMenuPosition();
    }

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isOpen]);

  /** Open the dropdown, pre-selecting the current value when present. */
  function openMenu({ preserveQuery = false }: { preserveQuery?: boolean } = {}) {
    if (disabledState) {
      return;
    }
    if (!preserveQuery) {
      setSearchQuery(selectedOption ? labelForCostCode(selectedOption) : "");
    }
    syncMenuPosition();
    setIsOpen(true);

    // When a value is selected, the clear option (or empty-selection) occupies index 0,
    // so the selected item's index shifts by 1.
    const leadingOffset = (allowEmptySelection || selectedOption) ? 1 : 0;

    if (selectedOption) {
      const selectedInFilteredIndex = filteredOptions.findIndex(
        (option) => option.id === selectedOption.id,
      );
      if (selectedInFilteredIndex >= 0) {
        setHighlightedIndex(selectedInFilteredIndex + leadingOffset);
        return;
      }
      setHighlightedIndex(0);
      return;
    }

    if (filteredOptions.length === 0 && !allowEmptySelection) {
      setHighlightedIndex(-1);
      return;
    }
    setHighlightedIndex(0);
  }

  /** Finalize a selection, update the parent value, and close the menu. */
  function commitSelection(option: CostCodeOption | null) {
    if (!option) {
      onChange("");
      setSearchQuery("");
      closeMenu();
      return;
    }
    onChange(String(option.id));
    setSearchQuery(labelForCostCode(option));
    closeMenu();
  }

  /** Handle live typing: filter options and clear stale selection. */
  function handleInputChange(nextValue: string) {
    setSearchQuery(nextValue);
    setIsOpen(true);
    // When typing, the clear option disappears (selectedOption gets cleared below),
    // so only allowEmptySelection provides a leading slot during active typing.
    if (!nextValue.trim()) {
      setHighlightedIndex(allowEmptySelection ? 0 : -1);
    } else {
      setHighlightedIndex(allowEmptySelection ? 1 : 0);
    }

    if (!nextValue.trim()) {
      if (allowEmptySelection) {
        onChange("");
      } else if (value) {
        onChange("");
      }
      return;
    }

    if (selectedOption) {
      onChange("");
    }
  }

  /** Whether the dropdown has a leading slot (empty selection or clear option) at index 0. */
  const hasClearOption = !allowEmptySelection && !!selectedOption;
  const hasLeadingSlot = allowEmptySelection || hasClearOption;

  /** Handle keyboard navigation and selection within the dropdown. */
  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const navigableCount = filteredOptions.length + (hasLeadingSlot ? 1 : 0);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      if (navigableCount === 0) {
        return;
      }
      setHighlightedIndex((current) =>
        current < navigableCount - 1 ? current + 1 : navigableCount - 1,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
        return;
      }
      if (navigableCount === 0) {
        return;
      }
      setHighlightedIndex((current) => (current > 0 ? current - 1 : 0));
      return;
    }

    if (event.key === "Enter" && isOpen) {
      event.preventDefault();
      if (hasLeadingSlot && highlightedIndex === 0) {
        commitSelection(null);
        return;
      }
      const nextIndex = hasLeadingSlot ? highlightedIndex - 1 : highlightedIndex;
      if (nextIndex >= 0 && filteredOptions[nextIndex]) {
        commitSelection(filteredOptions[nextIndex]);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu({ clearQueryIfUnselected: true });
    }
  }

  /** Clear the current selection and re-open the menu for a fresh search. */
  function handleClearSelection() {
    if (disabledState) {
      return;
    }
    onChange("");
    setSearchQuery("");
    setIsOpen(true);
    if (allowEmptySelection) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex(filteredOptions.length > 0 ? 0 : -1);
    inputRef.current?.focus();
  }

  const activeDescendantId = (() => {
    if (!isOpen || highlightedIndex < 0) {
      return undefined;
    }
    if (hasLeadingSlot && highlightedIndex === 0) {
      return allowEmptySelection ? `${listboxId}-none` : `${listboxId}-clear`;
    }
    const nextIndex = hasLeadingSlot ? highlightedIndex - 1 : highlightedIndex;
    if (nextIndex < 0 || !filteredOptions[nextIndex]) {
      return undefined;
    }
    return `${listboxId}-${filteredOptions[nextIndex].id}`;
  })();

  const displayValue = isOpen
    ? searchQuery
    : selectedOption
      ? labelForCostCode(selectedOption)
      : searchQuery;

  return (
    <div ref={rootRef} className={styles.combobox}>
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          className={`${styles.input} ${disabledState ? styles.inputDisabled : ""}`}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeDescendantId}
          value={displayValue}
          onFocus={() => openMenu()}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onBlur={() => closeMenu({ clearQueryIfUnselected: true })}
          disabled={disabledState}
          placeholder={hasOptions ? placeholder : "No cost codes available"}
          autoComplete="off"
        />
        <button
          type="button"
          className={styles.clearButton}
          aria-label="Reset and open cost code options"
          title="Reset and open options"
          disabled={disabledState}
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleClearSelection}
        >
          ▾
        </button>
      </div>

      {isOpen
        ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          className={styles.menu}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
          }}
        >
          {allowEmptySelection ? (
            <button
              id={`${listboxId}-none`}
              type="button"
              role="option"
              aria-selected={value === ""}
              className={`${styles.option} ${highlightedIndex === 0 ? styles.optionActive : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(0)}
              onClick={() => commitSelection(null)}
            >
              <span className={styles.optionCode}>None</span>
              <span className={styles.optionName}>{emptySelectionLabel}</span>
            </button>
          ) : null}

          {!allowEmptySelection && selectedOption ? (
            <button
              id={`${listboxId}-clear`}
              type="button"
              role="option"
              aria-selected={false}
              className={`${styles.option} ${styles.clearOption} ${highlightedIndex === 0 ? styles.optionActive : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(0)}
              onClick={() => commitSelection(null)}
            >
              <span className={styles.clearOptionLabel}>Clear selection</span>
            </button>
          ) : null}

          {filteredOptions.map((option, index) => {
            const hasClearOption = !allowEmptySelection && selectedOption;
            const optionIndex = (allowEmptySelection || hasClearOption) ? index + 1 : index;
            const isActive = highlightedIndex === optionIndex;
            return (
              <button
                id={`${listboxId}-${option.id}`}
                key={option.id}
                type="button"
                role="option"
                aria-selected={String(option.id) === value}
                className={`${styles.option} ${isActive ? styles.optionActive : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(optionIndex)}
                onClick={() => commitSelection(option)}
              >
                <span className={styles.optionCode}>{option.code}</span>
                <span className={styles.optionName}>{option.name}</span>
              </button>
            );
          })}

          {filteredOptions.length === 0 ? (
            <div className={styles.noResults}>
              No matching cost codes.{" "}
              <Link href="/cost-codes" className={styles.manageCodesLink}>
                Manage cost codes
              </Link>
              .
            </div>
          ) : null}
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
