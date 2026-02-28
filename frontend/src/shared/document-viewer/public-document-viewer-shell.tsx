/**
 * Layout shell for public document viewer pages.
 *
 * Wraps the document content with an optional status message and a
 * configurable banner (e.g. "Awaiting your approval" or "Payment received").
 * Accepts a full classNames map so each document type can apply its own
 * CSS module styles while sharing the same structural markup.
 */

"use client";

import { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BannerTone = "pending" | "complete";

/** Configuration for the optional status banner shown above the document. */
type BannerConfig = {
  tone: BannerTone;
  eyebrow: string;
  text: string;
  linkHref?: string;
  linkLabel?: string;
  stateClassName?: string;
};

/** CSS module class names the shell requires from each consumer. */
type PublicDocumentViewerShellClassNames = {
  root: string;
  statusMessage: string;
  banner: string;
  bannerPending: string;
  bannerComplete: string;
  bannerBody: string;
  bannerEyebrow: string;
  bannerText: string;
  bannerLink: string;
};

type PublicDocumentViewerShellProps = {
  classNames: PublicDocumentViewerShellClassNames;
  statusMessage?: string;
  banner?: BannerConfig;
  children: ReactNode;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Join class name fragments, filtering out falsy values. */
function joinClassNames(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Render the outer shell of a public document viewer page.
 *
 * The shell provides three visual layers:
 * 1. An optional single-line status message (e.g. loading/error feedback)
 * 2. An optional tone-colored banner for workflow state indication
 * 3. The document content itself (passed as children)
 */
export function PublicDocumentViewerShell({
  classNames,
  statusMessage,
  banner,
  children,
}: PublicDocumentViewerShellProps) {
  return (
    <section className={classNames.root}>
      {statusMessage ? <p className={classNames.statusMessage}>{statusMessage}</p> : null}

      {banner ? (
        <section
          className={joinClassNames(
            classNames.banner,
            banner.tone === "pending" ? classNames.bannerPending : classNames.bannerComplete,
            banner.stateClassName,
          )}
        >
          <div className={classNames.bannerBody}>
            <p className={classNames.bannerEyebrow}>{banner.eyebrow}</p>
            <p className={classNames.bannerText}>{banner.text}</p>
          </div>
          {banner.linkHref && banner.linkLabel ? (
            <a href={banner.linkHref} className={classNames.bannerLink}>
              {banner.linkLabel}
            </a>
          ) : null}
        </section>
      ) : null}

      {children}
    </section>
  );
}
