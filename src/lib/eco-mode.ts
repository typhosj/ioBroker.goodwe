"use strict";

// Eco mode time slots of ET firmware before ARM 19 ("EcoModeV1" in
// marcelblijleven/goodwe): four slots of four registers from 47515. Layout of
// one slot, confirmed on a GW8K-ET with ARM 17 against the SolarGo app (#61):
//   register 0: start hour (high byte), start minute (low byte)
//   register 1: end hour (high byte), end minute (low byte)
//   register 2: power in % of the rated power, signed; negative charges the
//               battery from the grid, positive discharges it
//   register 3: on/off (high byte, 0x00 off, 0xFF on), weekday bits (low
//               byte, bit 0 Sunday to bit 6 Saturday)
// A slot that never got a time reads hour 48.

interface EcoSlot {
  // "HH:MM", or "" while the slot has no time.
  start: string;
  end: string;
  power: number;
  days: number;
  enabled: boolean;
}

const EcoSlotStarts = [47515, 47519, 47523, 47527] as const;
const EcoSlotRegisters = 4;
// marcelblijleven/goodwe reads here to tell EcoModeV2 firmware (ARM 19 and
// newer) apart; EcoModeV1 firmware rejects the address.
const EcoModeV2Probe = { start: 47547, count: 6 } as const;

// What a probe read of a register block learned, see
// GoodWeUdp.ProbeRegisters(): "rejected" is a Modbus exception, "lost" no
// answer at all.
type ProbeResult = "answered" | "rejected" | "lost";

const UnsetHour = 48;
const AllDays = 0x7f;
// Power in % of the rated power, both directions.
const MaxPower = 100;
const Fields = ["start", "end", "power", "days", "enabled"] as const;

/**
 * Formats a time register as "HH:MM", or "" for a slot without a time.
 *
 * An hour outside 0-23 other than the unset marker is shown as it is, so a
 * broken register stays visible instead of turning into a valid time.
 *
 * @param register high byte hour, low byte minute
 */
function decodeEcoTime(register: number): string {
  const hour = register >> 8;
  const minute = register & 0xff;

  if (hour === UnsetHour) {
    return "";
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Returns the time register for "HH:MM", or for "" the unset marker.
 *
 * @param time "HH:MM" as decodeEcoTime() returns it
 */
function encodeEcoTime(time: string): number {
  if (time === "") {
    return UnsetHour << 8;
  }

  const [hour, minute] = time.split(":").map(Number);

  return (hour << 8) | minute;
}

/**
 * Decodes the four registers of one slot.
 *
 * @param bytes the eight register bytes of the slot
 */
function decodeEcoSlot(bytes: Uint8Array): EcoSlot {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return {
    start: decodeEcoTime(data.readUInt16BE(0)),
    end: decodeEcoTime(data.readUInt16BE(2)),
    power: data.readInt16BE(4),
    days: data[7],
    // marcelblijleven/goodwe counts everything but 0 as on.
    enabled: data[6] !== 0,
  };
}

/**
 * Encodes one slot into its four register values, unsigned 16 bit.
 *
 * @param slot slot checked with checkEcoSlot()
 */
function encodeEcoSlot(slot: EcoSlot): number[] {
  return [
    encodeEcoTime(slot.start),
    encodeEcoTime(slot.end),
    slot.power & 0xffff,
    ((slot.enabled ? 0xff : 0x00) << 8) | (slot.days & 0xff),
  ];
}

/**
 * Returns the JSON text the slot state shows.
 *
 * @param slot decoded slot
 */
function ecoSlotJson(slot: EcoSlot): string {
  return JSON.stringify({
    start: slot.start,
    end: slot.end,
    power: slot.power,
    days: slot.days,
    enabled: slot.enabled,
  });
}

function isTime(value: unknown): boolean {
  const match =
    typeof value === "string" ? /^(\d{2}):(\d{2})$/.exec(value) : null;

  return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function isInRange(value: unknown, min: number, max: number): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/**
 * Parses what a script wrote to a slot state into the fields it changes.
 *
 * A partial object is fine, every field left out keeps the value the inverter
 * holds. An unknown key is refused rather than ignored: "Power" instead of
 * "power" would otherwise be a write that silently changes nothing.
 *
 * @param value value written to the state
 * @returns the changed fields, or the reason the value is refused
 */
function parseEcoSlotChanges(
  value: ioBroker.StateValue,
): { changes: Partial<EcoSlot> } | { error: string } {
  if (typeof value !== "string") {
    return { error: "expected a JSON object as text" };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "not valid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "expected a JSON object" };
  }

  const changes = parsed as Record<string, unknown>;

  for (const key of Object.keys(changes)) {
    if (!(Fields as readonly string[]).includes(key)) {
      return { error: `unknown field "${key}"` };
    }
  }

  // "" takes the time off the slot, as SolarGo leaves unused slots;
  // checkEcoSlot() refuses it on a slot that stays enabled.
  for (const key of ["start", "end"] as const) {
    if (key in changes && changes[key] !== "" && !isTime(changes[key])) {
      return {
        error: `${key} has to be "HH:MM" from 00:00 to 23:59, or "" for no time`,
      };
    }
  }

  if ("power" in changes && !isInRange(changes.power, -MaxPower, MaxPower)) {
    return {
      error: `power has to be a whole number from -${MaxPower} to ${MaxPower}`,
    };
  }

  if ("days" in changes && !isInRange(changes.days, 0, AllDays)) {
    return { error: "days has to be a whole number from 0 to 127" };
  }

  if ("enabled" in changes && typeof changes.enabled !== "boolean") {
    return { error: "enabled has to be true or false" };
  }

  return { changes };
}

/**
 * Checks a merged slot before it is written.
 *
 * The fields a script left out come from the inverter and are not checked by
 * parseEcoSlotChanges(), so a broken stored value surfaces here instead of
 * being written back. A slot without a time may stay off: SolarGo leaves
 * unused slots like that.
 *
 * @param slot slot about to be written
 * @returns the reason the slot must not be written, or null
 */
function checkEcoSlot(slot: EcoSlot): string | null {
  for (const key of ["start", "end"] as const) {
    if (slot[key] === "" && slot.enabled) {
      return "start and end have to be set before the slot is enabled";
    }
    if (slot[key] !== "" && !isTime(slot[key])) {
      return `the inverter holds an invalid ${key} time ${slot[key]}`;
    }
  }

  if (!isInRange(slot.power, -MaxPower, MaxPower)) {
    return `the inverter holds an invalid power ${slot.power}`;
  }

  // Some firmware reports every day as 0xFF; that is kept, never sent from a
  // script.
  if (!isInRange(slot.days, 0, AllDays) && slot.days !== 0xff) {
    return `the inverter holds invalid days ${slot.days}`;
  }

  // Written as it is, such a slot would show as on and never act.
  if (slot.enabled && slot.days === 0) {
    return "days has to name at least one day before the slot is enabled";
  }

  return null;
}

/**
 * Reads back the slot a JSON state shows, as ecoSlotJson() wrote it.
 *
 * @param value state value
 * @returns the slot, or null for anything ecoSlotJson() does not write
 */
function ecoSlotFromJson(value: ioBroker.StateValue): EcoSlot | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(String(value));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const slot = parsed as Record<string, unknown>;

  return typeof slot.start === "string" &&
    typeof slot.end === "string" &&
    typeof slot.power === "number" &&
    typeof slot.days === "number" &&
    typeof slot.enabled === "boolean"
    ? {
        start: slot.start,
        end: slot.end,
        power: slot.power,
        days: slot.days,
        enabled: slot.enabled,
      }
    : null;
}

export type { EcoSlot, ProbeResult };
export {
  checkEcoSlot,
  decodeEcoSlot,
  decodeEcoTime,
  ecoSlotFromJson,
  ecoSlotJson,
  EcoModeV2Probe,
  EcoSlotRegisters,
  EcoSlotStarts,
  encodeEcoSlot,
  parseEcoSlotChanges,
};
