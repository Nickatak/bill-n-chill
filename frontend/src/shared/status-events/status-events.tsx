"use client";

import type { ReactNode } from "react";
import styles from "./status-events.module.css";

export type StatusEvent = {
  id: number | string;
  badge: { label: string; className: string };
  date: string;
  note: string;
  actor: ReactNode;
};

type Props = {
  events: StatusEvent[];
  title?: string;
  className?: string;
};

export function StatusEvents({ events, title = "Status Events", className }: Props) {
  if (events.length === 0) return null;

  return (
    <section className={`${styles.root}${className ? ` ${className}` : ""}`}>
      <h4 className={styles.title}>{title}</h4>
      <div className={styles.list}>
        {events.map((event) => (
          <article key={event.id} className={styles.card}>
            <div className={styles.header}>
              <span className={event.badge.className}>
                {event.badge.label}
              </span>
              <time className={styles.date}>{event.date}</time>
            </div>
            {event.note ? (
              <p className={styles.note}>{event.note}</p>
            ) : null}
            <div className={styles.actor}>{event.actor}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
