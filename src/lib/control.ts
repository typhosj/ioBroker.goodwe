"use strict";

import {
  registerGroupOfState,
  registerGroups,
  writableEntries,
} from "./register-map";
import type { RegisterEntry } from "./register-map";

interface ControlInverter {
  WriteRegister: (address: number, value: number) => Promise<boolean>;
  ReadGroup: (
    groupName: string,
    options?: { optional?: boolean },
  ) => Promise<boolean>;
}

interface ControlStates {
  IsControlEnabled: () => boolean;
  UpdateStatesFromRegisterMap: (
    group: (typeof registerGroups)[string],
  ) => Promise<void>;
}

interface ControlAdapter {
  log: ioBroker.Logger;
  namespace: string;
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
 * Converts a written state value into a register value inside the safe range.
 *
 * Returns null for values that cannot be sent at all, so the caller can refuse
 * the write instead of guessing a register value for it.
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

  const numeric = typeof value === "boolean" ? Number(value) : value;

  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    return null;
  }

  return Math.min(range.max, Math.max(range.min, Math.round(numeric)));
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
  context: {
    adapter: ControlAdapter;
    inverter: ControlInverter;
    states: ControlStates;
  },
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

  const value = clampWriteValue(entry, state.val);

  if (value === null) {
    context.adapter.log.warn(
      `Ignoring write to ${stateId}: ${String(state.val)} is not a register value`,
    );
    return;
  }

  if (value !== state.val) {
    context.adapter.log.warn(
      `Clamped write to ${stateId} from ${String(state.val)} to ${value}`,
    );
  }

  const written = await context.inverter.WriteRegister(entry.address, value);

  if (written) {
    context.adapter.log.info(`Wrote ${value} to ${stateId}`);
  } else {
    context.adapter.log.warn(`Inverter did not confirm write to ${stateId}`);
  }

  // Read back either way: a rejected write leaves the state showing a value the
  // inverter never stored.
  const groupName = registerGroupOfState(stateId);

  if (groupName && (await context.inverter.ReadGroup(groupName))) {
    await context.states.UpdateStatesFromRegisterMap(registerGroups[groupName]);
  }
}

export type { ControlAdapter, ControlInverter, ControlStates };
export { applyControlWrite, clampWriteValue, stripNamespace, writableStateIds };
