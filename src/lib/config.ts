"use strict";

// Defaults mirror io-package.json "native"; every optional register group needs an entry here.
const booleanDefaults: Record<string, boolean> = {
  pollExtended: true,
  pollSimccid: true,
  pollExtendedMeter: true,
  pollFlashInfo: true,
  pollBmsExtended: true,
  pollBmsDetail: false,
  pollCeiAutoTest: true,
  pollPowerLimit: false,
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true" || normalized === "1") {
      return true;
    }

    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  return fallback;
}

/**
 * Normalizes every boolean option of a stored native config in place.
 *
 * Admin UI normalization does not protect configs written before the React UI
 * or edited by hand, and a mistyped switch does not only disable a register
 * group - it makes states.ts delete its objects.
 *
 * @param config native adapter config, mutated in place
 */
function normalizeBooleanConfig(config: Record<string, unknown>): void {
  for (const [key, fallback] of Object.entries(booleanDefaults)) {
    config[key] = normalizeBoolean(config[key], fallback);
  }
}

export { booleanDefaults, normalizeBoolean, normalizeBooleanConfig };
