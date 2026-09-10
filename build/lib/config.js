"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.booleanDefaults = void 0;
exports.clampNumber = clampNumber;
exports.normalizeBoolean = normalizeBoolean;
exports.normalizeBooleanConfig = normalizeBooleanConfig;
// Defaults mirror io-package.json "native"; every optional register group needs an entry here.
const booleanDefaults = {
    pollExtended: true,
    pollSimccid: true,
    pollExtendedMeter: true,
    pollFlashInfo: true,
    pollBmsExtended: true,
    pollBmsDetail: false,
    pollCeiAutoTest: true,
    pollPowerLimit: false,
    pollSettings: true,
    enableControl: false,
};
exports.booleanDefaults = booleanDefaults;
function normalizeBoolean(value, fallback) {
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
 * Clamps a stored config number into its allowed integer range.
 *
 * Anything that is not a finite number falls back, so a missing or mistyped
 * option keeps the io-package default instead of turning into NaN.
 *
 * @param value stored config value
 * @param fallback value used when the config holds no usable number
 * @param min lowest accepted value
 * @param max highest accepted value
 */
function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(parsed)));
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
function normalizeBooleanConfig(config) {
    for (const [key, fallback] of Object.entries(booleanDefaults)) {
        config[key] = normalizeBoolean(config[key], fallback);
    }
}
