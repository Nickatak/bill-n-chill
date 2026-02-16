"use client";

import { FormEvent, useState } from "react";
import styles from "../../vendors/page.module.css";

const SETTINGS_KEY = "bnc-intake-settings-v1";

type IntakeSettings = {
  requireProjectAddress: boolean;
  requireFullName: boolean;
  requirePhoneOrEmail: boolean;
};

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

export default function IntakeSettingsPage() {
  const [settings, setSettings] = useState<IntakeSettings>(() => loadSettings());
  const [message, setMessage] = useState("");

  function update<K extends keyof IntakeSettings>(key: K, value: IntakeSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      setMessage("Saved locally for this browser.");
    } catch {
      setMessage("Could not save settings in this browser.");
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Intake Form Settings</h1>
          <p>
            Configure intake guardrails for operations use. These settings are local-only for now,
            and will be connected to server-side policy in a later phase.
          </p>
        </header>
        <section className={styles.card}>
          <form onSubmit={save}>
            <label>
              <input
                type="checkbox"
                checked={settings.requireFullName}
                onChange={(event) => update("requireFullName", event.target.checked)}
              />
              Require contact full name
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.requirePhoneOrEmail}
                onChange={(event) => update("requirePhoneOrEmail", event.target.checked)}
              />
              Require at least one contact method (phone or email)
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.requireProjectAddress}
                onChange={(event) => update("requireProjectAddress", event.target.checked)}
              />
              Require project address
            </label>
            <button type="submit">Save Settings</button>
          </form>
          <p>{message}</p>
        </section>
      </main>
    </div>
  );
}
