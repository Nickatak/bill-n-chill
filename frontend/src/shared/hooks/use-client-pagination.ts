import { useEffect, useMemo, useState } from "react";

/**
 * Client-side pagination for an already-loaded list.
 *
 * Slices `items` into pages of `pageSize` and provides navigation state.
 * Resets to page 1 whenever the item count changes (e.g. new filter applied).
 */
export function useClientPagination<T>(items: T[], pageSize = 20) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );

  useEffect(() => {
    setPage(1); // eslint-disable-line react-hooks/set-state-in-effect -- reset page on item count change
  }, [items.length]);

  return {
    page: safePage,
    totalPages,
    totalCount: items.length,
    paginatedItems,
    setPage,
  } as const;
}
