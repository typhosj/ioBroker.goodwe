"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyControlWrite = applyControlWrite;
exports.clampWriteValue = clampWriteValue;
exports.stripNamespace = stripNamespace;
exports.writableStateIds = writableStateIds;
const register_map_1 = require("./register-map");
// Read like the poll reads this group: a lost answer must neither take the
// connection offline nor pause the group the writable states live in.
const controlReadOptions = { optional: true, backoff: false };
/**
 * Returns the ioBroker state ids the control path accepts writes for.
 */
function writableStateIds() {
    return Array.from(register_map_1.writableEntries.keys());
}
/**
 * Strips the adapter namespace from a state id.
 *
 * @param id full state id, for example "goodwe.0.Settings.EmsMode"
 * @param namespace adapter namespace, for example "goodwe.0"
 */
function stripNamespace(id, namespace) {
    return id.startsWith(`${namespace}.`) ? id.slice(namespace.length + 1) : id;
}
/**
 * Converts a written state value into a register value inside the safe range.
 *
 * The range of a writable entry is in register units, so the state value is
 * scaled first. Returns null for values that cannot be sent at all, so the
 * caller can refuse the write instead of guessing a register value for it.
 *
 * Values of an enum register are never clamped: clamping 99 into a mode
 * register would silently switch the inverter to the highest mode it knows
 * instead of refusing an obviously wrong value.
 *
 * @param entry writable register entry
 * @param value value written to the state
 */
function clampWriteValue(entry, value) {
    const range = entry.writable;
    if (!range) {
        return null;
    }
    let numeric = value;
    // Input fields hand numbers over as text. Only plain decimals count: Number()
    // would also turn an empty field into 0 and "0x4" into a mode.
    if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
        numeric = Number(value);
    }
    // A boolean belongs on an on/off register. On a limit true would mean 1 W,
    // on the EMS mode it would pick "Auto".
    if (typeof value === "boolean" && range.min === 0 && range.max === 1) {
        numeric = Number(value);
    }
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
        return null;
    }
    const scaled = numeric * entry.scale;
    const register = Math.round(scaled);
    // An enum register accepts exactly the values it defines: rounding 4.4 into
    // mode 4 would guess, and clamping 99 would pick the highest mode instead.
    if (entry.states) {
        return Number.isInteger(scaled) &&
            register in entry.states &&
            register >= range.min &&
            register <= range.max
            ? register
            : null;
    }
    return Math.min(range.max, Math.max(range.min, register));
}
/**
 * Reads the register group of a state and writes what the inverter holds.
 *
 * Returns false when the state has no group or the read failed.
 *
 * @param context adapter, inverter and state manager
 * @param stateId state id without the adapter namespace
 */
async function readBack(context, stateId) {
    const groupName = (0, register_map_1.registerGroupOfState)(stateId);
    if (groupName === "" ||
        !(await context.inverter.ReadGroup(groupName, controlReadOptions))) {
        return false;
    }
    await context.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups[groupName]);
    return true;
}
/**
 * Sends one acknowledged state write to the inverter.
 *
 * Only whitelisted registers are written, and only with a value inside the
 * range of the register map. After the write the register group is read back,
 * so the states show what the inverter really stored.
 *
 * @param context adapter, inverter and state manager
 * @param context.adapter adapter instance, used for logging and the namespace
 * @param context.inverter connected inverter
 * @param context.states state manager
 * @param id changed state id
 * @param state changed state
 */
async function applyControlWrite(context, id, state) {
    if (!state || state.ack) {
        return;
    }
    const stateId = stripNamespace(id, context.adapter.namespace);
    const entry = register_map_1.writableEntries.get(stateId);
    if (!entry) {
        return;
    }
    if (!context.states.IsControlEnabled()) {
        context.adapter.log.warn(`Ignoring write to ${stateId}: inverter control is disabled`);
        return;
    }
    await context.states.RunControlWrite(() => sendControlWrite(context, stateId, entry, state.val));
}
/**
 * Checks a control write and sends it to the inverter.
 *
 * @param context adapter, inverter and state manager
 * @param stateId state id without the adapter namespace
 * @param entry writable register entry of the state
 * @param stateValue value written to the state
 */
async function sendControlWrite(context, stateId, entry, stateValue) {
    // Every request would only run into its timeout and hold up the queue, the
    // reconnect probe included. The first poll after the reconnect puts the value
    // the inverter holds back on the state.
    if (!context.inverter.Status) {
        context.adapter.log.warn(`Ignoring write to ${stateId}: inverter is offline`);
        return;
    }
    const value = clampWriteValue(entry, stateValue);
    if (value === null) {
        context.adapter.log.warn(`Ignoring write to ${stateId}: ${String(stateValue)} is not a value this register accepts`);
        // Otherwise the refused value stays on the state, unacknowledged, until the
        // next poll of the group - a whole pollCycle, which can be an hour.
        await readBack(context, stateId);
        return;
    }
    if (value !== Math.round(Number(stateValue) * entry.scale)) {
        context.adapter.log.warn(`Clamped write to ${stateId} from ${String(stateValue)} to ${value / entry.scale}`);
    }
    const groupName = (0, register_map_1.registerGroupOfState)(stateId);
    // Scripts tend to repeat the same setpoint every cycle, and GoodWe does not
    // say whether these registers end up in flash. Reading the group first costs
    // one small request and spares every write that would change nothing. The
    // last poll is no substitute: it can be a whole pollCycle old, and the GoodWe
    // app changes these registers as well.
    if (groupName !== "" &&
        (await context.inverter.ReadGroup(groupName, controlReadOptions)) &&
        context.states.RegisterValue(register_map_1.registerGroups[groupName], entry) ===
            value / entry.scale) {
        context.adapter.log.debug(`Skipping write to ${stateId}: inverter already holds ${value / entry.scale}`);
        await context.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups[groupName]);
        return;
    }
    const written = await context.inverter.WriteRegister(entry.address, value);
    // The adapter unloaded while the write waited in the queue: nothing was sent
    // and nothing is left to read back or to warn about.
    if (context.inverter.Closed) {
        return;
    }
    if (written) {
        context.adapter.log.info(`Wrote ${value} to ${stateId}`);
    }
    else {
        context.adapter.log.warn(`Inverter did not confirm write to ${stateId}`);
    }
    // Read back either way: a rejected write leaves the state showing a value the
    // inverter never stored.
    if (await readBack(context, stateId)) {
        return;
    }
    // Without a read-back the state would stay unacknowledged forever, showing a
    // value nobody confirmed. Acknowledge what the inverter echoed; a failed
    // write keeps its warning and is corrected by the next poll of the group.
    if (written) {
        await context.states.Acknowledge(stateId, value / entry.scale);
    }
}
