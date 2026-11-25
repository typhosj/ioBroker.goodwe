"use strict";

import {
  checkEcoSlot,
  type EcoSlot,
  ecoSlotFromJson,
  ecoSlotJson,
  EcoModeV2Probe,
  encodeEcoSlot,
  parseEcoSlotChanges,
  type ProbeResult,
} from "./eco-mode";
import {
  registerGroupOfState,
  registerGroups,
  toStateValue,
  TYPE,
  writableEntries,
} from "./register-map";
import type { RegisterEntry } from "./register-map";

interface ControlInverter {
  Status: boolean;
  Closed: boolean;
  WriteRegister: (address: number, value: number) => Promise<boolean>;
  WriteRegisters: (start: number, values: number[]) => Promise<boolean>;
  ProbeRegisters: (start: number, count: number) => Promise<ProbeResult>;
  ReadGroup: (
    groupName: string,
    options?: { optional?: boolean; backoff?: boolean },
  ) => Promise<boolean>;
}

// Read like the poll reads this group: a lost answer must neither take the
// connection offline nor pause the group the writable states live in.
const controlReadOptions = { optional: true, backoff: false };

interface ControlStates {
  IsControlEnabled: () => boolean;
  RunControlWrite: (write: () => Promise<void>) => Promise<void>;
  UpdateStatesFromRegisterMap: (
    group: (typeof registerGroups)[string],
  ) => Promise<void>;
  Acknowledge: (id: string, value: ioBroker.StateValue) => Promise<void>;
  RegisterValue: (
    group: (typeof registerGroups)[string],
    item: RegisterEntry,
  ) => ioBroker.StateValue;
}

interface ControlAdapter {
  log: ioBroker.Logger;
  namespace: string;
}

interface ControlContext {
  adapter: ControlAdapter;
  inverter: ControlInverter;
  states: ControlStates;
}

/**
 * Returns the ioBroker state ids the control path accepts writes for.
 */
function writableStateIds(): string[] {
  return Array.from(writableEntries.keys());
}

/**
 * Strips the adapter namespace from a state id.
 *
 * @param id full state id, for example "goodwe.0.Settings.EmsMode"
 * @param namespace adapter namespace, for example "goodwe.0"
 */
function stripNamespace(id: string, namespace: string): string {
  return id.startsWith(`${namespace}.`) ? id.slice(namespace.length + 1) : id;
}

/**
 * Converts a state value into register units, before rounding.
 *
 * @param entry register entry
 * @param value numeric state value
 */
function toRegisterUnits(entry: RegisterEntry, value: number): number {
  const shown =
    entry.complement === undefined ? value : entry.complement - value;
  return shown * entry.scale;
}

/**
 * Converts a written state value into a register value inside the safe range.
 *
 * The range of a writable entry is in register units, so the state value is
 * converted first. Returns null for values that cannot be sent at all, so the
 * caller can refuse the write instead of guessing a register value for it.
 *
 * Values of an enum register are never clamped: clamping 99 into a mode
 * register would silently switch the inverter to the highest mode it knows
 * instead of refusing an obviously wrong value.
 *
 * @param entry writable register entry
 * @param value value written to the state
 */
function clampWriteValue(
  entry: RegisterEntry,
  value: ioBroker.StateValue,
): number | null {
  const range = entry.writable;

  if (!range) {
    return null;
  }

  let numeric: unknown = value;

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

  const scaled = toRegisterUnits(entry, numeric);
  const register = Math.round(scaled);

  if (range.values) {
    return Number.isInteger(scaled) && range.values.includes(register)
      ? register
      : null;
  }

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
async function readBack(
  context: ControlContext,
  stateId: string,
): Promise<boolean> {
  const groupName = registerGroupOfState(stateId);

  if (
    groupName === "" ||
    !(await context.inverter.ReadGroup(groupName, controlReadOptions))
  ) {
    return false;
  }

  await context.states.UpdateStatesFromRegisterMap(registerGroups[groupName]);
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
async function applyControlWrite(
  context: ControlContext,
  id: string,
  state: ioBroker.State | null | undefined,
): Promise<void> {
  if (!state || state.ack) {
    return;
  }

  const stateId = stripNamespace(id, context.adapter.namespace);
  const entry = writableEntries.get(stateId);

  if (!entry) {
    return;
  }

  if (!context.states.IsControlEnabled()) {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: inverter control is disabled`,
    );
    return;
  }

  await context.states.RunControlWrite(() =>
    sendControlWrite(context, stateId, entry, state.val),
  );
}

/**
 * Checks a control write and sends it to the inverter.
 *
 * @param context adapter, inverter and state manager
 * @param stateId state id without the adapter namespace
 * @param entry writable register entry of the state
 * @param stateValue value written to the state
 */
async function sendControlWrite(
  context: ControlContext,
  stateId: string,
  entry: RegisterEntry,
  stateValue: ioBroker.StateValue,
): Promise<void> {
  // Every request would only run into its timeout and hold up the queue, the
  // reconnect probe included. The first poll after the reconnect puts the value
  // the inverter holds back on the state.
  if (!context.inverter.Status) {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: inverter is offline`,
    );
    return;
  }

  if (entry.type === TYPE.ECO_SLOT) {
    await sendEcoSlotWrite(context, stateId, entry, stateValue);
    return;
  }

  const value = clampWriteValue(entry, stateValue);

  if (value === null) {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: ${String(stateValue)} is not a value this register accepts`,
    );
    // Otherwise the refused value stays on the state, unacknowledged, until the
    // next poll of the group - a whole pollCycle, which can be an hour.
    await readBack(context, stateId);
    return;
  }

  const shown = toStateValue(entry, value);

  if (value !== Math.round(toRegisterUnits(entry, Number(stateValue)))) {
    context.adapter.log.warn(
      `Clamped write to ${stateId} from ${String(stateValue)} to ${shown}`,
    );
  }

  // A manual EMS mode, charge battery for example, keeps the inverter from
  // following the work mode. The SolarGo app sets it back to auto on every
  // switch, and so does the adapter, even when the work mode stays the same.
  if (stateId === "Settings.WorkMode" && !(await setEmsModeAuto(context))) {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: could not set the EMS mode to auto first`,
    );
    await readBack(context, stateId);
    return;
  }

  const groupName = registerGroupOfState(stateId);

  // Scripts tend to repeat the same setpoint every cycle, and GoodWe does not
  // say whether these registers end up in flash. Reading the group first costs
  // one small request and spares every write that would change nothing. The
  // last poll is no substitute: it can be a whole pollCycle old, and the GoodWe
  // app changes these registers as well.
  if (
    groupName !== "" &&
    (await context.inverter.ReadGroup(groupName, controlReadOptions)) &&
    context.states.RegisterValue(registerGroups[groupName], entry) === shown
  ) {
    context.adapter.log.debug(
      `Skipping write to ${stateId}: inverter already holds ${shown}`,
    );
    await context.states.UpdateStatesFromRegisterMap(registerGroups[groupName]);
    return;
  }

  const written = await context.inverter.WriteRegister(entry.address, value);

  // The adapter unloaded while the write waited in the queue: nothing was sent
  // and nothing is left to read back or to warn about.
  if (context.inverter.Closed) {
    return;
  }

  if (written) {
    context.adapter.log.info(`Wrote ${shown} to ${stateId}`);
  } else {
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
    await context.states.Acknowledge(stateId, shown);
  }
}

/**
 * Sets EMS mode auto and EMS power limit 0 in one request, unless the inverter
 * already holds them.
 *
 * @param context adapter, inverter and state manager
 * @returns false when the EMS settings could not be read or written
 */
async function setEmsModeAuto(context: ControlContext): Promise<boolean> {
  const group = registerGroups.settingsEms;
  const mode = writableEntries.get("Settings.EmsMode") as RegisterEntry;
  const limit = writableEntries.get("Settings.EmsPowerLimit") as RegisterEntry;

  if (!(await context.inverter.ReadGroup("settingsEms", controlReadOptions))) {
    return false;
  }

  if (
    context.states.RegisterValue(group, mode) === 1 &&
    context.states.RegisterValue(group, limit) === 0
  ) {
    return true;
  }

  // 47511 and 47512 are neighbours: one request, so the inverter never runs
  // auto mode with the power limit of the manual mode before.
  let written = await context.inverter.WriteRegisters(mode.address, [1, 0]);

  if (context.inverter.Closed) {
    return false;
  }

  // Function 0x10 is confirmed on ARM 17 only for an eco mode slot, so a
  // firmware that refuses it here falls back to the single writes the EMS
  // states use. Auto goes first: auto with the old power limit for a moment is
  // what the inverter would also run if only the second write failed, a manual
  // mode with the limit cleared is not. A lost answer takes the connection
  // offline, and then there is nothing to fall back on.
  if (!written && context.inverter.Status) {
    context.adapter.log.info(
      "Writing the EMS mode and the EMS power limit one at a time",
    );
    written = true;

    for (const [item, value] of [
      [mode, 1],
      [limit, 0],
    ] as const) {
      if (written && context.states.RegisterValue(group, item) !== value) {
        written = await context.inverter.WriteRegister(item.address, value);
      }
    }

    if (context.inverter.Closed) {
      return false;
    }
  }

  if (written) {
    context.adapter.log.info("Set the EMS mode to auto for the work mode");
  }

  await readBack(context, mode.state);
  return written;
}

/**
 * Writes one eco mode slot from the JSON a script wrote to its state.
 *
 * The slot is read first and the fields the script named replace the ones the
 * inverter holds, then all four registers go out in one request and the slot
 * is read back.
 *
 * @param context adapter, inverter and state manager
 * @param stateId state id without the adapter namespace
 * @param entry register entry of the slot
 * @param stateValue value written to the state
 */
async function sendEcoSlotWrite(
  context: ControlContext,
  stateId: string,
  entry: RegisterEntry,
  stateValue: ioBroker.StateValue,
): Promise<void> {
  const refuse = async (reason: string): Promise<void> => {
    context.adapter.log.warn(`Ignoring write to ${stateId}: ${reason}`);
    await readBack(context, stateId);
  };
  const parsed = parseEcoSlotChanges(stateValue);

  if ("error" in parsed) {
    await refuse(parsed.error);
    return;
  }

  // Firmware from ARM 19 keeps its slots at 47547 (EcoModeV2). Whether it still
  // follows 47515 is unknown, so it gets no write it might misread. Checked
  // per write: a firmware update does not have to drop the connection.
  const probe = await context.inverter.ProbeRegisters(
    EcoModeV2Probe.start,
    EcoModeV2Probe.count,
  );

  if (context.inverter.Closed) {
    return;
  }

  if (probe === "answered") {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: this firmware uses the newer eco mode registers, which the adapter does not write`,
    );
    // A read back would put the values of 47515 on the states again, and on
    // this firmware they are no slots: the scheduler keeps the states empty.
    await context.states.Acknowledge(stateId, null);
    return;
  }

  if (probe === "lost") {
    await refuse("could not check which eco mode registers the firmware uses");
    return;
  }

  const group = registerGroups.settingsEcoMode;

  if (
    !(await context.inverter.ReadGroup("settingsEcoMode", controlReadOptions))
  ) {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: could not read the slot first`,
    );
    return;
  }

  const current = ecoSlotFromJson(context.states.RegisterValue(group, entry));

  // Only a broken read gets here; it must not be merged into a write.
  if (current === null) {
    await refuse("could not read the slot first");
    return;
  }

  const slot: EcoSlot = { ...current, ...parsed.changes };
  const invalid = checkEcoSlot(slot);

  if (invalid !== null) {
    await refuse(invalid);
    return;
  }

  const values = encodeEcoSlot(slot);
  const shown = ecoSlotJson(slot);

  if (values.join() === encodeEcoSlot(current).join()) {
    context.adapter.log.debug(
      `Skipping write to ${stateId}: inverter already holds ${shown}`,
    );
    await context.states.UpdateStatesFromRegisterMap(group);
    return;
  }

  const written = await context.inverter.WriteRegisters(entry.address, values);

  if (context.inverter.Closed) {
    return;
  }

  if (written) {
    context.adapter.log.info(`Wrote ${shown} to ${stateId}`);
  } else {
    context.adapter.log.warn(`Inverter did not confirm write to ${stateId}`);
  }

  if (!(await readBack(context, stateId)) && written) {
    await context.states.Acknowledge(stateId, shown);
  }
}

export type { ControlAdapter, ControlInverter, ControlStates };
export { applyControlWrite, clampWriteValue, stripNamespace, writableStateIds };
