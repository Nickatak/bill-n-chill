"use client";

import { useCallback, useState } from "react";

/** Constraint: every line item type must have a numeric localId. */
interface HasLocalId {
  localId: number;
}

export interface UseLineItemsOptions<T extends HasLocalId> {
  /** Factory that creates a blank line item with the given localId. */
  createEmpty: (localId: number) => T;
  /** Initial line items (defaults to a single empty line with localId=1). */
  initialItems?: T[];
}

export interface UseLineItemsReturn<T extends HasLocalId> {
  /** Current line items array. */
  items: T[];
  /** Replace the entire items array (e.g. when hydrating from API data). */
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
  /** Current next-ID counter value. */
  nextId: number;
  /** Set the next-ID counter (e.g. when hydrating). */
  setNextId: React.Dispatch<React.SetStateAction<number>>;
  /** Append a new blank line item. Returns the new localId. */
  add: () => number;
  /** Remove a line item by localId. Returns false if at minimum (1 item). */
  remove: (localId: number) => boolean;
  /** Patch one or more fields on a line item by localId. */
  update: (localId: number, patch: Partial<T>) => void;
  /** Move a line item up or down by one position. */
  move: (localId: number, direction: "up" | "down") => void;
  /** Reorder a line item from its current position to the position of another item. */
  reorder: (activeId: number, overId: number) => void;
  /** Duplicate an existing line item with a new localId. Returns the new localId. */
  duplicate: (localId: number) => number;
  /** Reset to a single empty line with localId=1. */
  reset: () => void;
}

/**
 * Generic line item CRUD hook.
 *
 * Manages an array of line items with auto-incrementing localId,
 * providing add, remove, update, move, and reset operations.
 * The consumer provides a factory for creating empty lines and
 * handles domain-specific error reporting (e.g. min-line enforcement).
 */
export function useLineItems<T extends HasLocalId>(
  options: UseLineItemsOptions<T>,
): UseLineItemsReturn<T> {
  const { createEmpty, initialItems } = options;
  const [items, setItems] = useState<T[]>(() => initialItems ?? [createEmpty(1)]);
  const [nextId, setNextId] = useState(() => {
    if (initialItems && initialItems.length > 0) {
      return Math.max(...initialItems.map((item) => item.localId)) + 1;
    }
    return 2;
  });

  const add = useCallback((): number => {
    const localId = nextId;
    setNextId((current) => current + 1);
    setItems((current) => [...current, createEmpty(localId)]);
    return localId;
  }, [nextId, createEmpty]);

  const remove = useCallback((localId: number): boolean => {
    let removed = false;
    setItems((current) => {
      if (current.length <= 1) return current;
      removed = true;
      return current.filter((line) => line.localId !== localId);
    });
    return removed;
  }, []);

  const update = useCallback((localId: number, patch: Partial<T>) => {
    setItems((current) =>
      current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  }, []);

  const move = useCallback((localId: number, direction: "up" | "down") => {
    setItems((current) => {
      const index = current.findIndex((line) => line.localId === localId);
      if (index === -1) return current;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }, []);

  const reorder = useCallback((activeId: number, overId: number) => {
    setItems((current) => {
      const oldIndex = current.findIndex((item) => item.localId === activeId);
      const newIndex = current.findIndex((item) => item.localId === overId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return current;
      const next = [...current];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      return next;
    });
  }, []);

  const duplicate = useCallback((localId: number): number => {
    const newLocalId = nextId;
    setNextId((current) => current + 1);
    setItems((current) => {
      const source = current.find((line) => line.localId === localId);
      if (!source) return current;
      return [...current, { ...source, localId: newLocalId }];
    });
    return newLocalId;
  }, [nextId]);

  const reset = useCallback(() => {
    setItems([createEmpty(1)]);
    setNextId(2);
  }, [createEmpty]);

  return { items, setItems, nextId, setNextId, add, remove, update, move, reorder, duplicate, reset };
}
