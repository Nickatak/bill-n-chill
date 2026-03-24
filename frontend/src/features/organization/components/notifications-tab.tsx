"use client";

/**
 * "Notifications" tab — push notification subscription management.
 *
 * Allows users to enable/disable push notifications on the current device.
 * Shows permission state, subscription status, and actionable controls.
 *
 * Parent: OrganizationConsole
 */

import { usePushSubscription } from "@/shared/pwa";
import styles from "./organization-console.module.css";
import animStyles from "@/shared/styles/animations.module.css";

type NotificationsTabProps = {
  authToken: string;
};

export function NotificationsTab({ authToken }: NotificationsTabProps) {
  const { permission, isSubscribed, loading, error, subscribe, unsubscribe } =
    usePushSubscription(authToken);

  if (permission === "unsupported") {
    return (
      <div className={styles.profileForm}>
        <p className={styles.fieldLabel}>Push Notifications</p>
        <p className={styles.emptyText}>
          Push notifications are not supported in this browser. To receive notifications,
          use a supported browser (Chrome, Edge, Firefox) or install this app to your
          home screen on mobile.
        </p>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className={styles.profileForm}>
        <p className={styles.fieldLabel}>Push Notifications</p>
        <p className={styles.emptyText}>
          Notification permission has been blocked for this site. To enable notifications,
          update your browser&apos;s site permissions and reload the page.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.profileForm}>
      <p className={styles.fieldLabel}>Push Notifications</p>

      <p className={styles.emptyText}>
        {isSubscribed
          ? "Notifications are enabled on this device. You\u2019ll be notified when a customer approves, rejects, or disputes a document."
          : "Get notified instantly when a customer acts on an estimate, change order, or invoice. Notifications are per-device."}
      </p>

      {error ? <p className={styles.errorText}>{error}</p> : null}

      <div className={styles.profileActions}>
        {isSubscribed ? (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void unsubscribe()}
            disabled={loading}
          >
            {loading ? <span className={animStyles.sendingDots}>Disabling</span> : "Disable Notifications"}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void subscribe()}
            disabled={loading}
          >
            {loading ? <span className={animStyles.sendingDots}>Enabling</span> : "Enable Notifications"}
          </button>
        )}
      </div>

      <hr className={styles.fieldGroupDivider} />

      <p className={styles.fieldLabel}>Email Notifications</p>
      <p className={styles.emptyText}>
        Customers are automatically emailed when documents are sent. Controls to customize which emails are sent are coming soon.
      </p>
    </div>
  );
}
