"use client";

/**
 * Hook for managing Web Push notification subscriptions.
 *
 * Handles:
 * - Checking current permission/subscription state
 * - Requesting notification permission
 * - Subscribing via PushManager and sending the subscription to the backend
 * - Unsubscribing and removing from backend
 */

import { useCallback, useEffect, useState } from "react";

import { defaultApiBaseUrl, normalizeApiBaseUrl } from "@/shared/api/base";
import { buildAuthHeaders } from "@/shared/session/auth-headers";

const API_BASE = normalizeApiBaseUrl(defaultApiBaseUrl);

export type PushPermissionState = "prompt" | "granted" | "denied" | "unsupported";

type PushSubscriptionHook = {
  /** Current notification permission state. */
  permission: PushPermissionState;
  /** Whether the user has an active push subscription on this device. */
  isSubscribed: boolean;
  /** Loading state during subscribe/unsubscribe operations. */
  loading: boolean;
  /** Error message from the last operation, if any. */
  error: string;
  /** Subscribe this device for push notifications. */
  subscribe: () => Promise<void>;
  /** Unsubscribe this device from push notifications. */
  unsubscribe: () => Promise<void>;
};

function getPushPermission(): PushPermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission as PushPermissionState;
}

export function usePushSubscription(authToken: string): PushSubscriptionHook {
  const [permission, setPermission] = useState<PushPermissionState>(getPushPermission);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Check existing subscription state on mount.
  useEffect(() => {
    if (permission === "unsupported" || permission === "denied") return;

    let ignore = false;
    async function check() {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!ignore) setIsSubscribed(sub !== null);
      } catch {
        // Silently fail — permission might not be granted yet
      }
    }
    check();
    return () => { ignore = true; };
  }, [permission]);

  const subscribe = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      // Request permission if not already granted.
      const result = await Notification.requestPermission();
      setPermission(result as PushPermissionState);

      if (result !== "granted") {
        setError("Notification permission was denied.");
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setError("Push notifications are not configured.");
        return;
      }

      // Convert VAPID key from base64url to Uint8Array.
      const padding = "=".repeat((4 - (vapidPublicKey.length % 4)) % 4);
      const base64 = (vapidPublicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
      const rawData = atob(base64);
      const applicationServerKey = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; i++) {
        applicationServerKey[i] = rawData.charCodeAt(i);
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Send subscription to backend.
      const subJson = subscription.toJSON();
      const response = await fetch(`${API_BASE}/push/subscribe/`, {
        method: "POST",
        headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });

      if (!response.ok) {
        setError("Could not save push subscription.");
        return;
      }

      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to subscribe.");
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();

      if (subscription) {
        // Remove from backend first.
        await fetch(`${API_BASE}/push/unsubscribe/`, {
          method: "POST",
          headers: buildAuthHeaders(authToken, { contentType: "application/json" }),
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        // Unsubscribe from push service.
        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unsubscribe.");
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  return { permission, isSubscribed, loading, error, subscribe, unsubscribe };
}
