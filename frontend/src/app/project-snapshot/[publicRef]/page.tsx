"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import styles from "../../vendors/page.module.css";

type SnapshotResponse = {
  data?: {
    generated_at: string;
    project: {
      id: number;
      name: string;
      status: string;
      customer_display_name: string;
    };
    shared_from_estimate: {
      estimate_id: number;
      estimate_title: string;
      estimate_version: number;
      public_ref: string;
    };
    contract: {
      original: string;
      current: string;
      approved_change_orders_total: string;
    };
    invoices: {
      total_count: number;
      total_amount: string;
      outstanding_amount: string;
      status_counts: Record<string, number>;
    };
    payments: {
      total_count: number;
      settled_amount: string;
      status_counts: Record<string, number>;
    };
  };
  error?: { message?: string };
};

const defaultApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export default function ProjectSnapshotPage() {
  const params = useParams<{ publicRef: string }>();
  const publicRef = String(params?.publicRef ?? "");
  const [message, setMessage] = useState("Loading shared project snapshot...");
  const [snapshot, setSnapshot] = useState<SnapshotResponse["data"] | null>(null);

  useEffect(() => {
    if (!publicRef) {
      setMessage("Missing snapshot token.");
      return;
    }

    let cancelled = false;
    async function loadSnapshot() {
      try {
        const response = await fetch(`${defaultApiBaseUrl}/public/projects/${publicRef}/snapshot/`);
        const payload: SnapshotResponse = await response.json();
        if (!response.ok) {
          if (!cancelled) {
            setMessage(payload.error?.message ?? "Snapshot link not found.");
          }
          return;
        }
        if (!cancelled) {
          setSnapshot(payload.data ?? null);
          setMessage("Shared snapshot loaded.");
        }
      } catch {
        if (!cancelled) {
          setMessage("Could not reach shared snapshot endpoint.");
        }
      }
    }

    void loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [publicRef]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Client Project Snapshot</h1>
          <p>Read-only external summary of contract, approved changes, invoice, and payment status.</p>
        </header>
        <section className={styles.card}>
          {snapshot ? (
            <>
              <p>
                Project: {snapshot.project.name} ({snapshot.project.customer_display_name}) | Status:{" "}
                {snapshot.project.status}
              </p>
              <p>
                Shared from estimate: {snapshot.shared_from_estimate.estimate_title} v
                {snapshot.shared_from_estimate.estimate_version}
              </p>
              <p>
                Contract original {snapshot.contract.original} | current {snapshot.contract.current} |
                approved CO total {snapshot.contract.approved_change_orders_total}
              </p>
              <p>
                Invoices: {snapshot.invoices.total_count} total | amount {snapshot.invoices.total_amount} |
                outstanding {snapshot.invoices.outstanding_amount}
              </p>
              <p>
                Payments: {snapshot.payments.total_count} total | settled allocated{" "}
                {snapshot.payments.settled_amount}
              </p>
            </>
          ) : null}
          <p>{message}</p>
        </section>
      </main>
    </div>
  );
}
