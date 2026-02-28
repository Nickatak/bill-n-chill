/**
 * Controller hook for the intake settings page.
 *
 * Manages quick-add validation preferences that are persisted in
 * localStorage. These settings are browser-local (not synced to the
 * server) because they control client-side UX behavior rather than
 * business rules.
 */

"use client";

import { FormEvent, useState } from "react";

import { IntakeSettings, IntakeSettingsControllerApi } from "./intake-settings-controller.types";

const SETTINGS_KEY = "bnc-intake-settings-v1";

/** Sensible defaults — all validation gates enabled out of the box. */
const defaultSettings: IntakeSettings = {
  requireProjectAddress: true,
  requireFullName: true,
  requirePhoneOrEmail: true,
};

/**
 * Read intake settings from localStorage, falling back to defaults if
 * the stored value is missing, corrupt, or unreadable.
 */
function loadSettings(): IntakeSettings {
  if (typeof window === "undefined") {
    return defaultSettings;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return defaultSettings;
    }
    const parsed = JSON.parse(raw) as Partial<IntakeSettings>;
    return {
      requireProjectAddress: parsed.requireProjectAddress ?? defaultSettings.requireProjectAddress,
      requireFullName: parsed.requireFullName ?? defaultSettings.requireFullName,
      requirePhoneOrEmail: parsed.requirePhoneOrEmail ?? defaultSettings.requirePhoneOrEmail,
    };
  } catch {
    return defaultSettings;
  }
}

/**
 * Provide reactive settings state with update and save operations.
 *
 * `update` applies an individual toggle change to the in-memory state.
 * `save` persists the full settings object to localStorage and shows a
 * confirmation message.
 */
export function useIntakeSettingsController(): IntakeSettingsControllerApi {
  const [settings, setSettings] = useState<IntakeSettings>(() => loadSettings());
  const [message, setMessage] = useState("");

  const controllerApi: IntakeSettingsControllerApi = {
    settings,
    message,

    /** Apply a single setting toggle without persisting yet. */
    update(key, value) {
      setSettings((current) => ({ ...current, [key]: value }));
    },

    /** Persist the current settings snapshot to localStorage. */
    save(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        setMessage("Saved locally for this browser.");
      } catch {
        setMessage("Could not save settings in this browser.");
      }
    },
  };

  return controllerApi;
}
