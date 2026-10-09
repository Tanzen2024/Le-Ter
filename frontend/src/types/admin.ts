/** Interrupteur global de la détection anti-collusion (D-053), tel que renvoyé par l'API. */
export interface DetectionSetting {
  enabled: boolean;
  updatedAt: string | null;
}

export interface DetectionSettingChange extends DetectionSetting {
  changed: boolean;
}
