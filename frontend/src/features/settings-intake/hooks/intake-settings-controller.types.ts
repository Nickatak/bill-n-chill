import { FormEvent } from "react";

export type IntakeSettings = {
  requireProjectAddress: boolean;
  requireFullName: boolean;
  requirePhoneOrEmail: boolean;
};

export type IntakeSettingsControllerApi = {
  settings: IntakeSettings;
  message: string;
  update: <K extends keyof IntakeSettings>(key: K, value: IntakeSettings[K]) => void;
  save: (event: FormEvent<HTMLFormElement>) => void;
};
