import {
  computeAdminFeatureGrantPatch,
  computeEffectiveFeatureSettings,
} from './user-feature-settings.util';

describe('computeEffectiveFeatureSettings', () => {
  it('defaults all-false to effective false', () => {
    expect(
      computeEffectiveFeatureSettings({
        autoMarkGranted: false,
        autoBingoGranted: false,
        autoMarkEnabled: false,
        autoBingoEnabled: false,
      }),
    ).toEqual({
      effectiveAutoMark: false,
      effectiveAutoBingo: false,
    });
  });

  it('treats granted=false enabled=true as effective=false for both features', () => {
    expect(
      computeEffectiveFeatureSettings({
        autoMarkGranted: false,
        autoBingoGranted: false,
        autoMarkEnabled: true,
        autoBingoEnabled: true,
      }),
    ).toEqual({
      effectiveAutoMark: false,
      effectiveAutoBingo: false,
    });
  });

  it('treats granted=true enabled=false as effective=false for both features', () => {
    expect(
      computeEffectiveFeatureSettings({
        autoMarkGranted: true,
        autoBingoGranted: true,
        autoMarkEnabled: false,
        autoBingoEnabled: false,
      }),
    ).toEqual({
      effectiveAutoMark: false,
      effectiveAutoBingo: false,
    });
  });

  it('treats both=true as effective=true for both features', () => {
    expect(
      computeEffectiveFeatureSettings({
        autoMarkGranted: true,
        autoBingoGranted: true,
        autoMarkEnabled: true,
        autoBingoEnabled: true,
      }),
    ).toEqual({
      effectiveAutoMark: true,
      effectiveAutoBingo: true,
    });
  });

  it('keeps Auto Mark and Auto Bingo independent', () => {
    expect(
      computeEffectiveFeatureSettings({
        autoMarkGranted: true,
        autoBingoGranted: false,
        autoMarkEnabled: true,
        autoBingoEnabled: true,
      }),
    ).toEqual({
      effectiveAutoMark: true,
      effectiveAutoBingo: false,
    });

    expect(
      computeEffectiveFeatureSettings({
        autoMarkGranted: false,
        autoBingoGranted: true,
        autoMarkEnabled: true,
        autoBingoEnabled: true,
      }),
    ).toEqual({
      effectiveAutoMark: false,
      effectiveAutoBingo: true,
    });
  });
});

describe('computeAdminFeatureGrantPatch', () => {
  const base = {
    autoMarkGranted: false,
    autoBingoGranted: false,
    autoMarkEnabled: false,
    autoBingoEnabled: false,
  };

  it('re-grant leaves enabled OFF', () => {
    const result = computeAdminFeatureGrantPatch(base, {
      autoMarkGranted: true,
    });
    expect(result.nextAutoMarkGranted).toBe(true);
    expect(result.nextAutoMarkEnabled).toBe(false);
    expect(result.mutated).toBe(true);
  });

  it('revocation clears matching enabled preference', () => {
    const result = computeAdminFeatureGrantPatch(
      {
        ...base,
        autoBingoGranted: true,
        autoBingoEnabled: true,
      },
      { autoBingoGranted: false },
    );
    expect(result.nextAutoBingoGranted).toBe(false);
    expect(result.nextAutoBingoEnabled).toBe(false);
  });

  it('no-op when already matching', () => {
    const result = computeAdminFeatureGrantPatch(
      { ...base, autoMarkGranted: true },
      { autoMarkGranted: true },
    );
    expect(result.mutated).toBe(false);
  });
});
