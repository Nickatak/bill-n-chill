/**
 * Shared hook for client-side list pagination.
 *
 * Encapsulates the page-state management and slice math that several
 * console components duplicate. The hook owns the current-page state
 * and derives the visible page slice from the full item list.
 */
"use client";

import { useCallback, useState } from "react";

/** Paginates `items` into pages of `pageSize`, managing current-page state internally. */
export function usePagination<T>(items: T[], pageSize: number) {
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);

  const prevPage = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), []);
  const nextPage = useCallback(() => setCurrentPage((p) => Math.min(totalPages, p + 1)), [totalPages]);
  const resetPage = useCallback(() => setCurrentPage(1), []);

  return { pageItems, currentPage: safePage, totalPages, prevPage, nextPage, resetPage, setCurrentPage };
}
