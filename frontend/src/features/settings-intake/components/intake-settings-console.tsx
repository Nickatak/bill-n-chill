"use client";

import { useIntakeSettingsController } from "../hooks/use-intake-settings-controller";

export function IntakeSettingsConsole() {
  // Composition owner: wires controller state/actions into the settings form rendering.
  const controllerApi = useIntakeSettingsController();

  return (
    <>
      <h1>Settings (WIP)</h1>
      <p>
        Configure intake guardrails for operations use. This settings surface is still WIP and
        currently local-only.
      </p>
      <form onSubmit={controllerApi.save}>
        <label>
          <input
            type="checkbox"
            checked={controllerApi.settings.requireFullName}
            onChange={(event) => controllerApi.update("requireFullName", event.target.checked)}
          />
          Require customer full name
        </label>
        <label>
          <input
            type="checkbox"
            checked={controllerApi.settings.requirePhoneOrEmail}
            onChange={(event) => controllerApi.update("requirePhoneOrEmail", event.target.checked)}
          />
          Require at least one phone/email method
        </label>
        <label>
          <input
            type="checkbox"
            checked={controllerApi.settings.requireProjectAddress}
            onChange={(event) => controllerApi.update("requireProjectAddress", event.target.checked)}
          />
          Require project address
        </label>
        <button type="submit">Save Settings</button>
      </form>
      <p>{controllerApi.message}</p>
    </>
  );
}
