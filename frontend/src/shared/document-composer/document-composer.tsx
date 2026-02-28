import styles from "./document-composer.module.css";
import {
  ComposerLineDraft,
  ComposerSectionConfig,
  DocumentComposerProps,
} from "./types";

const DEFAULT_SECTIONS: ComposerSectionConfig[] = [
  { slot: "header" },
  { slot: "meta" },
  { slot: "line_items" },
  { slot: "totals" },
  { slot: "status" },
  { slot: "status_events" },
  { slot: "context" },
  { slot: "footer" },
];

export function DocumentComposer<TDocument, TLine extends ComposerLineDraft, TFormState>({
  adapter,
  document,
  className = "",
  sectionClassName = "",
  onSubmit,
  sections = DEFAULT_SECTIONS,
  actions = [],
  renderers = {},
}: DocumentComposerProps<TDocument, TLine, TFormState>) {
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
