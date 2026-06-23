"use strict";

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const goodWe = require("./GoodWe/GoodWe");
const {
  optionalGroupConfigs,
  registerGroups,
  TYPE,
} = require("./lib/register-map");
const {
  bitfields,
  decodeBitfield,
  decodeValue,
  valueStates,
} = require("./lib/status-definitions");
const {
  discoverGoodWeInverters,
  extractIpv4Address,
  probeGoodWeInverter,
  validateIpv4Address,
} = require("./lib/goodwe-discovery");

class Goodwe extends utils.Adapter {
  interval;
  cycleCnt = 0;

  /**
   * @param {Partial<utils.AdapterOptions>} [options]
   */
  constructor(options) {
    super({
      ...options,
      name: "goodwe",
    });

    this.inverter = new goodWe.GoodWeUdp(this.log);
    this.pollTimer = undefined;
    this.on("ready", this.onReady.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Initialize your adapter here
    this.inverter = new goodWe.GoodWeUdp(this.log);
    await this.DeleteLegacyTypoStates();
    await this.CleanupDisabledOptionalStates();
    await this.CreateObjectsFromRegisterMap();
    await this.CreateDerivedObjects();
    await this.CreateDecodedStatusObjects();

    // Reset the connection indicator during startup
    this.setState("info.connection", false, true);

    const configuredIp = extractIpv4Address(this.config.ipAddr);

    if (configuredIp === "") {
      this.log.warn("No inverter IP address configured yet");
      return;
    }

    this.config.ipAddr = configuredIp;
    const ipValidation = validateIpv4Address(this.config.ipAddr);

    if (!ipValidation.valid) {
      this.log.error(
        `Invalid inverter IP address "${this.config.ipAddr}": ${ipValidation.reason}`,
      );
      return;
    }

    await this.inverter.Connect(this.config.ipAddr, 8899, {
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
    });

    this.myTimer();
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      if (this.pollTimer) {
        this.clearTimeout(this.pollTimer);
      }
      this.inverter.destructor();

      callback();
    } catch (e) {
      this.log.error(`error: ${e}`);
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   *
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  onStateChange(id, state) {
    if (state) {
      // The state was changed
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      // The state was deleted
      this.log.info(`state ${id} deleted`);
    }
  }

  async onMessage(obj) {
    if (!obj?.command) {
      return;
    }

    const respond = (payload) => {
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, payload, obj.callback);
      }
    };

    try {
      switch (obj.command) {
        case "validateIp": {
          const ip = this.GetConfiguredIp(obj.message?.ip);
          const validation = validateIpv4Address(ip);

          if (!validation.valid) {
            respond({
              valid: false,
              reachable: false,
              error: validation.reason,
            });
            return;
          }

          const result = await probeGoodWeInverter(validation.ip, {
            timeoutMs: Number(obj.message?.timeoutMs) || 1000,
          });

          respond({
            valid: true,
            reachable: result.reachable,
            ip: validation.ip,
            idInfo: result.idInfo,
            error: result.error,
          });
          return;
        }

        case "discoverInverters": {
          const result = await discoverGoodWeInverters({
            ip: this.GetConfiguredIp(obj.message?.ip),
            subnet: this.GetConfiguredSubnet(obj.message?.subnet),
            timeoutMs: Number(obj.message?.timeoutMs) || 700,
            concurrency: Number(obj.message?.concurrency) || undefined,
          });

          respond(result);
          return;
        }

        default:
          respond({ error: `Unknown command: ${obj.command}` });
      }
    } catch (error) {
      respond({ error: error.message ?? String(error) });
    }
  }

  GetConfiguredIp(messageIp) {
    const ipFromMessage = extractIpv4Address(messageIp);

    if (ipFromMessage !== "") {
      return ipFromMessage;
    }

    return extractIpv4Address(this.config.ipAddr);
  }

  GetConfiguredSubnet(messageSubnet) {
    if (typeof messageSubnet === "string" && messageSubnet.trim() !== "") {
      return messageSubnet.trim();
    }

    if (
      typeof this.config.discoverySubnet === "string" &&
      this.config.discoverySubnet.trim() !== ""
    ) {
      return this.config.discoverySubnet.trim();
    }

    return undefined;
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
      await this.setObjectNotExistsAsync(channel, {
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
        await this.setObjectNotExistsAsync(item.state, {
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
    await this.setObjectNotExistsAsync("RunningData.TotalPowerPv", {
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

  IsRegisterGroupEnabled(groupName) {
    const configKey = optionalGroupConfigs[groupName];

    if (!configKey) {
      return true;
    }

    return (
      this.config.pollExtended !== false && this.config[configKey] === true
    );
  }

  async CleanupDisabledOptionalStates() {
    if (this.config.cleanupDisabledStates !== true) {
      return;
    }

    for (const [groupName, configKey] of Object.entries(optionalGroupConfigs)) {
      if (
        this.config.pollExtended !== false &&
        this.config[configKey] === true
      ) {
        continue;
      }

      for (const item of registerGroups[groupName].entries) {
        const object = await this.getObjectAsync(item.state);

        if (object) {
          await this.delObjectAsync(item.state);
          this.log.debug(`Deleted disabled optional state ${item.state}`);
        }
      }
    }
  }

  async DeleteLegacyTypoStates() {
    for (const state of [
      "RunningData.ModulTemperature",
      "RunningData.SaftyCountry",
    ]) {
      const object = await this.getObjectAsync(state);

      if (object) {
        await this.delObjectAsync(state);
        this.log.info(`Deleted legacy typo state ${state}`);
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
      "BMSInfo.WarningCodeActive",
      "BMSInfo.DRMStatusActive",
    ];

    for (const state of states) {
      await this.setObjectNotExistsAsync(state, {
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
      await this.setStateAsync(
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
    const data = this.inverter.RunningData;

    await this.setStateAsync(
      "RunningData.GridModeText",
      decodeValue(data.GridMode, valueStates.gridStatus),
      true,
    );
    await this.setStateAsync(
      "RunningData.WorkModeText",
      decodeValue(data.WorkMode, valueStates.workMode),
      true,
    );
    await this.setStateAsync(
      "RunningData.OperationModeText",
      decodeValue(data.OperationMode, valueStates.operationMode),
      true,
    );
    await this.setStateAsync(
      "RunningData.Battery1.ModeText",
      decodeValue(data.Battery1.Mode, valueStates.batteryStatus),
      true,
    );

    for (const pv of ["PV1", "PV2", "PV3", "PV4"]) {
      await this.setStateAsync(
        `RunningData.${pv}.ModeText`,
        decodeValue(data[pv.replace("PV", "Pv")].Mode, valueStates.pvMode),
        true,
      );
    }

    for (const phase of ["BackUpL1", "BackUpL2", "BackUpL3"]) {
      await this.setStateAsync(
        `RunningData.${phase}.ModeText`,
        decodeValue(data[phase].Mode, valueStates.backupStatus),
        true,
      );
    }

    await this.setStateAsync(
      "RunningData.ErrorMessageActive",
      decodeBitfield(data.ErrorMessage, bitfields.errorMessage).join(", "),
      true,
    );
    await this.setStateAsync(
      "RunningData.DiagStatusActive",
      decodeBitfield(data.DiagStatusL, bitfields.diagnosticStatus).join(", "),
      true,
    );
  }

  async UpdateDecodedBmsStatuses() {
    const bms = this.inverter.BmsInfo;
    const errorCode = (bms.ErrorCodeH ?? 0) * 0x10000 + (bms.ErrorCode ?? 0);
    const warningCode =
      (bms.WarningCodeH ?? 0) * 0x10000 + (bms.WarningCodeL ?? 0);

    await this.setStateAsync(
      "BMSInfo.ErrorCodeActive",
      decodeBitfield(errorCode, bitfields.bmsAlarm).join(", "),
      true,
    );
    await this.setStateAsync(
      "BMSInfo.WarningCodeActive",
      decodeBitfield(warningCode, bitfields.bmsWarning).join(", "),
      true,
    );
    await this.setStateAsync(
      "BMSInfo.DRMStatusActive",
      decodeBitfield(bms.DRMStatus ?? 0, bitfields.drmStatus).join(", "),
      true,
    );
  }

  async UpdateDeviceInfo() {
    const success = await this.inverter.ReadGroup("deviceInfo");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.deviceInfo);
    await this.setStateAsync("info.connection", this.inverter.Status, true);
  }

  async UpdateRunningData() {
    const success = await this.inverter.ReadGroup("runningData");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.runningData);
    await this.UpdateDecodedRunningStatuses();
    await this.setStateAsync(
      "RunningData.TotalPowerPv",
      this.inverter.RunningData.TotalPowerPv,
      true,
    );
  }

  async UpdateExtComData() {
    const success = await this.inverter.ReadGroup("extComData");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.extComData);
  }

  async UpdateBmsInfo() {
    const success = await this.inverter.ReadGroup("bmsInfo");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.bmsInfo);
    await this.UpdateDecodedBmsStatuses();
  }

  async UpdateAdditionalRegisterGroups() {
    for (const groupName of Object.keys(optionalGroupConfigs)) {
      if (!this.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      const group = registerGroups[groupName];
      const success = await this.inverter.ReadGroup(groupName, {
        optional: true,
      });

      if (success) {
        await this.UpdateStatesFromRegisterMap(group);
      }
    }

    await this.UpdateDecodedBmsStatuses();
    await this.setStateAsync("info.connection", this.inverter.Status, true);
  }

  async myTimer() {
    try {
      if (this.inverter.Status == false) {
        this.cycleCnt = 0;
        const success = await this.inverter.ReadIdInfo();
        await this.setStateAsync("info.connection", success, true);
      } else {
        switch (this.cycleCnt) {
          case 1:
            await this.UpdateDeviceInfo();
            //this.log.info("Goodwe update");
            break;

          case 3:
            await this.UpdateRunningData();
            break;

          case 5:
            await this.UpdateExtComData();
            break;

          case 7:
            await this.UpdateBmsInfo();
            break;

          case 9:
            if (this.config.pollExtended !== false) {
              await this.UpdateAdditionalRegisterGroups();
            }
            break;
        }

        if (this.cycleCnt >= this.config.pollCycle) {
          this.cycleCnt = 0;
        }

        this.cycleCnt++;
      }
    } catch (error) {
      this.log.warn(`poll cycle failed: ${error.message ?? error}`);
      await this.setStateAsync("info.connection", false, true);
    } finally {
      this.pollTimer = this.setTimeout(() => this.myTimer(), 1000);
    }
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options]
   */
  module.exports = (options) => new Goodwe(options);
} else {
  // otherwise start the instance directly
  new Goodwe();
}
