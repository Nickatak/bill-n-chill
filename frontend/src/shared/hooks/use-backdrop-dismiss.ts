import { type MouseEvent, useRef } from "react";

/**
 * Encapsulates the two-phase backdrop-dismiss pattern for modal overlays.
 *
 * Tracks whether a pointer interaction (mousedown → mouseup) started AND ended
 * on the backdrop element itself. This prevents accidental closes when a user
 * starts a click inside the modal content and drags outward onto the overlay.
 *
 * Usage:
 *   const dismiss = useBackdropDismiss(close);
 *   <div onMouseDown={dismiss.onMouseDown} onMouseUp={dismiss.onMouseUp}>…</div>
 */
export function useBackdropDismiss(onDismiss: () => void) {
  const startedOnBackdropRef = useRef(false);

  function onMouseDown(event: MouseEvent<HTMLDivElement>) {
    startedOnBackdropRef.current = event.target === event.currentTarget;
  }

  function onMouseUp(event: MouseEvent<HTMLDivElement>) {
    const endedOnBackdrop = event.target === event.currentTarget;
    if (startedOnBackdropRef.current && endedOnBackdrop) {
      onDismiss();
    }
    startedOnBackdropRef.current = false;
  }

  return { onMouseDown, onMouseUp };
}
