import styles from "./pagination-controls.module.css";

type PaginationControlsProps = {
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
};

/**
 * Minimal Prev/Next pagination controls with item count.
 *
 * Hidden when totalPages <= 1 (everything fits on one page).
 */
export function PaginationControls({
  page,
  totalPages,
  totalCount,
  onPageChange,
}: PaginationControlsProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className={styles.root}>
      <button
        type="button"
        className={styles.button}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Prev
      </button>
      <span className={styles.label}>
        Page {page} of {totalPages} ({totalCount} items)
      </span>
      <button
        type="button"
        className={styles.button}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
