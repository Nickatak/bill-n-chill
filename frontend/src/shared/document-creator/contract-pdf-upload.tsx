"use client";

import { ChangeEvent, useRef, useState } from "react";
import { buildAuthHeaders } from "@/shared/session/auth-headers";
import { apiBaseUrl } from "@/shared/api/base";
import styles from "./contract-pdf-upload.module.css";

type ContractPdfUploadProps = {
  /** Current URL of the uploaded contract PDF (empty string if none). */
  contractPdfUrl: string;
  /** API path segment: e.g. "estimates/42" or "change-orders/7". */
  documentPath: string;
  authToken: string;
  readOnly: boolean;
  /** Called with the updated contract_pdf_url after upload/delete. */
  onUpdate: (newUrl: string) => void;
};

export function ContractPdfUpload({
  contractPdfUrl,
  documentPath,
  authToken,
  readOnly,
  onUpdate,
}: ContractPdfUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    setError("");
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("contract_pdf", file);

      const res = await fetch(`${apiBaseUrl}/${documentPath}/contract-pdf/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken),
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message || "Upload failed.");
        return;
      }
      onUpdate(body.data?.contract_pdf_url ?? "");
    } catch {
      setError("Could not reach upload endpoint.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRemove() {
    setError("");
    setIsUploading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/${documentPath}/contract-pdf/`, {
        method: "DELETE",
        headers: buildAuthHeaders(authToken),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message || "Delete failed.");
        return;
      }
      onUpdate("");
    } catch {
      setError("Could not reach delete endpoint.");
    } finally {
      setIsUploading(false);
    }
  }

  const filename = contractPdfUrl ? contractPdfUrl.split("/").pop() : "";

  return (
    <div className={styles.container}>
      <h4 className={styles.heading}>Contract Attachment</h4>

      {contractPdfUrl ? (
        <div className={styles.fileRow}>
          <a
            href={contractPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.fileLink}
          >
            {filename}
          </a>
          {!readOnly && (
            <button
              type="button"
              className={styles.removeButton}
              onClick={handleRemove}
              disabled={isUploading}
            >
              {isUploading ? "Removing..." : "Remove"}
            </button>
          )}
        </div>
      ) : (
        <p className={styles.emptyLabel}>No contract attached.</p>
      )}

      {!readOnly && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            className={styles.fileInput}
          />
          <button
            type="button"
            className={styles.uploadButton}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Uploading..." : contractPdfUrl ? "Replace PDF" : "Attach PDF"}
          </button>
        </>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
