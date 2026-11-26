"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcoSlotV2Starts = exports.EcoSlotV2Registers = exports.EcoSlotStarts = exports.EcoSlotRegisters = exports.EcoModeV2Probe = void 0;
exports.checkEcoSlot = checkEcoSlot;
exports.checkEcoSlotV2 = checkEcoSlotV2;
exports.decodeEcoSlot = decodeEcoSlot;
exports.decodeEcoSlotV2 = decodeEcoSlotV2;
exports.decodeEcoTime = decodeEcoTime;
exports.decodeSlotType = decodeSlotType;
exports.ecoSlotFieldJson = ecoSlotFieldJson;
exports.ecoSlotFromJson = ecoSlotFromJson;
exports.ecoSlotJson = ecoSlotJson;
exports.encodeEcoSlot = encodeEcoSlot;
exports.encodeEcoSlotV2 = encodeEcoSlotV2;
exports.isSlotOn = isSlotOn;
exports.mergeEcoSlot = mergeEcoSlot;
exports.parseEcoSlotChanges = parseEcoSlotChanges;
const EcoSlotStarts = [47515, 47519, 47523, 47527];
exports.EcoSlotStarts = EcoSlotStarts;
const EcoSlotRegisters = 4;
exports.EcoSlotRegisters = EcoSlotRegisters;
const EcoSlotV2Starts = [47547, 47553, 47559, 47565];
exports.EcoSlotV2Starts = EcoSlotV2Starts;
const EcoSlotV2Registers = 6;
exports.EcoSlotV2Registers = EcoSlotV2Registers;
// marcelblijleven/goodwe reads here to tell EcoModeV2 firmware (ARM 19 and
// newer) apart; EcoModeV1 firmware rejects the address.
const EcoModeV2Probe = { start: 47547, count: 6 };
exports.EcoModeV2Probe = EcoModeV2Probe;
const SlotTypeNotSet = 85;
const UnsetHour = 48;
const AllDays = 0x7f;
// Power in % of the rated power, both directions.
const MaxPower = 100;
const Fields = ["start", "end", "power", "days", "enabled"];
const FieldsV2 = [...Fields, "type", "soc", "months"];
const SlotTypeEco = 0;
const MaxSoc = 100;
const AllMonths = 0x0fff;
/**
 * Formats a time register as "HH:MM", or "" for a slot without a time.
 *
 * An hour outside 0-23 other than the unset marker is shown as it is, so a
 * broken register stays visible instead of turning into a valid time.
 *
 * @param register high byte hour, low byte minute
 */
function decodeEcoTime(register) {
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
function encodeEcoTime(time) {
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
function decodeEcoSlot(bytes) {
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
 * Returns the on/off byte of a V2 slot as a signed number.
 *
 * @param onOff high byte of the third slot register
 */
function signedSlotByte(onOff) {
    return onOff > 0x7f ? onOff - 0x100 : onOff;
}
/**
 * Reports whether the on/off byte of a V2 slot switches it on.
 *
 * @param onOff high byte of the third slot register
 */
function isSlotOn(onOff) {
    const value = signedSlotByte(onOff);
    return value > -10 && value < 0;
}
/**
 * Returns what a V2 slot is used for, from its on/off byte.
 *
 * The byte holds the type while the slot is off and -1 - type while it is on:
 * 0 eco mode, 1 dry contact load, 2 dry contact smart load, 3 peak shaving,
 * 4 backup mode, 5 smart charge, 6 eco mode on the 745 platform. 85 marks a
 * slot that was never set. Any other byte is returned as it is, so a value
 * nobody knows yet stays visible instead of turning into a known type.
 *
 * @param onOff high byte of the third slot register
 */
function decodeSlotType(onOff) {
    const value = signedSlotByte(onOff);
    if (isSlotOn(onOff)) {
        return -1 - value;
    }
    return (value >= 0 && value < 10) || value === SlotTypeNotSet ? value : onOff;
}
/**
 * Decodes the six registers of one V2 slot.
 *
 * @param bytes the twelve register bytes of the slot
 */
function decodeEcoSlotV2(bytes) {
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
        start: decodeEcoTime(data.readUInt16BE(0)),
        end: decodeEcoTime(data.readUInt16BE(2)),
        power: data.readInt16BE(6),
        days: data[5],
        enabled: isSlotOn(data[4]),
        type: decodeSlotType(data[4]),
        soc: data.readInt16BE(8),
        months: data.readUInt16BE(10),
    };
}
/**
 * Encodes one V2 slot into its six register values, unsigned 16 bit.
 *
 * The on/off byte keeps the slot type, so the slot a write starts from
 * encodes to what the inverter holds.
 *
 * @param slot slot checked with checkEcoSlotV2()
 */
function encodeEcoSlotV2(slot) {
    const onOff = slot.enabled ? (-1 - slot.type) & 0xff : slot.type & 0xff;
    return [
        encodeEcoTime(slot.start),
        encodeEcoTime(slot.end),
        (onOff << 8) | (slot.days & 0xff),
        slot.power & 0xffff,
        slot.soc & 0xffff,
        slot.months & 0xffff,
    ];
}
/**
 * Encodes one slot into its four register values, unsigned 16 bit.
 *
 * @param slot slot checked with checkEcoSlot()
 */
function encodeEcoSlot(slot) {
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
function ecoSlotJson(slot) {
    return JSON.stringify({
        start: slot.start,
        end: slot.end,
        power: slot.power,
        days: slot.days,
        enabled: slot.enabled,
    });
}
function isTime(value) {
    const match = typeof value === "string" ? /^(\d{2}):(\d{2})$/.exec(value) : null;
    return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}
function isInRange(value, min, max) {
    return (typeof value === "number" &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max);
}
/**
 * Parses what a script wrote to a slot state into the fields it changes.
 *
 * A partial object is fine, every field left out keeps the value the inverter
 * holds. An unknown key is refused rather than ignored: "Power" instead of
 * "power" would otherwise be a write that silently changes nothing.
 *
 * @param value value written to the state
 * @param v2 whether the slot has the EcoModeV2 layout, which adds type, soc
 * and months
 * @returns the changed fields, or the reason the value is refused
 */
function parseEcoSlotChanges(value, v2 = false) {
    if (typeof value !== "string") {
        return { error: "expected a JSON object as text" };
    }
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        return { error: "not valid JSON" };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { error: "expected a JSON object" };
    }
    const changes = parsed;
    const fields = v2 ? FieldsV2 : Fields;
    for (const key of Object.keys(changes)) {
        if (!fields.includes(key)) {
            return { error: `unknown field "${key}"` };
        }
    }
    // "" takes the time off the slot, as SolarGo leaves unused slots;
    // checkEcoSlot() refuses it on a slot that stays enabled.
    for (const key of ["start", "end"]) {
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
    // Only eco mode slots are written; a script may send back the JSON it read.
    if ("type" in changes && changes.type !== SlotTypeEco) {
        return {
            error: `type has to be ${SlotTypeEco}, only eco mode slots are written`,
        };
    }
    if ("soc" in changes && !isInRange(changes.soc, 0, MaxSoc)) {
        return { error: `soc has to be a whole number from 0 to ${MaxSoc}` };
    }
    if ("months" in changes && !isInRange(changes.months, 0, AllMonths)) {
        return {
            error: `months has to be a whole number from 0 to ${AllMonths}`,
        };
    }
    return { changes };
}
/**
 * Turns a write to the Enabled or Power state of a slot into the partial JSON
 * parseEcoSlotChanges() takes, so both ways of writing share one check.
 *
 * Toggles and sliders send booleans, 0/1 or numbers as text, and Enabled also
 * takes "true" and "false" as text; anything else is passed on as it is and
 * refused there.
 *
 * @param field slot field the state shows
 * @param value value written to the state
 */
function ecoSlotFieldJson(field, value) {
    let parsed = value;
    if (typeof value === "string" && /^\s*-?\d+\s*$/.test(value)) {
        parsed = Number(value);
    }
    if (field === "enabled" && typeof value === "string") {
        const text = value.trim().toLowerCase();
        if (text === "true" || text === "false") {
            parsed = text === "true";
        }
    }
    if (field === "enabled" && (parsed === 0 || parsed === 1)) {
        parsed = parsed === 1;
    }
    return JSON.stringify({ [field]: parsed });
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
function checkEcoSlot(slot) {
    for (const key of ["start", "end"]) {
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
function ecoSlotFromJson(value) {
    let parsed;
    try {
        parsed = JSON.parse(String(value));
    }
    catch {
        return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
        return null;
    }
    const slot = parsed;
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
/**
 * Checks a merged V2 slot before it is written, see checkEcoSlot().
 *
 * @param slot slot about to be written
 * @returns the reason the slot must not be written, or null
 */
function checkEcoSlotV2(slot) {
    const invalid = checkEcoSlot(slot);
    if (invalid !== null) {
        return invalid;
    }
    if (!isInRange(slot.soc, 0, MaxSoc)) {
        return `the inverter holds an invalid soc ${slot.soc}`;
    }
    if (!isInRange(slot.months, 0, AllMonths)) {
        return `the inverter holds invalid months ${slot.months}`;
    }
    return null;
}
/**
 * Reads back the V2 slot a JSON state shows, as the register parser wrote it.
 *
 * @param value state value
 * @returns the slot, or null for anything the parser does not write
 */
function ecoSlotV2FromJson(value) {
    const slot = ecoSlotFromJson(value);
    if (slot === null) {
        return null;
    }
    const extra = JSON.parse(String(value));
    return typeof extra.type === "number" &&
        typeof extra.soc === "number" &&
        typeof extra.months === "number"
        ? { ...slot, type: extra.type, soc: extra.soc, months: extra.months }
        : null;
}
/**
 * Merges the fields a script wrote onto the slot the inverter holds and
 * returns what to send.
 *
 * A V2 slot is only written while it is an eco mode slot or was never set:
 * the same registers hold peak shaving, dry contact, backup and smart charge
 * slots, which a write would turn into eco mode slots. Type 6, eco mode on the
 * 745 platform, scales the power by ten and is not written either, since no
 * ET inverter has shown it yet. A written V2 slot is always an eco mode slot.
 *
 * @param stored JSON state value of the slot as last read
 * @param changes fields parsed by parseEcoSlotChanges()
 * @param v2 whether the slot has the EcoModeV2 layout
 * @returns the register values, whether they match the stored slot, and the
 * JSON the state shows after the write; or the reason not to write
 */
function mergeEcoSlot(stored, changes, v2) {
    if (!v2) {
        const current = ecoSlotFromJson(stored);
        // Only a broken read gets here; it must not be merged into a write.
        if (current === null) {
            return { error: "could not read the slot first" };
        }
        const slot = {
            start: changes.start ?? current.start,
            end: changes.end ?? current.end,
            power: changes.power ?? current.power,
            days: changes.days ?? current.days,
            enabled: changes.enabled ?? current.enabled,
        };
        const invalid = checkEcoSlot(slot);
        const values = encodeEcoSlot(slot);
        return invalid !== null
            ? { error: invalid }
            : {
                values,
                unchanged: values.join() === encodeEcoSlot(current).join(),
                shown: ecoSlotJson(slot),
            };
    }
    const current = ecoSlotV2FromJson(stored);
    if (current === null) {
        return { error: "could not read the slot first" };
    }
    if (current.type !== SlotTypeEco && current.type !== SlotTypeNotSet) {
        return {
            error: `the slot holds type ${current.type}, only eco mode slots (${SlotTypeEco}) and slots that were never set (${SlotTypeNotSet}) are written`,
        };
    }
    const slot = { ...current, ...changes, type: SlotTypeEco };
    const invalid = checkEcoSlotV2(slot);
    const values = encodeEcoSlotV2(slot);
    return invalid !== null
        ? { error: invalid }
        : {
            values,
            unchanged: values.join() === encodeEcoSlotV2(current).join(),
            shown: JSON.stringify(slot),
        };
}
