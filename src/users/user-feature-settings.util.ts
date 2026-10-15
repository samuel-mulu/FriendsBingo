export type UserFeatureSettingsInput = {
  autoMarkGranted: boolean;
  autoBingoGranted: boolean;
  autoMarkEnabled: boolean;
  autoBingoEnabled: boolean;
};

export type EffectiveUserFeatureSettings = {
  effectiveAutoMark: boolean;
  effectiveAutoBingo: boolean;
};

export type AdminFeatureGrantPatch = {
  autoMarkGranted?: boolean;
  autoBingoGranted?: boolean;
};

export type AdminFeatureGrantComputation = {
  nextAutoMarkGranted: boolean;
  nextAutoBingoGranted: boolean;
  nextAutoMarkEnabled: boolean;
  nextAutoBingoEnabled: boolean;
  changedFields: string[];
  mutated: boolean;
};

/**
 * Server-side effective feature flags.
 * Never trust client-submitted effective* values — always recompute from grants + prefs.
 */
export function computeEffectiveFeatureSettings(
  input: UserFeatureSettingsInput,
): EffectiveUserFeatureSettings {
  return {
    effectiveAutoMark: input.autoMarkGranted && input.autoMarkEnabled,
    effectiveAutoBingo: input.autoBingoGranted && input.autoBingoEnabled,
  };
}

/**
 * Shared A3/A4 grant semantics:
 * - revoke clears matching enabled preference
 * - newly granted access leaves preference OFF
 * - already-granted + already-enabled stays enabled on no-op grant
 */
export function computeAdminFeatureGrantPatch(
  current: UserFeatureSettingsInput,
  patch: AdminFeatureGrantPatch,
): AdminFeatureGrantComputation {
  const nextAutoMarkGranted =
    patch.autoMarkGranted === undefined
      ? current.autoMarkGranted
      : patch.autoMarkGranted;
  const nextAutoBingoGranted =
    patch.autoBingoGranted === undefined
      ? current.autoBingoGranted
      : patch.autoBingoGranted;

  let nextAutoMarkEnabled = current.autoMarkEnabled;
  let nextAutoBingoEnabled = current.autoBingoEnabled;

  if (patch.autoMarkGranted === false) {
    nextAutoMarkEnabled = false;
  } else if (patch.autoMarkGranted === true && !current.autoMarkGranted) {
    nextAutoMarkEnabled = false;
  }

  if (patch.autoBingoGranted === false) {
    nextAutoBingoEnabled = false;
  } else if (patch.autoBingoGranted === true && !current.autoBingoGranted) {
    nextAutoBingoEnabled = false;
  }

  const changedFields: string[] = [];
  if (nextAutoMarkGranted !== current.autoMarkGranted) {
    changedFields.push('autoMarkGranted');
  }
  if (nextAutoBingoGranted !== current.autoBingoGranted) {
    changedFields.push('autoBingoGranted');
  }
  if (nextAutoMarkEnabled !== current.autoMarkEnabled) {
    changedFields.push('autoMarkEnabled');
  }
  if (nextAutoBingoEnabled !== current.autoBingoEnabled) {
    changedFields.push('autoBingoEnabled');
  }

  return {
    nextAutoMarkGranted,
    nextAutoBingoGranted,
    nextAutoMarkEnabled,
    nextAutoBingoEnabled,
    changedFields,
    mutated: changedFields.length > 0,
  };
}

export function chunkIds<T>(items: T[], chunkSize: number): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}
