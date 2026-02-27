"use client";

import { ReactNode } from "react";

type BannerTone = "pending" | "complete";

type BannerConfig = {
  tone: BannerTone;
  eyebrow: string;
  text: string;
  linkHref?: string;
  linkLabel?: string;
  stateClassName?: string;
};

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

function joinClassNames(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

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
