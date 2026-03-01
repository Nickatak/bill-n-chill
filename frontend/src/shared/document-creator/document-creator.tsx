/**
 * Generic document creator component.
 *
 * Renders a slot-based form layout shared by all financial document editors
 * (invoices, estimates, change orders). Each document type provides its own
 * adapter and section renderers; this component owns the section iteration,
 * visibility gating, and action-button bar.
 */

import styles from "./document-creator.module.css";
import {
  CreatorLineDraft,
  CreatorSectionConfig,
  DocumentCreatorProps,
} from "./types";

/** Default section ordering when no custom layout is provided. */
const DEFAULT_SECTIONS: CreatorSectionConfig[] = [
  { slot: "header" },
  { slot: "meta" },
  { slot: "line_items" },
  { slot: "totals" },
  { slot: "status" },
  { slot: "status_events" },
  { slot: "context" },
  { slot: "footer" },
];

/**
 * Render a slot-driven document creator form.
 *
 * Iterates the section list, delegates rendering to the matching renderer
 * for each slot, and appends an action-button bar when actions are provided.
 * Sections whose renderer returns null or whose `visible` flag is false are
 * silently skipped, so feature-specific sections can be toggled per document type.
 */
export function DocumentCreator<TDocument, TLine extends CreatorLineDraft, TFormState>({
  adapter,
  document,
  className = "",
  sectionClassName = "",
  onSubmit,
  sections = DEFAULT_SECTIONS,
  actions = [],
  renderers = {},
}: DocumentCreatorProps<TDocument, TLine, TFormState>) {
  const context = {
    kind: adapter.kind,
    document,
  } as const;

  return (
    <form
      className={`${styles.composerForm} ${className}`.trim()}
      onSubmit={onSubmit}
    >
      {sections.map((section) => {
        if (section.visible === false) {
          return null;
        }
        const render = renderers[section.slot];
        if (!render) {
          return null;
        }
        const content = render(context);
        if (!content) {
          return null;
        }
        return (
          <section
            key={section.slot}
            className={`${styles.composerSection} ${sectionClassName}`.trim()}
            data-slot={section.slot}
            aria-label={section.title || section.slot}
          >
            {content}
          </section>
        );
      })}

      {actions.length ? (
        <section className={`${styles.composerSection} ${sectionClassName}`.trim()} data-slot="actions">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => void action.onClick()}
              disabled={action.disabled}
              data-tone={action.tone || "secondary"}
            >
              {action.label}
            </button>
          ))}
        </section>
      ) : null}
    </form>
  );
}
