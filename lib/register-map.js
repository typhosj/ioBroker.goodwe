"use strict";

const TYPE = {
  U16: "U16",
  S16: "S16",
  U32: "U32",
  S32: "S32",
  FLOAT: "FLOAT",
  STRING: "STRING",
  BYTE: "BYTE",
};

const registerGroups = {
  deviceInfo: {
    name: "DeviceInfo",
    start: 35000,
    count: 33,
    channel: "DeviceInfo",
    entries: [
      entry(
        35000,
        "DeviceInfo.ModbusProtocolVersion",
        "ModbusProtocolVersion",
        TYPE.U16,
      ),
      entry(35001, "DeviceInfo.RatedPower", "RatedPower", TYPE.U16),
      entry(35002, "DeviceInfo.AcOutputType", "AcOutputType", TYPE.U16),
      entry(35003, "DeviceInfo.SerialNumber", "SerialNumber", TYPE.STRING, {
        registers: 8,
      }),
      entry(35011, "DeviceInfo.DeviceType", "DeviceType", TYPE.STRING, {
        registers: 5,
      }),
      entry(
        35016,
        "DeviceInfo.DSP1_SW_Version",
        "DSP1_SoftwareVersion",
        TYPE.U16,
      ),
      entry(
        35017,
        "DeviceInfo.DSP2_SW_Version",
        "DSP2_SoftwareVersion",
        TYPE.U16,
      ),
      entry(35018, "DeviceInfo.DSP_SVN_Version", "DSP_SVN_Version", TYPE.U16),
      entry(
        35019,
        "DeviceInfo.ARM_SW_Version",
        "ARM_SoftwareVersion",
        TYPE.U16,
      ),
      entry(35020, "DeviceInfo.ARM_SVN_Version", "ARM_SVN_Version", TYPE.U16),
      entry(
        35021,
        "DeviceInfo.DSP_Int_FW_Version",
        "DSP_IntFirmwareVersion",
        TYPE.STRING,
        { registers: 6 },
      ),
      entry(
        35027,
        "DeviceInfo.ARM_Int_FW_Version",
        "ARM_IntFirmwareVersion",
        TYPE.STRING,
        { registers: 6 },
      ),
    ],
  },

  runningData: {
    name: "RunningData",
    start: 35100,
    count: 125,
    channel: "RunningData",
    entries: [
      entry(35103, "RunningData.PV1.Voltage", "Pv1.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35104, "RunningData.PV1.Current", "Pv1.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(35105, "RunningData.PV1.Power", "Pv1.Power", TYPE.U32, {
        unit: "W",
      }),
      entry(35107, "RunningData.PV2.Voltage", "Pv2.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35108, "RunningData.PV2.Current", "Pv2.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(35109, "RunningData.PV2.Power", "Pv2.Power", TYPE.U32, {
        unit: "W",
      }),
      entry(35111, "RunningData.PV3.Voltage", "Pv3.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35112, "RunningData.PV3.Current", "Pv3.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(35113, "RunningData.PV3.Power", "Pv3.Power", TYPE.U32, {
        unit: "W",
      }),
      entry(35115, "RunningData.PV4.Voltage", "Pv4.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35116, "RunningData.PV4.Current", "Pv4.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(35117, "RunningData.PV4.Power", "Pv4.Power", TYPE.U32, {
        unit: "W",
      }),
      entry(35119, "RunningData.PV4.Mode", "Pv4.Mode", TYPE.BYTE, {
        byteOffset: 0,
      }),
      entry(35119, "RunningData.PV3.Mode", "Pv3.Mode", TYPE.BYTE, {
        byteOffset: 1,
      }),
      entry(35119, "RunningData.PV2.Mode", "Pv2.Mode", TYPE.BYTE, {
        byteOffset: 2,
      }),
      entry(35119, "RunningData.PV1.Mode", "Pv1.Mode", TYPE.BYTE, {
        byteOffset: 3,
      }),
      entry(35121, "RunningData.GridL1.Voltage", "GridL1.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35122, "RunningData.GridL1.Current", "GridL1.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(
        35123,
        "RunningData.GridL1.Frequency",
        "GridL1.Frequency",
        TYPE.U16,
        { scale: 100, unit: "Hz" },
      ),
      entry(35125, "RunningData.GridL1.Power", "GridL1.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(35126, "RunningData.GridL2.Voltage", "GridL2.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35127, "RunningData.GridL2.Current", "GridL2.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(
        35128,
        "RunningData.GridL2.Frequency",
        "GridL2.Frequency",
        TYPE.U16,
        { scale: 100, unit: "Hz" },
      ),
      entry(35130, "RunningData.GridL2.Power", "GridL2.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(35131, "RunningData.GridL3.Voltage", "GridL3.Voltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35132, "RunningData.GridL3.Current", "GridL3.Current", TYPE.U16, {
        scale: 10,
        unit: "A",
      }),
      entry(
        35133,
        "RunningData.GridL3.Frequency",
        "GridL3.Frequency",
        TYPE.U16,
        { scale: 100, unit: "Hz" },
      ),
      entry(35135, "RunningData.GridL3.Power", "GridL3.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(35136, "RunningData.GridMode", "GridMode", TYPE.U16),
      entry(
        35138,
        "RunningData.InverterTotalPower",
        "InverterTotalPower",
        TYPE.S16,
        { unit: "W" },
      ),
      entry(35140, "RunningData.AcActivePower", "AcActivePower", TYPE.S16, {
        unit: "W",
      }),
      entry(35142, "RunningData.AcReactivePower", "AcReactivePower", TYPE.S16, {
        unit: "var",
      }),
      entry(35144, "RunningData.AcApparentPower", "AcApparentPower", TYPE.S16, {
        unit: "VA",
      }),
      entry(
        35145,
        "RunningData.BackUpL1.Voltage",
        "BackUpL1.Voltage",
        TYPE.U16,
        { scale: 10, unit: "V" },
      ),
      entry(
        35146,
        "RunningData.BackUpL1.Current",
        "BackUpL1.Current",
        TYPE.U16,
        { scale: 10, unit: "A" },
      ),
      entry(
        35147,
        "RunningData.BackUpL1.Frequency",
        "BackUpL1.Frequency",
        TYPE.U16,
        { scale: 100, unit: "Hz" },
      ),
      entry(35148, "RunningData.BackUpL1.Mode", "BackUpL1.Mode", TYPE.U16),
      entry(35150, "RunningData.BackUpL1.Power", "BackUpL1.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(
        35151,
        "RunningData.BackUpL2.Voltage",
        "BackUpL2.Voltage",
        TYPE.U16,
        { scale: 10, unit: "V" },
      ),
      entry(
        35152,
        "RunningData.BackUpL2.Current",
        "BackUpL2.Current",
        TYPE.U16,
        { scale: 10, unit: "A" },
      ),
      entry(
        35153,
        "RunningData.BackUpL2.Frequency",
        "BackUpL2.Frequency",
        TYPE.U16,
        { scale: 100, unit: "Hz" },
      ),
      entry(35154, "RunningData.BackUpL2.Mode", "BackUpL2.Mode", TYPE.U16),
      entry(35156, "RunningData.BackUpL2.Power", "BackUpL2.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(
        35157,
        "RunningData.BackUpL3.Voltage",
        "BackUpL3.Voltage",
        TYPE.U16,
        { scale: 10, unit: "V" },
      ),
      entry(
        35158,
        "RunningData.BackUpL3.Current",
        "BackUpL3.Current",
        TYPE.U16,
        { scale: 10, unit: "A" },
      ),
      entry(
        35159,
        "RunningData.BackUpL3.Frequency",
        "BackUpL3.Frequency",
        TYPE.U16,
        { scale: 100, unit: "Hz" },
      ),
      entry(35160, "RunningData.BackUpL3.Mode", "BackUpL3.Mode", TYPE.U16),
      entry(35162, "RunningData.BackUpL3.Power", "BackUpL3.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(35164, "RunningData.PowerL1", "PowerL1", TYPE.S16, { unit: "W" }),
      entry(35166, "RunningData.PowerL2", "PowerL2", TYPE.S16, { unit: "W" }),
      entry(35168, "RunningData.PowerL3", "PowerL3", TYPE.S16, { unit: "W" }),
      entry(
        35170,
        "RunningData.TotalPowerBackUp",
        "TotalPowerBackUp",
        TYPE.S16,
        { unit: "W" },
      ),
      entry(35172, "RunningData.TotalPower", "TotalPower", TYPE.S16, {
        unit: "W",
      }),
      entry(35173, "RunningData.UpsLoadPercent", "UpsLoadPercent", TYPE.U16, {
        scale: 100,
        unit: "%",
      }),
      entry(35174, "RunningData.AirTemperature", "AirTemperature", TYPE.S16, {
        scale: 10,
        unit: "C",
      }),
      entry(
        35175,
        "RunningData.ModuleTemperature",
        "ModuleTemperature",
        TYPE.S16,
        { scale: 10, unit: "C" },
      ),
      entry(
        35176,
        "RunningData.RadiatorTemperature",
        "RadiatorTemperature",
        TYPE.S16,
        { scale: 10, unit: "C" },
      ),
      entry(
        35177,
        "RunningData.FunctionBitValue",
        "FunctionBitValue",
        TYPE.U16,
      ),
      entry(35178, "RunningData.BusVoltage", "BusVoltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(35179, "RunningData.NbusVoltage", "NbusVoltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(
        35180,
        "RunningData.Battery1.Voltage",
        "Battery1.Voltage",
        TYPE.U16,
        { scale: 10, unit: "V" },
      ),
      entry(
        35181,
        "RunningData.Battery1.Current",
        "Battery1.Current",
        TYPE.S16,
        { scale: 10, unit: "A" },
      ),
      entry(35183, "RunningData.Battery1.Power", "Battery1.Power", TYPE.S16, {
        unit: "W",
      }),
      entry(35184, "RunningData.Battery1.Mode", "Battery1.Mode", TYPE.U16),
      entry(35185, "RunningData.WarningCode", "WarningCode", TYPE.U16),
      entry(35186, "RunningData.SafetyCountry", "SafetyCountry", TYPE.U16),
      entry(35187, "RunningData.WorkMode", "WorkMode", TYPE.U16),
      entry(35188, "RunningData.OperationMode", "OperationMode", TYPE.U16),
      entry(35189, "RunningData.ErrorMessage", "ErrorMessage", TYPE.U32),
      entry(35191, "RunningData.PvEnergyTotal", "PvEnergyTotal", TYPE.U32, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35193, "RunningData.PvEnergyDay", "PvEnergyDay", TYPE.U32, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35195, "RunningData.EnergyTotal", "EnergyTotal", TYPE.U32, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35197, "RunningData.HoursTotal", "HoursTotal", TYPE.U32, {
        unit: "h",
      }),
      entry(35199, "RunningData.EnergyDaySell", "EnergyDaySell", TYPE.U16, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35200, "RunningData.EnergyTotalBuy", "EnergyTotalBuy", TYPE.U32, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35202, "RunningData.EnergyDayBuy", "EnergyDayBuy", TYPE.U16, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35203, "RunningData.EnergyTotalLoad", "EnergyTotalLoad", TYPE.U32, {
        scale: 10,
        unit: "kWh",
      }),
      entry(35205, "RunningData.EnergyDayLoad", "EnergyDayLoad", TYPE.U16, {
        scale: 10,
        unit: "kWh",
      }),
      entry(
        35206,
        "RunningData.EnergyBatteryCharge",
        "EnergyBatteryCharge",
        TYPE.U32,
        { scale: 10, unit: "kWh" },
      ),
      entry(35208, "RunningData.EnergyDayCharge", "EnergyDayCharge", TYPE.U16, {
        scale: 10,
        unit: "kWh",
      }),
      entry(
        35209,
        "RunningData.EnergyBatteryDischarge",
        "EnergyBatteryDischarge",
        TYPE.U32,
        { scale: 10, unit: "kWh" },
      ),
      entry(
        35211,
        "RunningData.EnergyDayDischarge",
        "EnergyDayDischarge",
        TYPE.U16,
        { scale: 10, unit: "kWh" },
      ),
      entry(35212, "RunningData.BatteryStrings", "BatteryStrings", TYPE.U16),
      entry(35213, "RunningData.CpldWarningCode", "CpldWarningCode", TYPE.U16),
      entry(35214, "RunningData.WChargeCtrFlag", "WChargeCtrFlag", TYPE.U16),
      entry(35215, "RunningData.DerateFlag", "DerateFlag", TYPE.U16),
      entry(
        35216,
        "RunningData.DerateFrozenPower",
        "DerateFrozenPower",
        TYPE.S32,
        { unit: "W" },
      ),
      entry(35218, "RunningData.DiagStatusH", "DiagStatusH", TYPE.U32),
      entry(35220, "RunningData.DiagStatusL", "DiagStatusL", TYPE.U32),
    ],
  },

  extComData: {
    name: "ExtComData",
    start: 36000,
    count: 27,
    channel: "ExtComData",
    entries: [
      entry(36000, "ExtComData.Commode", "Commode", TYPE.U16),
      entry(36001, "ExtComData.Rssi", "Rssi", TYPE.U16),
      entry(36002, "ExtComData.ManufacturerCode", "ManufacturerCode", TYPE.U16),
      entry(
        36003,
        "ExtComData.MeterConnectStatus",
        "MeterConnectStatus",
        TYPE.U16,
      ),
      entry(
        36004,
        "ExtComData.MeterCommunicateStatus",
        "MeterCommunicateStatus",
        TYPE.U16,
      ),
      entry(36005, "ExtComData.L1.ActivePower", "L1.ActivePower", TYPE.S16, {
        unit: "W",
      }),
      entry(36006, "ExtComData.L2.ActivePower", "L2.ActivePower", TYPE.S16, {
        unit: "W",
      }),
      entry(36007, "ExtComData.L3.ActivePower", "L3.ActivePower", TYPE.S16, {
        unit: "W",
      }),
      entry(
        36008,
        "ExtComData.TotalActivePower",
        "TotalActivePower",
        TYPE.S16,
        { unit: "W" },
      ),
      entry(
        36009,
        "ExtComData.TotalReactivePower",
        "TotalReactivePower",
        TYPE.U16,
        { unit: "var" },
      ),
      entry(36010, "ExtComData.L1.PowerFactor", "L1.PowerFactor", TYPE.U16, {
        scale: 100,
      }),
      entry(36011, "ExtComData.L2.PowerFactor", "L2.PowerFactor", TYPE.U16, {
        scale: 100,
      }),
      entry(36012, "ExtComData.L3.PowerFactor", "L3.PowerFactor", TYPE.U16, {
        scale: 100,
      }),
      entry(36013, "ExtComData.PowerFactor", "PowerFactor", TYPE.U16, {
        scale: 100,
      }),
      entry(36014, "ExtComData.Frequency", "Frequency", TYPE.U16, {
        scale: 100,
        unit: "Hz",
      }),
      entry(
        36015,
        "ExtComData.EnergyTotalSell",
        "EnergyTotalSell",
        TYPE.FLOAT,
        { scale: 10, unit: "kWh" },
      ),
      entry(36017, "ExtComData.EnergyTotalBuy", "EnergyTotalBuy", TYPE.FLOAT, {
        scale: 10,
        unit: "kWh",
      }),
    ],
  },

  bmsInfo: {
    name: "BMSInfo",
    start: 37002,
    count: 8,
    channel: "BMSInfo",
    entries: [
      entry(37002, "BMSInfo.Status", "Status", TYPE.U16),
      entry(37003, "BMSInfo.PackTemperature", "PackTemperature", TYPE.U16, {
        scale: 10,
        unit: "C",
      }),
      entry(37004, "BMSInfo.CurrentMaxCharge", "CurrentMaxCharge", TYPE.U16, {
        unit: "A",
      }),
      entry(
        37005,
        "BMSInfo.CurrentMaxDischarge",
        "CurrentMaxDischarge",
        TYPE.U16,
        { unit: "A" },
      ),
      entry(37006, "BMSInfo.ErrorCode", "ErrorCode", TYPE.U16),
      entry(37007, "BMSInfo.SOC", "SOC", TYPE.U16, { unit: "%" }),
      entry(37008, "BMSInfo.SOH", "SOH", TYPE.U16, {
        unit: "%",
        role: "value",
      }),
      entry(37009, "BMSInfo.BatteryStrings", "BatteryStrings", TYPE.U16),
    ],
  },

  deviceSimccid: {
    name: "DeviceInfo.SIMCCID",
    start: 35050,
    count: 10,
    channel: "DeviceInfo",
    entries: [
      entry(35050, "DeviceInfo.SIMCCID", "SIMCCID", TYPE.STRING, {
        registers: 10,
      }),
    ],
  },

  extComDataExtended: {
    name: "ExtComData.Extended",
    start: 36019,
    count: 26,
    channel: "ExtComData.Extended",
    entries: [
      entry(
        36019,
        "ExtComData.Extended.L1.ActivePower",
        "Extended.L1.ActivePower",
        TYPE.S32,
        { unit: "W" },
      ),
      entry(
        36021,
        "ExtComData.Extended.L2.ActivePower",
        "Extended.L2.ActivePower",
        TYPE.S32,
        { unit: "W" },
      ),
      entry(
        36023,
        "ExtComData.Extended.L3.ActivePower",
        "Extended.L3.ActivePower",
        TYPE.S32,
        { unit: "W" },
      ),
      entry(
        36025,
        "ExtComData.Extended.TotalActivePower",
        "Extended.TotalActivePower",
        TYPE.S32,
        { unit: "W" },
      ),
      entry(
        36027,
        "ExtComData.Extended.L1.ReactivePower",
        "Extended.L1.ReactivePower",
        TYPE.S32,
        { unit: "var" },
      ),
      entry(
        36029,
        "ExtComData.Extended.L2.ReactivePower",
        "Extended.L2.ReactivePower",
        TYPE.S32,
        { unit: "var" },
      ),
      entry(
        36031,
        "ExtComData.Extended.L3.ReactivePower",
        "Extended.L3.ReactivePower",
        TYPE.S32,
        { unit: "var" },
      ),
      entry(
        36033,
        "ExtComData.Extended.TotalReactivePower",
        "Extended.TotalReactivePower",
        TYPE.S32,
        { unit: "var" },
      ),
      entry(
        36035,
        "ExtComData.Extended.L1.ApparentPower",
        "Extended.L1.ApparentPower",
        TYPE.S32,
        { unit: "VA" },
      ),
      entry(
        36037,
        "ExtComData.Extended.L2.ApparentPower",
        "Extended.L2.ApparentPower",
        TYPE.S32,
        { unit: "VA" },
      ),
      entry(
        36039,
        "ExtComData.Extended.L3.ApparentPower",
        "Extended.L3.ApparentPower",
        TYPE.S32,
        { unit: "VA" },
      ),
      entry(
        36041,
        "ExtComData.Extended.TotalApparentPower",
        "Extended.TotalApparentPower",
        TYPE.S32,
        { unit: "VA" },
      ),
      entry(
        36043,
        "ExtComData.Extended.MeterType",
        "Extended.MeterType",
        TYPE.U16,
      ),
      entry(
        36044,
        "ExtComData.Extended.MeterSoftwareVersion",
        "Extended.MeterSoftwareVersion",
        TYPE.U16,
      ),
    ],
  },

  flashInfo: {
    name: "FlashInfo",
    start: 36900,
    count: 14,
    channel: "FlashInfo",
    entries: [
      entry(36900, "FlashInfo.FlashPgmParaVer", "FlashPgmParaVer", TYPE.U16),
      entry(
        36901,
        "FlashInfo.FlashPgmWriteCount",
        "FlashPgmWriteCount",
        TYPE.U32,
      ),
      entry(36903, "FlashInfo.FlashSysParaVer", "FlashSysParaVer", TYPE.U16),
      entry(
        36904,
        "FlashInfo.FlashSysWriteCount",
        "FlashSysWriteCount",
        TYPE.U32,
      ),
      entry(36906, "FlashInfo.FlashBatParaVer", "FlashBatParaVer", TYPE.U16),
      entry(
        36907,
        "FlashInfo.FlashBatWriteCount",
        "FlashBatWriteCount",
        TYPE.U32,
      ),
      entry(36909, "FlashInfo.FlashEepromVer", "FlashEepromVer", TYPE.U16),
      entry(
        36910,
        "FlashInfo.FlashEepromWriteCount",
        "FlashEepromWriteCount",
        TYPE.U32,
      ),
      entry(
        36912,
        "FlashInfo.WiFiDataSendCount",
        "WiFiDataSendCount",
        TYPE.U16,
      ),
      entry(36913, "FlashInfo.WifiUpDataDebug", "WifiUpDataDebug", TYPE.U16),
    ],
  },

  bmsInfoExtended: {
    name: "BMSInfo.Extended",
    start: 37000,
    count: 56,
    channel: "BMSInfo",
    entries: [
      entry(37000, "BMSInfo.DRMStatus", "DRMStatus", TYPE.U16),
      entry(37001, "BMSInfo.BattTypeIndex", "BattTypeIndex", TYPE.U16),
      entry(37010, "BMSInfo.WarningCodeL", "WarningCodeL", TYPE.U16),
      entry(37011, "BMSInfo.BatteryProtocol", "BatteryProtocol", TYPE.U16),
      entry(37012, "BMSInfo.ErrorCodeH", "ErrorCodeH", TYPE.U16),
      entry(37013, "BMSInfo.WarningCodeH", "WarningCodeH", TYPE.U16),
      entry(37014, "BMSInfo.SoftwareVersion", "SoftwareVersion", TYPE.U16),
      entry(37015, "BMSInfo.HardwareVersion", "HardwareVersion", TYPE.U16),
      entry(
        37016,
        "BMSInfo.MaximumCellTemperatureID",
        "MaximumCellTemperatureID",
        TYPE.U16,
      ),
      entry(
        37017,
        "BMSInfo.MinimumCellTemperatureID",
        "MinimumCellTemperatureID",
        TYPE.U16,
      ),
      entry(
        37018,
        "BMSInfo.MaximumCellVoltageID",
        "MaximumCellVoltageID",
        TYPE.U16,
      ),
      entry(
        37019,
        "BMSInfo.MinimumCellVoltageID",
        "MinimumCellVoltageID",
        TYPE.U16,
      ),
      entry(
        37020,
        "BMSInfo.MaximumCellTemperature",
        "MaximumCellTemperature",
        TYPE.U16,
        { scale: 10, unit: "C" },
      ),
      entry(
        37021,
        "BMSInfo.MinimumCellTemperature",
        "MinimumCellTemperature",
        TYPE.U16,
        { scale: 10, unit: "C" },
      ),
      entry(
        37022,
        "BMSInfo.MaximumCellVoltage",
        "MaximumCellVoltage",
        TYPE.U16,
        { unit: "mV" },
      ),
      entry(
        37023,
        "BMSInfo.MinimumCellVoltage",
        "MinimumCellVoltage",
        TYPE.U16,
        { unit: "mV" },
      ),
      ...range(1, 32).map((number) =>
        entry(
          37023 + number,
          `BMSInfo.PassInformation${number}`,
          `PassInformation${number}`,
          TYPE.U16,
        ),
      ),
    ],
  },

  bmsDetail: {
    name: "BMSDetail",
    start: 37100,
    count: 51,
    channel: "BMSDetail",
    entries: [
      entry(37100, "BMSDetail.Flag", "Flag", TYPE.U16),
      entry(37101, "BMSDetail.WorkMode", "WorkMode", TYPE.U16),
      entry(37102, "BMSDetail.AllowChargePower", "AllowChargePower", TYPE.U32, {
        unit: "W",
      }),
      entry(
        37104,
        "BMSDetail.AllowDischargePower",
        "AllowDischargePower",
        TYPE.U32,
        { unit: "W" },
      ),
      entry(37106, "BMSDetail.RelayStatus", "RelayStatus", TYPE.U16),
      entry(
        37107,
        "BMSDetail.BatteryModuleNumber",
        "BatteryModuleNumber",
        TYPE.U16,
      ),
      entry(
        37108,
        "BMSDetail.ShutdownFaultCode",
        "ShutdownFaultCode",
        TYPE.U16,
      ),
      entry(
        37109,
        "BMSDetail.BatteryReadyEnable",
        "BatteryReadyEnable",
        TYPE.U16,
      ),
      entry(
        37110,
        "BMSDetail.AlarmUnderTemperatureID",
        "AlarmUnderTemperatureID",
        TYPE.U16,
      ),
      entry(
        37111,
        "BMSDetail.AlarmOverTemperatureID",
        "AlarmOverTemperatureID",
        TYPE.U16,
      ),
      entry(
        37112,
        "BMSDetail.AlarmDifferTemperatureID",
        "AlarmDifferTemperatureID",
        TYPE.U16,
      ),
      entry(
        37113,
        "BMSDetail.AlarmChargeCurrentID",
        "AlarmChargeCurrentID",
        TYPE.U16,
      ),
      entry(
        37114,
        "BMSDetail.AlarmDischargeCurrentID",
        "AlarmDischargeCurrentID",
        TYPE.U16,
      ),
      entry(
        37115,
        "BMSDetail.AlarmCellOverVoltageID",
        "AlarmCellOverVoltageID",
        TYPE.U16,
      ),
      entry(
        37116,
        "BMSDetail.AlarmCellUnderVoltageID",
        "AlarmCellUnderVoltageID",
        TYPE.U16,
      ),
      entry(37117, "BMSDetail.AlarmSOCLowerID", "AlarmSOCLowerID", TYPE.U16),
      entry(
        37118,
        "BMSDetail.AlarmCellVoltageDifferID",
        "AlarmCellVoltageDifferID",
        TYPE.U16,
      ),
      ...range(1, 8).map((number) =>
        entry(
          37118 + number,
          `BMSDetail.Battery${number}.Current`,
          `Battery${number}.Current`,
          TYPE.S16,
          {
            scale: 10,
            unit: "A",
          },
        ),
      ),
      ...range(1, 8).map((number) =>
        entry(
          37126 + number,
          `BMSDetail.Battery${number}.SOC`,
          `Battery${number}.SOC`,
          TYPE.U16,
          {
            unit: "%",
            role: "value.battery",
          },
        ),
      ),
      ...range(1, 8).map((number) =>
        entry(
          37133 + number * 2,
          `BMSDetail.Battery${number}.SN`,
          `Battery${number}.SN`,
          TYPE.U32,
        ),
      ),
    ],
  },

  ceiAutoTest: {
    name: "CEIAutoTest",
    start: 38000,
    count: 68,
    channel: "CEIAutoTest",
    entries: [
      entry(38000, "CEIAutoTest.WorkMode", "WorkMode", TYPE.U16),
      entry(38001, "CEIAutoTest.ErrorMessageH", "ErrorMessageH", TYPE.U16),
      entry(38002, "CEIAutoTest.ErrorMessageL", "ErrorMessageL", TYPE.U16),
      entry(38003, "CEIAutoTest.SimVoltage", "SimVoltage", TYPE.U16, {
        scale: 10,
        unit: "V",
      }),
      entry(38004, "CEIAutoTest.SimFrequency", "SimFrequency", TYPE.U16, {
        scale: 100,
        unit: "Hz",
      }),
      entry(38005, "CEIAutoTest.TestResult", "TestResult", TYPE.U16),
      ...ceiLineEntries(1, 38008),
      ...ceiLineEntries(2, 38028),
      ...ceiLineEntries(3, 38048),
    ],
  },

  powerLimit: {
    name: "PowerLimit",
    start: 38450,
    count: 14,
    channel: "PowerLimit",
    entries: [
      entry(
        38450,
        "PowerLimit.FeedPowerLimitCoefficient",
        "FeedPowerLimitCoefficient",
        TYPE.U16,
      ),
      entry(38451, "PowerLimit.L1PowerLimit", "L1PowerLimit", TYPE.U16, {
        unit: "W",
      }),
      entry(38452, "PowerLimit.L2PowerLimit", "L2PowerLimit", TYPE.U16, {
        unit: "W",
      }),
      entry(38453, "PowerLimit.L3PowerLimit", "L3PowerLimit", TYPE.U16, {
        unit: "W",
      }),
      entry(
        38454,
        "PowerLimit.InverterPowerFactor",
        "InverterPowerFactor",
        TYPE.S16,
        { scale: 1000 },
      ),
      entry(38455, "PowerLimit.PVMeterDCPower", "PVMeterDCPower", TYPE.S32, {
        unit: "W",
      }),
      entry(
        38457,
        "PowerLimit.EtotalGridCharge",
        "EtotalGridCharge",
        TYPE.U32,
        { scale: 10, unit: "kWh" },
      ),
      entry(38459, "PowerLimit.DispatchSwitch", "DispatchSwitch", TYPE.U16),
      entry(38460, "PowerLimit.DispatchPower", "DispatchPower", TYPE.S32, {
        unit: "W",
      }),
      entry(38462, "PowerLimit.DispatchSoc", "DispatchSoc", TYPE.U16, {
        unit: "%",
        role: "value.battery",
      }),
      entry(38463, "PowerLimit.DispatchMode", "DispatchMode", TYPE.U16),
    ],
  },
};

const optionalGroupConfigs = {
  deviceSimccid: "pollSimccid",
  extComDataExtended: "pollExtendedMeter",
  flashInfo: "pollFlashInfo",
  bmsInfoExtended: "pollBmsExtended",
  bmsDetail: "pollBmsDetail",
  ceiAutoTest: "pollCeiAutoTest",
  powerLimit: "pollPowerLimit",
};

function entry(address, state, model, type, options = {}) {
  return {
    address,
    state,
    model,
    type,
    registers: options.registers ?? typeRegisterCount(type),
    scale: options.scale ?? 1,
    unit: options.unit,
    role: options.role ?? roleForUnit(options.unit),
    byteOffset: options.byteOffset ?? 0,
  };
}

function typeRegisterCount(type) {
  switch (type) {
    case TYPE.U32:
    case TYPE.S32:
    case TYPE.FLOAT:
    case TYPE.BYTE:
      return 2;
    default:
      return 1;
  }
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function ceiLineEntries(line, start) {
  const prefix = `CEIAutoTest.Line${line}`;
  const model = `Line${line}`;

  return [
    entry(start, `${prefix}.Voltage`, `${model}.Voltage`, TYPE.U16, {
      scale: 10,
      unit: "V",
    }),
    entry(start + 1, `${prefix}.Frequency`, `${model}.Frequency`, TYPE.U16, {
      scale: 100,
      unit: "Hz",
    }),
    entry(start + 2, `${prefix}.Power`, `${model}.Power`, TYPE.U32, {
      unit: "W",
    }),
    entry(
      start + 4,
      `${prefix}.AvgFaultValue`,
      `${model}.AvgFaultValue`,
      TYPE.U16,
      {
        scale: 10,
        unit: "V",
      },
    ),
    entry(
      start + 5,
      `${prefix}.AvgFaultTime`,
      `${model}.AvgFaultTime`,
      TYPE.U16,
      {
        unit: "s",
      },
    ),
    entry(
      start + 6,
      `${prefix}.VHighFaultValue`,
      `${model}.VHighFaultValue`,
      TYPE.U16,
      {
        scale: 10,
        unit: "V",
      },
    ),
    entry(
      start + 7,
      `${prefix}.VHighFaultTime`,
      `${model}.VHighFaultTime`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
    entry(
      start + 8,
      `${prefix}.VLowFaultValueS1`,
      `${model}.VLowFaultValueS1`,
      TYPE.U16,
      {
        scale: 10,
        unit: "V",
      },
    ),
    entry(
      start + 9,
      `${prefix}.VLowFaultTimeS1`,
      `${model}.VLowFaultTimeS1`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
    entry(
      start + 10,
      `${prefix}.VLowFaultValueS2`,
      `${model}.VLowFaultValueS2`,
      TYPE.U16,
      {
        scale: 10,
        unit: "V",
      },
    ),
    entry(
      start + 11,
      `${prefix}.VLowFaultTimeS2`,
      `${model}.VLowFaultTimeS2`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
    entry(
      start + 12,
      `${prefix}.FHighFaultValueCom`,
      `${model}.FHighFaultValueCom`,
      TYPE.U16,
      {
        scale: 100,
        unit: "Hz",
      },
    ),
    entry(
      start + 13,
      `${prefix}.FHighFaultTimeCom`,
      `${model}.FHighFaultTimeCom`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
    entry(
      start + 14,
      `${prefix}.FLowFaultValueCom`,
      `${model}.FLowFaultValueCom`,
      TYPE.U16,
      {
        scale: 100,
        unit: "Hz",
      },
    ),
    entry(
      start + 15,
      `${prefix}.FLowFaultTimeCom`,
      `${model}.FLowFaultTimeCom`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
    entry(
      start + 16,
      `${prefix}.FHighFaultValue`,
      `${model}.FHighFaultValue`,
      TYPE.U16,
      {
        scale: 100,
        unit: "Hz",
      },
    ),
    entry(
      start + 17,
      `${prefix}.FHighFaultTime`,
      `${model}.FHighFaultTime`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
    entry(
      start + 18,
      `${prefix}.FLowFaultValue`,
      `${model}.FLowFaultValue`,
      TYPE.U16,
      {
        scale: 100,
        unit: "Hz",
      },
    ),
    entry(
      start + 19,
      `${prefix}.FLowFaultTime`,
      `${model}.FLowFaultTime`,
      TYPE.U16,
      {
        unit: "ms",
      },
    ),
  ];
}

function roleForUnit(unit) {
  switch (unit) {
    case "W":
    case "var":
    case "VA":
      return "value.power";
    case "V":
      return "value.voltage";
    case "A":
      return "value.current";
    case "Hz":
      return "value.frequency";
    case "kWh":
      return "value.energy";
    case "C":
      return "value.temperature";
    case "mV":
      return "value.voltage";
    case "h":
    case "s":
    case "ms":
      return "value.interval";
    case "%":
      return "value";
    default:
      return "value";
  }
}

module.exports = {
  optionalGroupConfigs,
  TYPE,
  registerGroups,
};
