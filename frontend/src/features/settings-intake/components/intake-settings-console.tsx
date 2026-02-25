"use client";

import { useIntakeSettingsController } from "../hooks/use-intake-settings-controller";
import styles from "./intake-settings-console.module.css";

export function IntakeSettingsConsole() {
  // Composition owner: wires controller state/actions into the settings form rendering.
  const controllerApi = useIntakeSettingsController();

  return (
    <section className={styles.console}>
      <div className={styles.header}>
        <h2>Intake Rules</h2>
        <p>Set the minimum data requirements for quick intake creation.</p>
      </div>
      <form className={styles.form} onSubmit={controllerApi.save}>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={controllerApi.settings.requireFullName}
            onChange={(event) => controllerApi.update("requireFullName", event.target.checked)}
          />
          <span>Require customer full name</span>
        </label>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={controllerApi.settings.requirePhoneOrEmail}
            onChange={(event) => controllerApi.update("requirePhoneOrEmail", event.target.checked)}
          />
          <span>Require at least one phone/email method</span>
        </label>
        <label className={styles.toggleRow}>
          <input
            type="checkbox"
            checked={controllerApi.settings.requireProjectAddress}
            onChange={(event) => controllerApi.update("requireProjectAddress", event.target.checked)}
          />
          <span>Require project address</span>
        </label>
        <div className={styles.actions}>
          <button type="submit">Save Settings</button>
        </div>
      </form>
      {controllerApi.message ? <p className={styles.statusMessage}>{controllerApi.message}</p> : null}
    </section>
  );
}
