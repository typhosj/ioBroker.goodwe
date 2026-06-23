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

let tmr_timeout = null;

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
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Initialize your adapter here
    this.inverter = new goodWe.GoodWeUdp(this.log);
    this.CreateObjectsDeviceInfo();
    this.CreateObjectsRunningData();
    this.CreateObjectsExtComData();
    this.CreateObjectsBmsInfo();
    await this.CleanupDisabledOptionalStates();
    await this.CreateObjectsFromRegisterMap();
    await this.CreateDecodedStatusObjects();

    // Reset the connection indicator during startup
    this.setState("info.connection", false, true);

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
      this.clearTimeout(tmr_timeout);
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

  CreateObjectsDeviceInfo() {
    this.setObjectNotExistsAsync("DeviceInfo", {
      type: "channel",
      common: { name: "DeviceInfo" },
      native: {},
    });

    this.CreateObjectStateNumber("DeviceInfo", "ModbusProtocolVersion");
    this.CreateObjectStateNumber("DeviceInfo", "RatedPower");
    this.CreateObjectStateNumber("DeviceInfo", "AcOutputType");
    this.CreateObjectStateString("DeviceInfo", "SerialNumber");
    this.CreateObjectStateString("DeviceInfo", "DeviceType");
    this.CreateObjectStateNumber("DeviceInfo", "DSP1_SW_Version");
    this.CreateObjectStateNumber("DeviceInfo", "DSP2_SW_Version");
    this.CreateObjectStateNumber("DeviceInfo", "DSP_SVN_Version");
    this.CreateObjectStateNumber("DeviceInfo", "ARM_SW_Version");
    this.CreateObjectStateNumber("DeviceInfo", "ARM_SVN_Version");
    this.CreateObjectStateString("DeviceInfo", "DSP_Int_FW_Version");
    this.CreateObjectStateString("DeviceInfo", "ARM_Int_FW_Version");
  }

  CreateObjectsRunningData() {
    this.setObjectNotExistsAsync("RunningData", {
      type: "channel",
      common: { name: "RunningData" },
      native: {},
    });

    this.CreateObjectsDcParameters("RunningData", "PV1");
    this.CreateObjectsDcParameters("RunningData", "PV2");
    this.CreateObjectsDcParameters("RunningData", "PV3");
    this.CreateObjectsDcParameters("RunningData", "PV4");
    this.CreateObjectsAcPhase("RunningData", "GridL1");
    this.CreateObjectsAcPhase("RunningData", "GridL2");
    this.CreateObjectsAcPhase("RunningData", "GridL3");
    this.CreateObjectStateNumber("RunningData", "GridMode");
    this.CreateObjectStateNumber("RunningData", "InverterTotalPower");
    this.CreateObjectStateNumber("RunningData", "AcActivePower");
    this.CreateObjectStateNumber("RunningData", "AcReactivePower");
    this.CreateObjectStateNumber("RunningData", "AcApparentPower");
    this.CreateObjectsPhaseBackUp("RunningData", "BackUpL1");
    this.CreateObjectsPhaseBackUp("RunningData", "BackUpL2");
    this.CreateObjectsPhaseBackUp("RunningData", "BackUpL3");
    this.CreateObjectStateNumber("RunningData", "PowerL1");
    this.CreateObjectStateNumber("RunningData", "PowerL2");
    this.CreateObjectStateNumber("RunningData", "PowerL3");
    this.CreateObjectStateNumber("RunningData", "TotalPowerBackUp");
    this.CreateObjectStateNumber("RunningData", "TotalPower");
    this.CreateObjectStateNumber("RunningData", "UpsLoadPercent");
    this.CreateObjectStateNumber("RunningData", "AirTemperature");
    this.CreateObjectStateNumber("RunningData", "ModulTemperature");
    this.CreateObjectStateNumber("RunningData", "RadiatorTemperature");
    this.CreateObjectStateNumber("RunningData", "FunctionBitValue");
    this.CreateObjectStateNumber("RunningData", "BusVoltage");
    this.CreateObjectStateNumber("RunningData", "NbusVoltage");
    this.CreateObjectsDcParameters("RunningData", "Battery1");
    this.CreateObjectStateNumber("RunningData", "WarningCode");
    this.CreateObjectStateNumber("RunningData", "SaftyCountry");
    this.CreateObjectStateNumber("RunningData", "WorkMode");
    this.CreateObjectStateNumber("RunningData", "OperationMode");
    this.CreateObjectStateNumber("RunningData", "ErrorMessage");
    this.CreateObjectStateNumber("RunningData", "PvEnergyTotal");
    this.CreateObjectStateNumber("RunningData", "PvEnergyDay");
    this.CreateObjectStateNumber("RunningData", "EnergyTotal");
    this.CreateObjectStateNumber("RunningData", "HoursTotal");
    this.CreateObjectStateNumber("RunningData", "EnergyDaySell");
    this.CreateObjectStateNumber("RunningData", "EnergyTotalBuy");
    this.CreateObjectStateNumber("RunningData", "EnergyDayBuy");
    this.CreateObjectStateNumber("RunningData", "EnergyTotalLoad");
    this.CreateObjectStateNumber("RunningData", "EnergyDayLoad");
    this.CreateObjectStateNumber("RunningData", "EnergyBatteryCharge");
    this.CreateObjectStateNumber("RunningData", "EnergyDayCharge");
    this.CreateObjectStateNumber("RunningData", "EnergyBatteryDischarge");
    this.CreateObjectStateNumber("RunningData", "EnergyDayDischarge");
    this.CreateObjectStateNumber("RunningData", "BatteryStrings");
    this.CreateObjectStateNumber("RunningData", "CpldWarningCode");
    this.CreateObjectStateNumber("RunningData", "WChargeCtrFlag");
    //this.CreateObjectStateNumber("RunningData", "DerateFlag");
    this.CreateObjectStateNumber("RunningData", "DerateFrozenPower");
    this.CreateObjectStateNumber("RunningData", "DiagStatusH");
    this.CreateObjectStateNumber("RunningData", "DiagStatusL");
    this.CreateObjectStateNumber("RunningData", "TotalPowerPv");
  }

  CreateObjectsExtComData() {
    this.setObjectNotExistsAsync("ExtComData", {
      type: "channel",
      common: { name: "ExtComData" },
      native: {},
    });

    this.CreateObjectStateNumber("ExtComData", "Commode");
    this.CreateObjectStateNumber("ExtComData", "Rssi");
    this.CreateObjectStateNumber("ExtComData", "ManufacturerCode");
    this.CreateObjectStateNumber("ExtComData", "MeterConnectStatus");
    this.CreateObjectStateNumber("ExtComData", "MeterCommunicateStatus");
    this.CreateObjectMeterPhase("ExtComData", "L1");
    this.CreateObjectMeterPhase("ExtComData", "L2");
    this.CreateObjectMeterPhase("ExtComData", "L3");
    this.CreateObjectStateNumber("ExtComData", "TotalActivePower");
    this.CreateObjectStateNumber("ExtComData", "TotalReactivePower");
    this.CreateObjectStateNumber("ExtComData", "PowerFactor");
    this.CreateObjectStateNumber("ExtComData", "Frequency");
    this.CreateObjectStateNumber("ExtComData", "EnergyTotalSell");
    this.CreateObjectStateNumber("ExtComData", "EnergyTotalBuy");
  }

  CreateObjectsBmsInfo() {
    this.setObjectNotExistsAsync("BMSInfo", {
      type: "channel",
      common: { name: "ExtComData" },
      native: {},
    });

    this.CreateObjectStateNumber("BMSInfo", "Status");
    this.CreateObjectStateNumber("BMSInfo", "PackTemperature");
    this.CreateObjectStateNumber("BMSInfo", "CurrentMaxCharge");
    this.CreateObjectStateNumber("BMSInfo", "CurrentMaxDischarge");
    this.CreateObjectStateNumber("BMSInfo", "ErrorCode");
    this.CreateObjectStateNumber("BMSInfo", "SOC");
    this.CreateObjectStateNumber("BMSInfo", "SOH");
    this.CreateObjectStateNumber("BMSInfo", "BatteryStrings");
  }

  CreateObjectStateNumber(Path, Name) {
    this.setObjectNotExistsAsync(`${Path}.${Name}`, {
      type: "state",
      common: {
        name: Name,
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });
  }

  CreateObjectStateString(Path, Name) {
    this.setObjectNotExistsAsync(`${Path}.${Name}`, {
      type: "state",
      common: {
        name: "Name",
        type: "string",
        role: "text",
        read: true,
        write: false,
      },
      native: {},
    });
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

  CreateObjectsDcParameters(Path, Name) {
    this.setObjectNotExistsAsync(`${Path}.${Name}`, {
      type: "channel",
      common: { name: "Name" },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Voltage`, {
      type: "state",
      common: {
        name: "Voltage",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Current`, {
      type: "state",
      common: {
        name: "Current",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Power`, {
      type: "state",
      common: {
        name: "Power",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Mode`, {
      type: "state",
      common: {
        name: "Mode",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });
  }

  CreateObjectsAcPhase(Path, Name) {
    this.setObjectNotExistsAsync(`${Path}.${Name}`, {
      type: "channel",
      common: { name: "Name" },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Voltage`, {
      type: "state",
      common: {
        name: "Voltage",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Current`, {
      type: "state",
      common: {
        name: "Current",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Frequency`, {
      type: "state",
      common: {
        name: "Frequency",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Power`, {
      type: "state",
      common: {
        name: "Power",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });
  }

  CreateObjectsPhaseBackUp(Path, Name) {
    this.setObjectNotExistsAsync(`${Path}.${Name}`, {
      type: "channel",
      common: { name: "Name" },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Voltage`, {
      type: "state",
      common: {
        name: "Voltage",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Current`, {
      type: "state",
      common: {
        name: "Current",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Frequency`, {
      type: "state",
      common: {
        name: "Frequency",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Power`, {
      type: "state",
      common: {
        name: "Power",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.Mode`, {
      type: "state",
      common: {
        name: "Mode",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });
  }

  CreateObjectMeterPhase(Path, Name) {
    this.setObjectNotExistsAsync(`${Path}.${Name}`, {
      type: "channel",
      common: { name: Name },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.ActivePower`, {
      type: "state",
      common: {
        name: "ActivePower",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    this.setObjectNotExistsAsync(`${Path}.${Name}.PowerFactor`, {
      type: "state",
      common: {
        name: "PowerFactor",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });
  }

  async UpdateDeviceInfo() {
    const success = await this.inverter.ReadGroup("deviceInfo");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.deviceInfo);

    this.setStateAsync(
      "DeviceInfo.ModbusProtocolVersion",
      this.inverter.DeviceInfo.ModbusProtocolVersion,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.RatedPower",
      this.inverter.DeviceInfo.RatedPower,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.AcOutputType",
      this.inverter.DeviceInfo.AcOutputType,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.SerialNumber",
      this.inverter.DeviceInfo.SerialNumber,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.DeviceType",
      this.inverter.DeviceInfo.DeviceType,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.DSP1_SW_Version",
      this.inverter.DeviceInfo.DSP1_SoftwareVersion,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.DSP2_SW_Version",
      this.inverter.DeviceInfo.DSP2_SoftwareVersion,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.DSP_SVN_Version",
      this.inverter.DeviceInfo.DSP_SVN_Version,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.ARM_SW_Version",
      this.inverter.DeviceInfo.ARM_SoftwareVersion,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.ARM_SVN_Version",
      this.inverter.DeviceInfo.ARM_SVN_Version,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.DSP_Int_FW_Version",
      this.inverter.DeviceInfo.DSP_IntFirmwareVersion,
      true,
    );
    this.setStateAsync(
      "DeviceInfo.ARM_Int_FW_Version",
      this.inverter.DeviceInfo.ARM_IntFirmwareVersion,
      true,
    );

    this.setStateAsync("info.connection", this.inverter.Status, true);
  }

  async UpdateRunningData() {
    const success = await this.inverter.ReadGroup("runningData");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.runningData);
    await this.UpdateDecodedRunningStatuses();

    this.setStateAsync(
      "RunningData.PV1.Voltage",
      this.inverter.RunningData.Pv1.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.PV1.Current",
      this.inverter.RunningData.Pv1.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.PV1.Power",
      this.inverter.RunningData.Pv1.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.PV1.Mode",
      this.inverter.RunningData.Pv1.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.PV2.Voltage",
      this.inverter.RunningData.Pv2.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.PV2.Current",
      this.inverter.RunningData.Pv2.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.PV2.Power",
      this.inverter.RunningData.Pv2.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.PV2.Mode",
      this.inverter.RunningData.Pv2.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.PV3.Voltage",
      this.inverter.RunningData.Pv3.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.PV3.Current",
      this.inverter.RunningData.Pv3.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.PV3.Power",
      this.inverter.RunningData.Pv3.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.PV3.Mode",
      this.inverter.RunningData.Pv3.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.PV4.Voltage",
      this.inverter.RunningData.Pv4.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.PV4.Current",
      this.inverter.RunningData.Pv4.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.PV4.Power",
      this.inverter.RunningData.Pv4.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.PV4.Mode",
      this.inverter.RunningData.Pv4.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.PV1.Voltage",
      this.inverter.RunningData.Pv1.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.PV1.Current",
      this.inverter.RunningData.Pv1.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.PV1.Power",
      this.inverter.RunningData.Pv1.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL1.Voltage",
      this.inverter.RunningData.GridL1.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL1.Current",
      this.inverter.RunningData.GridL1.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL1.Frequency",
      this.inverter.RunningData.GridL1.Frequency,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL1.Power",
      this.inverter.RunningData.GridL1.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL2.Voltage",
      this.inverter.RunningData.GridL2.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL2.Current",
      this.inverter.RunningData.GridL2.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL2.Frequency",
      this.inverter.RunningData.GridL2.Frequency,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL2.Power",
      this.inverter.RunningData.GridL2.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL3.Voltage",
      this.inverter.RunningData.GridL3.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL3.Current",
      this.inverter.RunningData.GridL3.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL3.Frequency",
      this.inverter.RunningData.GridL3.Frequency,
      true,
    );
    this.setStateAsync(
      "RunningData.GridL3.Power",
      this.inverter.RunningData.GridL3.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.GridMode",
      this.inverter.RunningData.GridMode,
      true,
    );
    this.setStateAsync(
      "RunningData.InverterTotalPower",
      this.inverter.RunningData.InverterTotalPower,
      true,
    );
    this.setStateAsync(
      "RunningData.AcActivePower",
      this.inverter.RunningData.AcActivePower,
      true,
    );
    this.setStateAsync(
      "RunningData.AcReactivePower",
      this.inverter.RunningData.AcReactivePower,
      true,
    );
    this.setStateAsync(
      "RunningData.AcApparentPower",
      this.inverter.RunningData.AcApparentPower,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL1.Voltage",
      this.inverter.RunningData.BackUpL1.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL1.Current",
      this.inverter.RunningData.BackUpL1.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL1.Frequency",
      this.inverter.RunningData.BackUpL1.Frequency,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL1.Power",
      this.inverter.RunningData.BackUpL1.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL1.Mode",
      this.inverter.RunningData.BackUpL1.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL2.Voltage",
      this.inverter.RunningData.BackUpL2.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL2.Current",
      this.inverter.RunningData.BackUpL2.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL2.Frequency",
      this.inverter.RunningData.BackUpL2.Frequency,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL2.Power",
      this.inverter.RunningData.BackUpL2.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL2.Mode",
      this.inverter.RunningData.BackUpL2.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL3.Voltage",
      this.inverter.RunningData.BackUpL3.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL3.Current",
      this.inverter.RunningData.BackUpL3.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL3.Frequency",
      this.inverter.RunningData.BackUpL3.Frequency,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL3.Power",
      this.inverter.RunningData.BackUpL3.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.BackUpL3.Mode",
      this.inverter.RunningData.BackUpL3.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.PowerL1",
      this.inverter.RunningData.PowerL1,
      true,
    );
    this.setStateAsync(
      "RunningData.PowerL2",
      this.inverter.RunningData.PowerL2,
      true,
    );
    this.setStateAsync(
      "RunningData.PowerL3",
      this.inverter.RunningData.PowerL3,
      true,
    );
    this.setStateAsync(
      "RunningData.TotalPowerBackUp",
      this.inverter.RunningData.TotalPowerBackUp,
      true,
    );
    this.setStateAsync(
      "RunningData.TotalPower",
      this.inverter.RunningData.TotalPower,
      true,
    );
    this.setStateAsync(
      "RunningData.UpsLoadPercent",
      this.inverter.RunningData.UpsLoadPercent,
      true,
    );
    this.setStateAsync(
      "RunningData.AirTemperature",
      this.inverter.RunningData.AirTemperature,
      true,
    );
    this.setStateAsync(
      "RunningData.ModulTemperature",
      this.inverter.RunningData.ModulTemperature,
      true,
    );
    this.setStateAsync(
      "RunningData.RadiatorTemperature",
      this.inverter.RunningData.RadiatorTemperature,
      true,
    );
    this.setStateAsync(
      "RunningData.FunctionBitValue",
      this.inverter.RunningData.FunctionBitValue,
      true,
    );
    this.setStateAsync(
      "RunningData.BusVoltage",
      this.inverter.RunningData.BusVoltage,
      true,
    );
    this.setStateAsync(
      "RunningData.NbusVoltage",
      this.inverter.RunningData.NbusVoltage,
      true,
    );
    this.setStateAsync(
      "RunningData.Battery1.Voltage",
      this.inverter.RunningData.Battery1.Voltage,
      true,
    );
    this.setStateAsync(
      "RunningData.Battery1.Current",
      this.inverter.RunningData.Battery1.Current,
      true,
    );
    this.setStateAsync(
      "RunningData.Battery1.Power",
      this.inverter.RunningData.Battery1.Power,
      true,
    );
    this.setStateAsync(
      "RunningData.Battery1.Mode",
      this.inverter.RunningData.Battery1.Mode,
      true,
    );
    this.setStateAsync(
      "RunningData.WarningCode",
      this.inverter.RunningData.WarningCode,
      true,
    );
    this.setStateAsync(
      "RunningData.SaftyCountry",
      this.inverter.RunningData.SaftyCountry,
      true,
    );
    this.setStateAsync(
      "RunningData.WorkMode",
      this.inverter.RunningData.WorkMode,
      true,
    );
    this.setStateAsync(
      "RunningData.OperationMode",
      this.inverter.RunningData.OperationMode,
      true,
    );
    this.setStateAsync(
      "RunningData.ErrorMessage",
      this.inverter.RunningData.ErrorMessage,
      true,
    );
    this.setStateAsync(
      "RunningData.PvEnergyTotal",
      this.inverter.RunningData.PvEnergyTotal,
      true,
    );
    this.setStateAsync(
      "RunningData.PvEnergyDay",
      this.inverter.RunningData.PvEnergyDay,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyTotal",
      this.inverter.RunningData.EnergyTotal,
      true,
    );
    this.setStateAsync(
      "RunningData.HoursTotal",
      this.inverter.RunningData.HoursTotal,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyDaySell",
      this.inverter.RunningData.EnergyDaySell,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyTotalBuy",
      this.inverter.RunningData.EnergyTotalBuy,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyDayBuy",
      this.inverter.RunningData.EnergyDayBuy,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyTotalLoad",
      this.inverter.RunningData.EnergyTotalLoad,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyDayLoad",
      this.inverter.RunningData.EnergyDayLoad,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyBatteryCharge",
      this.inverter.RunningData.EnergyBatteryCharge,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyDayCharge",
      this.inverter.RunningData.EnergyDayCharge,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyBatteryDischarge",
      this.inverter.RunningData.EnergyBatteryDischarge,
      true,
    );
    this.setStateAsync(
      "RunningData.EnergyDayDischarge",
      this.inverter.RunningData.EnergyDayDischarge,
      true,
    );
    this.setStateAsync(
      "RunningData.BatteryStrings",
      this.inverter.RunningData.BatteryStrings,
      true,
    );
    this.setStateAsync(
      "RunningData.CpldWarningCode",
      this.inverter.RunningData.CpldWarningCode,
      true,
    );
    this.setStateAsync(
      "RunningData.WChargeCtrFlag",
      this.inverter.RunningData.WChargeCtrFlag,
      true,
    );
    //this.setStateAsync("RunningData.DerateFlag", this.inverter.RunningData.DerateFlag, true);
    this.setStateAsync(
      "RunningData.DerateFrozenPower",
      this.inverter.RunningData.DerateFrozenPower,
      true,
    );
    this.setStateAsync(
      "RunningData.DiagStatusH",
      this.inverter.RunningData.DiagStatusH,
      true,
    );
    this.setStateAsync(
      "RunningData.DiagStatusL",
      this.inverter.RunningData.DiagStatusL,
      true,
    );
    this.setStateAsync(
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

    this.setStateAsync(
      "ExtComData.Commode",
      this.inverter.ExtComData.Commode,
      true,
    );
    this.setStateAsync("ExtComData.Rssi", this.inverter.ExtComData.Rssi, true);
    this.setStateAsync(
      "ExtComData.ManufacturerCode",
      this.inverter.ExtComData.ManufacturerCode,
      true,
    );
    this.setStateAsync(
      "ExtComData.MeterConnectStatus",
      this.inverter.ExtComData.MeterConnectStatus,
      true,
    );
    this.setStateAsync(
      "ExtComData.MeterCommunicateStatus",
      this.inverter.ExtComData.MeterCommunicateStatus,
      true,
    );
    this.setStateAsync(
      "ExtComData.L1.ActivePower",
      this.inverter.ExtComData.L1.ActivePower,
      true,
    );
    this.setStateAsync(
      "ExtComData.L1.PowerFactor",
      this.inverter.ExtComData.L1.PowerFactor,
      true,
    );
    this.setStateAsync(
      "ExtComData.L2.ActivePower",
      this.inverter.ExtComData.L2.ActivePower,
      true,
    );
    this.setStateAsync(
      "ExtComData.L2.PowerFactor",
      this.inverter.ExtComData.L2.PowerFactor,
      true,
    );
    this.setStateAsync(
      "ExtComData.L3.ActivePower",
      this.inverter.ExtComData.L3.ActivePower,
      true,
    );
    this.setStateAsync(
      "ExtComData.L3.PowerFactor",
      this.inverter.ExtComData.L3.PowerFactor,
      true,
    );
    this.setStateAsync(
      "ExtComData.TotalActivePower",
      this.inverter.ExtComData.TotalActivePower,
      true,
    );
    this.setStateAsync(
      "ExtComData.TotalReactivePower",
      this.inverter.ExtComData.TotalReactivePower,
      true,
    );
    this.setStateAsync(
      "ExtComData.PowerFactor",
      this.inverter.ExtComData.PowerFactor,
      true,
    );
    this.setStateAsync(
      "ExtComData.Frequency",
      this.inverter.ExtComData.Frequency,
      true,
    );
    this.setStateAsync(
      "ExtComData.EnergyTotalSell",
      this.inverter.ExtComData.EnergyTotalSell,
      true,
    );
    this.setStateAsync(
      "ExtComData.EnergyTotalBuy",
      this.inverter.ExtComData.EnergyTotalBuy,
      true,
    );
  }

  async UpdateBmsInfo() {
    const success = await this.inverter.ReadGroup("bmsInfo");

    if (!success) {
      await this.setStateAsync("info.connection", false, true);
      return;
    }

    await this.UpdateStatesFromRegisterMap(registerGroups.bmsInfo);
    await this.UpdateDecodedBmsStatuses();

    this.setStateAsync("BMSInfo.Status", this.inverter.BmsInfo.Status, true);
    this.setStateAsync(
      "BMSInfo.PackTemperature",
      this.inverter.BmsInfo.PackTemperature,
      true,
    );
    this.setStateAsync(
      "BMSInfo.CurrentMaxCharge",
      this.inverter.BmsInfo.CurrentMaxCharge,
      true,
    );
    this.setStateAsync(
      "BMSInfo.CurrentMaxDischarge",
      this.inverter.BmsInfo.CurrentMaxDischarge,
      true,
    );
    this.setStateAsync(
      "BMSInfo.ErrorCode",
      this.inverter.BmsInfo.ErrorCode,
      true,
    );
    this.setStateAsync("BMSInfo.SOC", this.inverter.BmsInfo.SOC, true);
    this.setStateAsync("BMSInfo.SOH", this.inverter.BmsInfo.SOH, true);
    this.setStateAsync(
      "BMSInfo.BatteryStrings",
      this.inverter.BmsInfo.BatteryStrings,
      true,
    );
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
      tmr_timeout = this.setTimeout(() => this.myTimer(), 1000);
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
