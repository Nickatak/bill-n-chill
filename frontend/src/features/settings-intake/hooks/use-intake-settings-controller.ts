"use client";

import { FormEvent, useState } from "react";

import { IntakeSettings, IntakeSettingsControllerApi } from "./intake-settings-controller.types";

const SETTINGS_KEY = "bnc-intake-settings-v1";

const defaultSettings: IntakeSettings = {
  requireProjectAddress: true,
  requireFullName: true,
  requirePhoneOrEmail: true,
};

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

export function useIntakeSettingsController(): IntakeSettingsControllerApi {
  const [settings, setSettings] = useState<IntakeSettings>(() => loadSettings());
  const [message, setMessage] = useState("");

  const controllerApi: IntakeSettingsControllerApi = {
    settings,
    message,
    update(key, value) {
      setSettings((current) => ({ ...current, [key]: value }));
    },
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
