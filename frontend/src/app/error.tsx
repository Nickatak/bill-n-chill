"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: "var(--space-xl)", maxWidth: 480 }}>
      <h2>Something went wrong</h2>
      <p style={{ color: "var(--text-secondary)", margin: "var(--space-sm) 0 var(--space-md)" }}>
        An unexpected error occurred. You can try again or refresh the page.
      </p>
      {process.env.NODE_ENV === "development" && error.message ? (
        <pre
          style={{
            fontSize: "0.8rem",
            padding: "var(--space-sm)",
            background: "var(--surface-secondary)",
            borderRadius: 4,
            overflow: "auto",
            marginBottom: "var(--space-md)",
          }}
        >
          {error.message}
        </pre>
      ) : null}
      <button type="button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
