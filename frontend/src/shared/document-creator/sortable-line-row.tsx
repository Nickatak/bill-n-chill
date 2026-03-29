/**
 * Reusable sortable row wrapper for drag-and-drop line item reordering.
 *
 * Wraps a line row div with @dnd-kit sortable behavior and provides
 * a drag handle element via render prop. Desktop only — mobile uses
 * up/down arrow buttons instead.
 */

"use client";

import { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import creatorStyles from "./creator-foundation.module.css";

type SortableLineRowProps = {
  id: number;
  index: number;
  className: string;
  disabled?: boolean;
  children: (dragHandle: ReactNode) => ReactNode;
};

export function SortableLineRow({ id, index, className, disabled, children }: SortableLineRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    position: "relative" as const,
    zIndex: isDragging ? 1 : undefined,
  };

  const dragHandle = (index: number) => !disabled ? (
    <div
      className={creatorStyles.dragHandle}
      {...attributes}
      {...listeners}
    >
      <span className={creatorStyles.dragHandleGrip}>⠿</span>
      <span>{index + 1}</span>
    </div>
  ) : <div className={creatorStyles.dragHandle}>{index + 1}</div>;

  return (
    <div ref={setNodeRef} style={style} className={className}>
      {children(dragHandle(index))}
    </div>
  );
}
