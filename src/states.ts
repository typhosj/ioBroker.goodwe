"use strict";

import { booleanDefaults, normalizeBoolean } from "./lib/config";
import {
  optionalGroupConfigs,
  type RegisterEntry,
  type RegisterGroup,
  registerGroups,
  TYPE,
  writableGroups,
} from "./lib/register-map";
import {
  getDecodedBmsStatuses,
  getDecodedRunningStatuses,
} from "./mappers/status-mapper";
import type { GoodWeUdp } from "./GoodWe/GoodWe";

interface StateAdapter {
  config: ioBroker.AdapterConfig;
  log: ioBroker.Logger;
  setObjectNotExistsAsync: (
    id: string,
    object: ioBroker.SettableObject,
  ) => Promise<unknown>;
  extendObjectAsync: (
    id: string,
    object: ioBroker.PartialObject,
  ) => Promise<unknown>;
  getObjectAsync: (id: string) => Promise<ioBroker.Object | null | undefined>;
  delObjectAsync: (id: string) => Promise<unknown>;
  setStateChangedAsync: (
    id: string,
    state: ioBroker.StateValue,
    ack: boolean,
  ) => Promise<unknown>;
}

const optionalDerivedStates: Record<string, string[]> = {
  bmsInfoExtended: ["BMSInfo.WarningCodeActive", "BMSInfo.DRMStatusActive"],
};

const legacyModeTextStates = [
  "RunningData.GridModeText",
  "RunningData.WorkModeText",
  "RunningData.OperationModeText",
  "RunningData.PV1.ModeText",
  "RunningData.PV2.ModeText",
  "RunningData.PV3.ModeText",
  "RunningData.PV4.ModeText",
  "RunningData.Battery1.ModeText",
  "RunningData.BackUpL1.ModeText",
  "RunningData.BackUpL2.ModeText",
  "RunningData.BackUpL3.ModeText",
];

class GoodWeStateManager {
  private adapter: StateAdapter;
  private inverter: GoodWeUdp;
  private stopped = false;

  constructor(adapter: StateAdapter, inverter: GoodWeUdp) {
    this.adapter = adapter;
    this.inverter = inverter;
  }

  /**
   * Blocks further state writes once the adapter unloads.
   *
   * A poll that is still in flight when onUnload() runs would otherwise write
   * states after the adapter reported shutdown.
   */
  Stop(): void {
    this.stopped = true;
  }

  private async Write(id: string, value: ioBroker.StateValue): Promise<void> {
    if (this.stopped) {
      return;
    }

    await this.adapter.setStateChangedAsync(id, value, true);
  }

  async InitializeObjects(): Promise<void> {
    await this.DeleteLegacyTypoStates();
    await this.DeleteLegacyModeTextStates();
    await this.CleanupDisabledOptionalStates();
    await this.CreateObjectsFromRegisterMap();
    await this.CreateDerivedObjects();
    await this.CreateDecodedStatusObjects();
  }

  async SetConnection(value: boolean): Promise<void> {
    await this.Write("info.connection", value);
  }

  /**
   * Acknowledges a written state without reading the inverter again.
   *
   * @param id state id without the adapter namespace
   * @param value value the inverter confirmed
   */
  async Acknowledge(id: string, value: ioBroker.StateValue): Promise<void> {
    await this.Write(id, value);
  }

  IsRegisterGroupEnabled(groupName: string): boolean {
    const configKey = optionalGroupConfigs[groupName];

    if (!configKey) {
      return true;
    }

    // Inverter control writes into this group and reads it back, so its poll
    // switch must not delete the very states the control path subscribes.
    if (writableGroups.has(groupName) && this.IsControlEnabled()) {
      return true;
    }

    // Normalize here as well: a mistyped switch does not only disable the
    // group, it makes CleanupDisabledOptionalStates() delete its objects.
    const config = this.adapter.config as Record<string, unknown>;

    return (
      normalizeBoolean(config.pollExtended, true) &&
      normalizeBoolean(config[configKey], booleanDefaults[configKey] ?? false)
    );
  }

  async CreateObjectsFromRegisterMap(): Promise<void> {
    const channels = new Set<string>();

    for (const [groupName, group] of Object.entries(registerGroups)) {
      if (!this.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      channels.add(group.channel);

      for (const item of group.entries) {
        const parts = item.state.split(".");
        parts.pop();

        while (parts.length > 0) {
          channels.add(parts.join("."));
          parts.pop();
        }
      }
    }

    for (const channel of channels) {
      await this.adapter.setObjectNotExistsAsync(channel, {
        type: "channel",
        common: { name: channel.split(".").pop() ?? channel },
        native: {},
      });
    }

    for (const [groupName, group] of Object.entries(registerGroups)) {
      if (!this.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      for (const item of group.entries) {
        const writable = item.writable !== undefined && this.IsControlEnabled();
        const role = this.StateRole(item, writable);

        await this.adapter.setObjectNotExistsAsync(item.state, {
          type: "state",
          common: {
            name: item.state.split(".").pop() ?? item.state,
            type: item.type === TYPE.STRING ? "string" : "number",
            role,
            read: true,
            write: writable,
            unit: item.unit,
            states: item.states,
          },
          native: {
            address: item.address,
            type: item.type,
            scale: item.scale,
          },
        });
        await this.UpdateExistingStateEnums(item.state, item.states);

        if (item.writable !== undefined) {
          await this.UpdateExistingControlFlags(item.state, role, writable);
        }
      }
    }
  }

  /**
   * Reports whether inverter control is switched on in the instance config.
   */
  IsControlEnabled(): boolean {
    const config = this.adapter.config as Record<string, unknown>;

    return normalizeBoolean(
      config.enableControl,
      booleanDefaults.enableControl,
    );
  }

  /**
   * Returns the role a state gets, depending on whether it accepts writes.
   *
   * ioBroker pairs "level" roles with write access and "value" roles with
   * read-only states, so a writable register may not keep its read role.
   *
   * @param item register entry
   * @param writable whether the state accepts writes
   */
  StateRole(item: RegisterEntry, writable: boolean): string {
    if (item.type === TYPE.STRING) {
      return "text";
    }

    return writable ? "level" : item.role;
  }

  /**
   * Keeps role and write flag of an existing object in sync with the switch.
   *
   * Turning control off has to take the write permission away again, otherwise
   * a state stays writable although the adapter no longer sends anything.
   *
   * @param id state id
   * @param role role the state should have
   * @param writable whether the state accepts writes
   */
  async UpdateExistingControlFlags(
    id: string,
    role: string,
    writable: boolean,
  ): Promise<void> {
    const object = await this.adapter.getObjectAsync(id);

    if (
      object?.type !== "state" ||
      (object.common.write === writable && object.common.role === role)
    ) {
      return;
    }

    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: { role, write: writable },
    });
  }

  async UpdateExistingStateEnums(
    id: string,
    states: ioBroker.StateCommon["states"] | undefined,
  ): Promise<void> {
    if (!states) {
      return;
    }

    const object = await this.adapter.getObjectAsync(id);

    if (object?.type !== "state") {
      return;
    }

    if (JSON.stringify(object.common.states) === JSON.stringify(states)) {
      return;
    }

    await this.adapter.extendObjectAsync(id, {
      type: "state",
      common: { states },
    });
    this.adapter.log.info(`Updated enum labels for ${id}`);
  }

  async CreateDerivedObjects(): Promise<void> {
    await this.adapter.setObjectNotExistsAsync("RunningData.TotalPowerPv", {
      type: "state",
      common: {
        name: "TotalPowerPv",
        type: "number",
        role: "value.power",
        read: true,
        write: false,
        unit: "W",
      },
      native: {},
    });
  }

  async CleanupDisabledOptionalStates(): Promise<void> {
    const enabledChannels = new Set<string>();

    for (const [groupName, group] of Object.entries(registerGroups)) {
      if (!this.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      for (const channel of this.GetRegisterGroupChannels(group)) {
        enabledChannels.add(channel);
      }
    }

    for (const groupName of Object.keys(optionalGroupConfigs)) {
      if (this.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      const group = registerGroups[groupName];

      for (const item of group.entries) {
        const object = await this.adapter.getObjectAsync(item.state);

        if (object) {
          await this.adapter.delObjectAsync(item.state);
          this.adapter.log.debug(
            `Deleted disabled optional state ${item.state}`,
          );
        }
      }

      for (const state of optionalDerivedStates[groupName] ?? []) {
        await this.DeleteObjectIfExists(state);
      }

      for (const channel of this.GetRegisterGroupChannels(group)
        .filter((channel) => !enabledChannels.has(channel))
        .sort(
          (left, right) => right.split(".").length - left.split(".").length,
        )) {
        await this.DeleteObjectIfExists(channel);
      }
    }
  }

  GetRegisterGroupChannels(group: RegisterGroup): string[] {
    const channels = new Set([group.channel]);

    for (const item of group.entries) {
      const parts = item.state.split(".");
      parts.pop();

      while (parts.length > 0) {
        channels.add(parts.join("."));
        parts.pop();
      }
    }

    return Array.from(channels);
  }

  async DeleteObjectIfExists(id: string): Promise<void> {
    const object = await this.adapter.getObjectAsync(id);

    if (object) {
      await this.adapter.delObjectAsync(id);
      this.adapter.log.debug(`Deleted disabled optional object ${id}`);
    }
  }

  async DeleteLegacyTypoStates(): Promise<void> {
    for (const state of [
      "RunningData.ModulTemperature",
      "RunningData.SaftyCountry",
    ]) {
      const object = await this.adapter.getObjectAsync(state);

      if (object) {
        await this.adapter.delObjectAsync(state);
        this.adapter.log.info(`Deleted legacy typo state ${state}`);
      }
    }
  }

  async DeleteLegacyModeTextStates(): Promise<void> {
    for (const state of legacyModeTextStates) {
      const object = await this.adapter.getObjectAsync(state);

      if (object) {
        await this.adapter.delObjectAsync(state);
        this.adapter.log.info(`Deleted legacy mode text state ${state}`);
      }
    }
  }

  async CreateDecodedStatusObjects(): Promise<void> {
    const states = [
      "RunningData.ErrorMessageActive",
      "RunningData.DiagStatusActive",
      "BMSInfo.ErrorCodeActive",
    ];

    if (this.IsRegisterGroupEnabled("bmsInfoExtended")) {
      states.push(...optionalDerivedStates.bmsInfoExtended);
    }

    for (const state of states) {
      await this.adapter.setObjectNotExistsAsync(state, {
        type: "state",
        common: {
          name: state.split(".").pop() ?? state,
          type: "string",
          role: "text",
          read: true,
          write: false,
        },
        native: {},
      });
    }
  }

  async UpdateStatesFromRegisterMap(group: RegisterGroup): Promise<void> {
    const source = (this.inverter as unknown as Record<string, unknown>)[
      group.target
    ];

    for (const item of group.entries) {
      await this.Write(
        item.state,
        this.GetStateValue(item.state, item.model, source),
      );
    }
  }

  GetStateValue(
    state: string,
    path: string,
    source: unknown,
  ): ioBroker.StateValue {
    const value = this.GetMappedValue(path, source);

    if (
      state === "RunningData.Battery1.Mode" &&
      (value === 2 || value === 3) &&
      (this.GetMappedValue("Battery1.Current", source) === 0 ||
        this.GetMappedValue("Battery1.Power", source) === 0)
    ) {
      return 1;
    }

    return value;
  }

  GetMappedValue(path: string, source: unknown): ioBroker.StateValue {
    const value = path
      .split(".")
      .reduce<unknown>(
        (current, part) =>
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined,
        source,
      );

    return value as ioBroker.StateValue;
  }

  async UpdateDerivedRunningStates(): Promise<void> {
    await this.Write(
      "RunningData.TotalPowerPv",
      this.inverter.RunningData.TotalPowerPv,
    );
  }

  async UpdateDecodedRunningStatuses(): Promise<void> {
    for (const state of getDecodedRunningStatuses(this.inverter.RunningData)) {
      await this.Write(state.id, state.value);
    }
  }

  async UpdateDecodedBmsStatuses(): Promise<void> {
    for (const state of getDecodedBmsStatuses(
      this.inverter.BmsInfo,
      this.IsRegisterGroupEnabled("bmsInfoExtended"),
    )) {
      await this.Write(state.id, state.value);
    }
  }
}

export default GoodWeStateManager;
