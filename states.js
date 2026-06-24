"use strict";

const {
  optionalGroupConfigs,
  registerGroups,
  TYPE,
} = require("./lib/register-map");
const {
  getDecodedBmsStatuses,
  getDecodedRunningStatuses,
} = require("./mappers/status-mapper");

const optionalDerivedStates = {
  bmsInfoExtended: ["BMSInfo.WarningCodeActive", "BMSInfo.DRMStatusActive"],
};

class GoodWeStateManager {
  constructor(adapter, inverter) {
    this.adapter = adapter;
    this.inverter = inverter;
  }

  async InitializeObjects() {
    await this.DeleteLegacyTypoStates();
    await this.CleanupDisabledOptionalStates();
    await this.CreateObjectsFromRegisterMap();
    await this.CreateDerivedObjects();
    await this.CreateDecodedStatusObjects();
  }

  async SetConnection(value) {
    await this.adapter.setStateChangedAsync("info.connection", value, true);
  }

  IsRegisterGroupEnabled(groupName) {
    const configKey = optionalGroupConfigs[groupName];

    if (!configKey) {
      return true;
    }

    return (
      this.adapter.config.pollExtended !== false &&
      this.adapter.config[configKey] === true
    );
  }

  async CreateObjectsFromRegisterMap() {
    const channels = new Set();

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
        common: { name: channel.split(".").pop() },
        native: {},
      });
    }

    for (const [groupName, group] of Object.entries(registerGroups)) {
      if (!this.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      for (const item of group.entries) {
        await this.adapter.setObjectNotExistsAsync(item.state, {
          type: "state",
          common: {
            name: item.state.split(".").pop(),
            type: item.type === TYPE.STRING ? "string" : "number",
            role: item.type === TYPE.STRING ? "text" : item.role,
            read: true,
            write: false,
            unit: item.unit,
          },
          native: {
            address: item.address,
            type: item.type,
            scale: item.scale,
          },
        });
      }
    }
  }

  async CreateDerivedObjects() {
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

  async CleanupDisabledOptionalStates() {
    const enabledChannels = new Set();

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

      for (const item of registerGroups[groupName].entries) {
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

  GetRegisterGroupChannels(group) {
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

  async DeleteObjectIfExists(id) {
    const object = await this.adapter.getObjectAsync(id);

    if (object) {
      await this.adapter.delObjectAsync(id);
      this.adapter.log.debug(`Deleted disabled optional object ${id}`);
    }
  }

  async DeleteLegacyTypoStates() {
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

  async CreateDecodedStatusObjects() {
    const states = [
      "RunningData.GridModeText",
      "RunningData.WorkModeText",
      "RunningData.OperationModeText",
      "RunningData.ErrorMessageActive",
      "RunningData.DiagStatusActive",
      "RunningData.PV1.ModeText",
      "RunningData.PV2.ModeText",
      "RunningData.PV3.ModeText",
      "RunningData.PV4.ModeText",
      "RunningData.Battery1.ModeText",
      "RunningData.BackUpL1.ModeText",
      "RunningData.BackUpL2.ModeText",
      "RunningData.BackUpL3.ModeText",
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

  async UpdateStatesFromRegisterMap(group) {
    for (const item of group.entries) {
      await this.adapter.setStateChangedAsync(
        item.state,
        this.GetMappedValue(item.model, this.inverter[this.GroupGetter(group)]),
        true,
      );
    }
  }

  GroupGetter(group) {
    switch (group.name) {
      case "DeviceInfo":
        return "DeviceInfo";
      case "RunningData":
        return "RunningData";
      case "ExtComData":
        return "ExtComData";
      case "BMSInfo":
        return "BmsInfo";
      case "DeviceInfo.SIMCCID":
        return "DeviceInfo";
      case "ExtComData.Extended":
        return "ExtComData";
      case "FlashInfo":
        return "FlashInfo";
      case "BMSInfo.Extended":
        return "BmsInfo";
      case "BMSDetail":
        return "BmsDetail";
      case "CEIAutoTest":
        return "CeiAutoTest";
      case "PowerLimit":
        return "PowerLimit";
      default:
        return "";
    }
  }

  GetMappedValue(path, source) {
    return path.split(".").reduce((current, part) => current?.[part], source);
  }

  async UpdateDecodedRunningStatuses() {
    for (const state of getDecodedRunningStatuses(this.inverter.RunningData)) {
      await this.adapter.setStateChangedAsync(state.id, state.value, true);
    }
  }

  async UpdateDecodedBmsStatuses() {
    for (const state of getDecodedBmsStatuses(
      this.inverter.BmsInfo,
      this.IsRegisterGroupEnabled("bmsInfoExtended"),
    )) {
      await this.adapter.setStateChangedAsync(state.id, state.value, true);
    }
  }
}

module.exports = GoodWeStateManager;
