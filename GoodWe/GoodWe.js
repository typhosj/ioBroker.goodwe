const dgram = require("dgram");
const { registerGroups, TYPE } = require("../lib/register-map");

class GoodWePacket {
  static Format = { Packet: 7, Checksum: 2 };
  static Header = { High: 0xaa, Low: 0x55 };
  static Addr = { AP: 0xc0, Inverter: 0x7f };
  static CtrCode = { Register: 0x00, Read: 0x01, Execute: 0x03 };
  static FcCodeRegister = {
    Offline: 0x00,
    RegisterRequest: 0x80,
    AllocateRegisterAddr: 0x01,
    AddressConfirm: 0x81,
    RemoveRegister: 0x02,
    RemoveConfirm: 0x82,
  };
  static FcCodeRead = {
    QueryRunningInfo: 0x01,
    ResponseRunningInfo: 0x81,
    QueryIdInfo: 0x02,
    ResponseIdInfo: 0x82,
    QuerySettingInfo: 0x03,
    ResponseSettingInfo: 0x83,
  };
}

class GoodWeRegister {
  static Format = { Frame: 5, CRC16: 2 };
  static RecvHeader = { High: 0xaa, Low: 0x55 };
  static Addr = { Inverter: 0xf7 };
  static FcDode = {
    Read: 0x03,
    ReadSingleRegister: 0x06,
    WriteMultipleRegister: 0x09,
  };
}

class GoodWeIdInfo {
  FirmwareVersion = "";
  ModelName = "";
  Na = new Uint8Array(16);
  SerialNumber = "";
  NomVpv = 0.0;
  InternalVersion = "";
  SafetyCountryCode = 0x00;
}

class GoodWeDeviceInfo {
  ModbusProtocolVersion = 0;
  RatedPower = 0;
  AcOutputType = 0;
  SerialNumber = "";
  DeviceType = "";
  DSP1_SoftwareVersion = 0;
  DSP2_SoftwareVersion = 0;
  DSP_SVN_Version = 0;
  ARM_SoftwareVersion = 0;
  ARM_SVN_Version = 0;
  DSP_IntFirmwareVersion = "";
  ARM_IntFirmwareVersion = "";
  SIMCCID = "";
}

class DcParameters {
  Voltage = 0.0;
  Current = 0.0;
  Power = 0.0;
  Mode = 0;
}

class AcPhase {
  Voltage = 0.0;
  Current = 0.0;
  Frequency = 0.0;
  Power = 0.0;
}

class ACPhaseBackup {
  Voltage = 0.0;
  Current = 0.0;
  Frequency = 0.0;
  Power = 0.0;
  Mode = 0;
}

class GoodWeRunningData {
  Rtc = new Date();
  Pv1 = new DcParameters();
  Pv2 = new DcParameters();
  Pv3 = new DcParameters();
  Pv4 = new DcParameters();
  GridL1 = new AcPhase();
  GridL2 = new AcPhase();
  GridL3 = new AcPhase();
  GridMode = 0;
  InverterTotalPower = 0;
  AcActivePower = 0;
  AcReactivePower = 0;
  AcApparentPower = 0;
  BackUpL1 = new ACPhaseBackup();
  BackUpL2 = new ACPhaseBackup();
  BackUpL3 = new ACPhaseBackup();
  PowerL1 = 0;
  PowerL2 = 0;
  PowerL3 = 0;
  TotalPowerBackUp = 0;
  TotalPower = 0;
  UpsLoadPercent = 0;
  AirTemperature = 0.0;
  ModulTemperature = 0.0;
  RadiatorTemperature = 0.0;
  FunctionBitValue = 0;
  BusVoltage = 0.0;
  NbusVoltage = 0.0;
  Battery1 = new DcParameters();
  WarningCode = 0;
  SaftyCountry = 0;
  WorkMode = 0;
  OperationMode = 0;
  ErrorMessage = 0;
  PvEnergyTotal = 0.0;
  PvEnergyDay = 0.0;
  EnergyTotal = 0.0;
  HoursTotal = 0.0;
  EnergyDaySell = 0.0;
  EnergyTotalBuy = 0.0;
  EnergyDayBuy = 0.0;
  EnergyTotalLoad = 0.0;
  EnergyDayLoad = 0.0;
  EnergyBatteryCharge = 0.0;
  EnergyDayCharge = 0.0;
  EnergyBatteryDischarge = 0.0;
  EnergyDayDischarge = 0.0;
  BatteryStrings = 0;
  CpldWarningCode = 0;
  WChargeCtrFlag = 0;
  DerateFlag = 0;
  DerateFrozenPower = 0;
  DiagStatusH = 0;
  DiagStatusL = 0;
  TotalPowerPv = 0;
}

class GoodWeMeterPhase {
  ActivePower = 0;
  PowerFactor = 0.0;
}

class GoodWeExternalComData {
  Commode = 0;
  Rssi = 0;
  ManufacturerCode = 0;
  MeterConnectStatus = 0;
  MeterCommunicateStatus = 0;
  L1 = new GoodWeMeterPhase();
  L2 = new GoodWeMeterPhase();
  L3 = new GoodWeMeterPhase();
  TotalActivePower = 0;
  TotalReactivePower = 0;
  PowerFactor = 0.0;
  Frequency = 0.0;
  EnergyTotalSell = 0.0;
  EnergyTotalBuy = 0.0;
}

class GoodweBmSInfo {
  DRMStatus = 0;
  BattTypeIndex = 0;
  Status = 0;
  PackTemperature = 0.0;
  CurrentMaxCharge = 0;
  CurrentMaxDischarge = 0;
  ErrorCode = 0;
  SOC = 0;
  SOH = 0;
  BatteryStrings = 0;
  WarningCodeL = 0;
  BatteryProtocol = 0;
  ErrorCodeH = 0;
  WarningCodeH = 0;
  SoftwareVersion = 0;
  HardwareVersion = 0;
  MaximumCellTemperatureID = 0;
  MinimumCellTemperatureID = 0;
  MaximumCellVoltageID = 0;
  MinimumCellVoltageID = 0;
  MaximumCellTemperature = 0;
  MinimumCellTemperature = 0;
  MaximumCellVoltage = 0;
  MinimumCellVoltage = 0;
}

class GoodWeUdp {
  static ConStatus = { Offline: false, Online: true };
  static DefaultTimeoutMs = 5000;
  static DefaultRetries = 1;

  #status = GoodWeUdp.ConStatus.Offline;
  #ipAddr = "";
  #port = 0;
  #client = dgram.createSocket("udp4");
  #pendingRequests = [];
  #timeoutMs = GoodWeUdp.DefaultTimeoutMs;
  #retries = GoodWeUdp.DefaultRetries;
  #idInfo = new GoodWeIdInfo();
  #deviceInfo = new GoodWeDeviceInfo();
  #runningData = new GoodWeRunningData();
  #extComData = new GoodWeExternalComData();
  #bmsInfo = new GoodweBmSInfo();
  #flashInfo = {};
  #bmsDetail = {};
  #ceiAutoTest = {};
  #powerLimit = {};

  /**
   * @param {ioBroker.Logger} log
   */
  constructor(log) {
    this.log = log;
    this.#client.on("message", (rcvbuf) => this.#handleMessage(rcvbuf));
    this.#client.on("error", (error) => {
      this.#status = GoodWeUdp.ConStatus.Offline;
      this.log.warn(`UDP socket error: ${error.message}`);
    });
    // the next line of code should be deleted. I think it was probably introduced to silence the ever increasing listeners on this.#client
    // because of the .on()-calls which installs a listener on each invocation, but does not remove it.
    // this.#client.setMaxListeners(0);
  }

  destructor() {
    for (const request of this.#pendingRequests.splice(0)) {
      this.#clearPendingRequest(request);
      request.reject(new Error("Socket closed"));
    }
    this.#client.close();
  }

  Connect(IpAddr, Port, options = {}) {
    this.#ipAddr = IpAddr;
    this.#port = Port;
    this.#timeoutMs = options.timeoutMs ?? GoodWeUdp.DefaultTimeoutMs;
    this.#retries = options.retries ?? GoodWeUdp.DefaultRetries;

    return this.ReadIdInfo();
  }

  #handleMessage(rcvbuf) {
    const requestIndex = this.#pendingRequests.findIndex((request) =>
      request.matcher(rcvbuf),
    );

    if (requestIndex === -1) {
      this.log.debug?.(`Ignoring unmatched UDP frame (${rcvbuf.length} bytes)`);
      return;
    }

    const [request] = this.#pendingRequests.splice(requestIndex, 1);
    this.#clearPendingRequest(request);
    request.resolve(rcvbuf);
  }

  #clearPendingRequest(request) {
    if (request.timeout) {
      clearTimeout(request.timeout);
      request.timeout = null;
    }
  }

  #send(sendbuf) {
    return new Promise((resolve, reject) => {
      this.#client.send(
        sendbuf,
        0,
        sendbuf.length,
        this.#port,
        this.#ipAddr,
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(undefined);
        },
      );
    });
  }

  async #request(sendbuf, matcher, name) {
    let lastError;

    for (let attempt = 0; attempt <= this.#retries; attempt++) {
      try {
        const response = await new Promise((resolve, reject) => {
          let request;
          const timeout = setTimeout(() => {
            const requestIndex = this.#pendingRequests.indexOf(request);
            if (requestIndex !== -1) {
              this.#pendingRequests.splice(requestIndex, 1);
            }
            reject(new Error(`${name} timed out after ${this.#timeoutMs} ms`));
          }, this.#timeoutMs);

          request = {
            matcher,
            resolve,
            reject,
            timeout,
          };

          this.#pendingRequests.push(request);

          this.#send(sendbuf).catch((error) => {
            const requestIndex = this.#pendingRequests.indexOf(request);
            if (requestIndex !== -1) {
              this.#pendingRequests.splice(requestIndex, 1);
            }
            this.#clearPendingRequest(request);
            reject(error);
          });
        });

        this.#status = GoodWeUdp.ConStatus.Online;
        return response;
      } catch (error) {
        lastError = error;
        this.#status = GoodWeUdp.ConStatus.Offline;

        if (attempt < this.#retries) {
          this.log.debug?.(`${name} retry ${attempt + 1}/${this.#retries}`);
        }
      }
    }

    throw lastError;
  }

  #buildReadRegisterRequest(start, count) {
    const sendbuf = new Uint8Array(8);

    sendbuf[0] = GoodWeRegister.Addr.Inverter;
    sendbuf[1] = GoodWeRegister.FcDode.Read;
    sendbuf[2] = start >> 8;
    sendbuf[3] = start & 0x00ff;
    sendbuf[4] = count >> 8;
    sendbuf[5] = count & 0x00ff;

    const crc = this.#CalculatetCrc16(sendbuf, 0, 6);
    sendbuf[6] = crc >> 8;
    sendbuf[7] = crc & 0x00ff;

    return sendbuf;
  }

  async #readRegisterGroup(group, target) {
    const sendbuf = this.#buildReadRegisterRequest(group.start, group.count);
    const rcvbuf = await this.#request(
      sendbuf,
      (data) => this.#CheckRecRegisterData(data, sendbuf[1], sendbuf[5]),
      group.name,
    );

    for (const item of group.entries) {
      this.#setModelValue(
        target,
        item.model,
        this.#parseRegisterValue(rcvbuf, group.start, item),
      );
    }

    return rcvbuf;
  }

  #parseRegisterValue(data, start, item) {
    const offset = 5 + (item.address - start) * 2;
    let value;

    switch (item.type) {
      case TYPE.S16:
        value = this.#GetIntFromByteArray(data, offset, 2);
        break;
      case TYPE.U32:
        value = this.#GetUintFromByteArray(data, offset, 4);
        break;
      case TYPE.S32:
        value = this.#GetIntFromByteArray(data, offset, 4);
        break;
      case TYPE.FLOAT:
        value = this.#GetFloatFromByteArray(data, offset, 4);
        break;
      case TYPE.STRING:
        value = this.#GetStringFromByteArray(data, offset, item.registers * 2);
        break;
      case TYPE.BYTE:
        value = data[offset + item.byteOffset];
        break;
      default:
        value = this.#GetUintFromByteArray(data, offset, 2);
        break;
    }

    if (typeof value === "number" && item.scale !== 1) {
      return value / item.scale;
    }

    return value;
  }

  #setModelValue(target, path, value) {
    const parts = path.split(".");
    const key = parts.pop();
    let current = target;

    for (const part of parts) {
      if (current[part] === undefined) {
        current[part] = {};
      }
      current = current[part];
    }

    current[key] = value;
  }

  async ReadGroup(groupName) {
    const group = registerGroups[groupName];
    const targets = {
      deviceInfo: this.#deviceInfo,
      runningData: this.#runningData,
      extComData: this.#extComData,
      bmsInfo: this.#bmsInfo,
      deviceSimccid: this.#deviceInfo,
      extComDataExtended: this.#extComData,
      flashInfo: this.#flashInfo,
      bmsInfoExtended: this.#bmsInfo,
      bmsDetail: this.#bmsDetail,
      ceiAutoTest: this.#ceiAutoTest,
      powerLimit: this.#powerLimit,
    };

    if (!group || !targets[groupName]) {
      this.log.warn(`Unknown register group: ${groupName}`);
      return false;
    }

    try {
      await this.#readRegisterGroup(group, targets[groupName]);

      if (groupName === "runningData") {
        this.#runningData.TotalPowerPv =
          this.#runningData.Pv1.Power +
          this.#runningData.Pv2.Power +
          this.#runningData.Pv3.Power +
          this.#runningData.Pv4.Power;
      }

      return true;
    } catch (error) {
      this.log.warn(`${group.name}: ${error.message ?? error}`);
      return false;
    }
  }

  async ReadIdInfo() {
    let sendbuf = new Uint8Array(9);
    let i;
    let crc = 0;

    sendbuf[0] = GoodWePacket.Header.High;
    sendbuf[1] = GoodWePacket.Header.Low;
    sendbuf[2] = GoodWePacket.Addr.AP;
    sendbuf[3] = GoodWePacket.Addr.Inverter;
    sendbuf[4] = GoodWePacket.CtrCode.Read;
    sendbuf[5] = GoodWePacket.FcCodeRead.QueryIdInfo;
    sendbuf[6] = 0;

    for (i = 0; i <= 6; i++) {
      crc = crc + sendbuf[i];
    }

    sendbuf[7] = crc >> 8;
    sendbuf[8] = crc & 0x00ff;

    try {
      const rcvbuf = await this.#request(
        sendbuf,
        (data) => this.#CheckRecPacket(data, sendbuf[4], sendbuf[5]),
        "ReadIdInfo",
      );
      this.#idInfo.FirmwareVersion = this.#GetStringFromByteArray(rcvbuf, 7, 5);
      this.#idInfo.ModelName = this.#GetStringFromByteArray(rcvbuf, 12, 10);
      this.#idInfo.Na = rcvbuf.slice(22, 37);
      this.#idInfo.SerialNumber = this.#GetStringFromByteArray(rcvbuf, 38, 16);
      this.#idInfo.NomVpv = this.#GetUintFromByteArray(rcvbuf, 54, 4) / 10;
      this.#idInfo.InternalVersion = this.#GetStringFromByteArray(
        rcvbuf,
        58,
        12,
      );
      this.#idInfo.SafetyCountryCode = rcvbuf[70];

      return true;
    } catch (error) {
      this.log.warn(`ReadIdInfo: ${error.message ?? error}`);
      return false;
    }
  }

  async ReadDeviceInfo() {
    try {
      await this.#readRegisterGroup(
        registerGroups.deviceInfo,
        this.#deviceInfo,
      );
      return true;
    } catch (error) {
      this.log.warn(`ReadDeviceInfo: ${error.message ?? error}`);
      return false;
    }
  }

  async ReadRunningData() {
    let sendbuf = new Uint8Array(8);
    let crc;

    sendbuf[0] = GoodWeRegister.Addr.Inverter;
    sendbuf[1] = GoodWeRegister.FcDode.Read;
    sendbuf[2] = 0x89;
    sendbuf[3] = 0x1c;
    sendbuf[4] = 0x00;
    sendbuf[5] = 0x7d;

    crc = this.#CalculatetCrc16(sendbuf, 0, 6);

    sendbuf[6] = crc >> 8;
    sendbuf[7] = crc & 0x00ff;

    try {
      const rcvbuf = await this.#request(
        sendbuf,
        (data) => this.#CheckRecRegisterData(data, sendbuf[1], sendbuf[5]),
        "ReadRunningData",
      );
      this.#runningData.Pv1.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 11, 2) / 10;
      this.#runningData.Pv1.Current =
        this.#GetUintFromByteArray(rcvbuf, 13, 2) / 10;
      this.#runningData.Pv1.Power = this.#GetUintFromByteArray(rcvbuf, 15, 4);
      this.#runningData.Pv2.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 19, 2) / 10;
      this.#runningData.Pv2.Current =
        this.#GetUintFromByteArray(rcvbuf, 21, 2) / 10;
      this.#runningData.Pv2.Power = this.#GetUintFromByteArray(rcvbuf, 23, 4);
      this.#runningData.Pv3.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 27, 2) / 10;
      this.#runningData.Pv3.Current =
        this.#GetUintFromByteArray(rcvbuf, 29, 2) / 10;
      this.#runningData.Pv3.Power = this.#GetUintFromByteArray(rcvbuf, 31, 4);
      this.#runningData.Pv4.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 35, 2) / 10;
      this.#runningData.Pv4.Current =
        this.#GetUintFromByteArray(rcvbuf, 37, 2) / 10;
      this.#runningData.Pv4.Power = this.#GetUintFromByteArray(rcvbuf, 39, 4);
      this.#runningData.Pv4.Mode = rcvbuf[43];
      this.#runningData.Pv3.Mode = rcvbuf[44];
      this.#runningData.Pv2.Mode = rcvbuf[45];
      this.#runningData.Pv1.Mode = rcvbuf[46];
      this.#runningData.GridL1.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 47, 2) / 10;
      this.#runningData.GridL1.Current =
        this.#GetUintFromByteArray(rcvbuf, 49, 2) / 10;
      this.#runningData.GridL1.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 51, 2) / 100;
      this.#runningData.GridL1.Power = this.#GetIntFromByteArray(rcvbuf, 55, 2);
      this.#runningData.GridL2.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 57, 2) / 10;
      this.#runningData.GridL2.Current =
        this.#GetUintFromByteArray(rcvbuf, 59, 2) / 10;
      this.#runningData.GridL2.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 61, 2) / 100;
      this.#runningData.GridL2.Power = this.#GetIntFromByteArray(rcvbuf, 65, 2);
      this.#runningData.GridL3.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 67, 2) / 10;
      this.#runningData.GridL3.Current =
        this.#GetUintFromByteArray(rcvbuf, 69, 2) / 10;
      this.#runningData.GridL3.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 71, 2) / 100;
      this.#runningData.GridL3.Power = this.#GetIntFromByteArray(rcvbuf, 75, 2);
      this.#runningData.GridMode = this.#GetUintFromByteArray(rcvbuf, 77, 2);
      this.#runningData.InverterTotalPower = this.#GetIntFromByteArray(
        rcvbuf,
        81,
        2,
      );
      this.#runningData.AcActivePower = this.#GetIntFromByteArray(
        rcvbuf,
        85,
        2,
      );
      this.#runningData.AcReactivePower = this.#GetIntFromByteArray(
        rcvbuf,
        89,
        2,
      );
      this.#runningData.AcApparentPower = this.#GetIntFromByteArray(
        rcvbuf,
        93,
        2,
      );
      this.#runningData.BackUpL1.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 95, 2) / 10;
      this.#runningData.BackUpL1.Current =
        this.#GetUintFromByteArray(rcvbuf, 97, 2) / 10;
      this.#runningData.BackUpL1.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 99, 2) / 100;
      this.#runningData.BackUpL1.Mode = this.#GetUintFromByteArray(
        rcvbuf,
        101,
        2,
      );
      this.#runningData.BackUpL1.Power = this.#GetIntFromByteArray(
        rcvbuf,
        105,
        2,
      );
      this.#runningData.BackUpL2.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 107, 2) / 10;
      this.#runningData.BackUpL2.Current =
        this.#GetUintFromByteArray(rcvbuf, 109, 2) / 10;
      this.#runningData.BackUpL2.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 111, 2) / 100;
      this.#runningData.BackUpL2.Mode = this.#GetUintFromByteArray(
        rcvbuf,
        113,
        2,
      );
      this.#runningData.BackUpL2.Power = this.#GetIntFromByteArray(
        rcvbuf,
        117,
        2,
      );
      this.#runningData.BackUpL3.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 119, 2) / 10;
      this.#runningData.BackUpL3.Current =
        this.#GetUintFromByteArray(rcvbuf, 121, 2) / 10;
      this.#runningData.BackUpL3.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 123, 2) / 100;
      this.#runningData.BackUpL3.Mode = this.#GetUintFromByteArray(
        rcvbuf,
        125,
        2,
      );
      this.#runningData.BackUpL3.Power = this.#GetIntFromByteArray(
        rcvbuf,
        129,
        2,
      );
      this.#runningData.PowerL1 = this.#GetIntFromByteArray(rcvbuf, 133, 2);
      this.#runningData.PowerL2 = this.#GetIntFromByteArray(rcvbuf, 137, 2);
      this.#runningData.PowerL3 = this.#GetIntFromByteArray(rcvbuf, 141, 2);
      this.#runningData.TotalPowerBackUp = this.#GetIntFromByteArray(
        rcvbuf,
        145,
        2,
      );
      this.#runningData.TotalPower = this.#GetIntFromByteArray(rcvbuf, 149, 2);
      this.#runningData.UpsLoadPercent = this.#GetUintFromByteArray(
        rcvbuf,
        151,
        2,
      );
      this.#runningData.AirTemperature =
        this.#GetIntFromByteArray(rcvbuf, 153, 2) / 10;
      this.#runningData.ModulTemperature =
        this.#GetIntFromByteArray(rcvbuf, 155, 2) / 10;
      this.#runningData.RadiatorTemperature =
        this.#GetIntFromByteArray(rcvbuf, 157, 2) / 10;
      this.#runningData.FunctionBitValue = this.#GetUintFromByteArray(
        rcvbuf,
        159,
        2,
      );
      this.#runningData.BusVoltage =
        this.#GetUintFromByteArray(rcvbuf, 161, 2) / 10;
      this.#runningData.NbusVoltage =
        this.#GetUintFromByteArray(rcvbuf, 163, 2) / 10;
      this.#runningData.Battery1.Voltage =
        this.#GetUintFromByteArray(rcvbuf, 165, 2) / 10;
      this.#runningData.Battery1.Current =
        this.#GetIntFromByteArray(rcvbuf, 167, 2) / 10;
      this.#runningData.Battery1.Power = this.#GetIntFromByteArray(
        rcvbuf,
        171,
        2,
      );
      this.#runningData.Battery1.Mode = this.#GetUintFromByteArray(
        rcvbuf,
        173,
        2,
      );
      this.#runningData.WarningCode = this.#GetUintFromByteArray(
        rcvbuf,
        175,
        2,
      );
      this.#runningData.SaftyCountry = this.#GetUintFromByteArray(
        rcvbuf,
        177,
        2,
      );
      this.#runningData.WorkMode = this.#GetUintFromByteArray(rcvbuf, 179, 2);
      this.#runningData.OperationMode = this.#GetUintFromByteArray(
        rcvbuf,
        181,
        2,
      );
      this.#runningData.ErrorMessage = this.#GetUintFromByteArray(
        rcvbuf,
        183,
        4,
      );
      this.#runningData.PvEnergyTotal =
        this.#GetUintFromByteArray(rcvbuf, 187, 4) / 10;
      this.#runningData.PvEnergyDay =
        this.#GetUintFromByteArray(rcvbuf, 191, 4) / 10;
      this.#runningData.EnergyTotal =
        this.#GetUintFromByteArray(rcvbuf, 195, 4) / 10;
      this.#runningData.HoursTotal = this.#GetUintFromByteArray(rcvbuf, 199, 4);
      this.#runningData.EnergyDaySell =
        this.#GetUintFromByteArray(rcvbuf, 203, 2) / 10;
      this.#runningData.EnergyTotalBuy =
        this.#GetUintFromByteArray(rcvbuf, 205, 4) / 10;
      this.#runningData.EnergyDayBuy =
        this.#GetUintFromByteArray(rcvbuf, 209, 2) / 10;
      this.#runningData.EnergyTotalLoad =
        this.#GetUintFromByteArray(rcvbuf, 211, 4) / 10;
      this.#runningData.EnergyDayLoad =
        this.#GetUintFromByteArray(rcvbuf, 215, 2) / 10;
      this.#runningData.EnergyBatteryCharge =
        this.#GetUintFromByteArray(rcvbuf, 217, 4) / 10;
      this.#runningData.EnergyDayCharge =
        this.#GetUintFromByteArray(rcvbuf, 221, 2) / 10;
      this.#runningData.EnergyBatteryDischarge =
        this.#GetUintFromByteArray(rcvbuf, 223, 4) / 10;
      this.#runningData.EnergyDayDischarge =
        this.#GetUintFromByteArray(rcvbuf, 227, 2) / 10;
      this.#runningData.BatteryStrings = this.#GetUintFromByteArray(
        rcvbuf,
        229,
        2,
      );
      this.#runningData.CpldWarningCode = this.#GetUintFromByteArray(
        rcvbuf,
        231,
        2,
      );
      this.#runningData.WChargeCtrFlag = this.#GetUintFromByteArray(
        rcvbuf,
        233,
        2,
      );
      this.#runningData.DerateFlag = this.#GetUintFromByteArray(rcvbuf, 235, 2);
      this.#runningData.DerateFrozenPower = this.#GetUintFromByteArray(
        rcvbuf,
        237,
        4,
      );
      this.#runningData.DiagStatusH = this.#GetUintFromByteArray(
        rcvbuf,
        241,
        4,
      );
      this.#runningData.DiagStatusL = this.#GetUintFromByteArray(
        rcvbuf,
        245,
        4,
      );
      this.#runningData.TotalPowerPv =
        this.#runningData.Pv1.Power +
        this.#runningData.Pv2.Power +
        this.#runningData.Pv3.Power +
        this.#runningData.Pv4.Power;

      return true;
    } catch (error) {
      this.log.warn(`ReadRunningData: ${error.message ?? error}`);
      return false;
    }
  }

  async ReadExtComData() {
    let sendbuf = new Uint8Array(8);
    let crc;

    sendbuf[0] = GoodWeRegister.Addr.Inverter;
    sendbuf[1] = GoodWeRegister.FcDode.Read;
    sendbuf[2] = 0x8c;
    sendbuf[3] = 0xa0;
    sendbuf[4] = 0x00;
    sendbuf[5] = 0x1b;

    crc = this.#CalculatetCrc16(sendbuf, 0, 6);

    sendbuf[6] = crc >> 8;
    sendbuf[7] = crc & 0x00ff;

    try {
      const rcvbuf = await this.#request(
        sendbuf,
        (data) => this.#CheckRecRegisterData(data, sendbuf[1], sendbuf[5]),
        "ReadExtComData",
      );
      this.#extComData.Commode = this.#GetUintFromByteArray(rcvbuf, 5, 2);
      this.#extComData.Rssi = this.#GetUintFromByteArray(rcvbuf, 7, 2);
      this.#extComData.ManufacturerCode = this.#GetUintFromByteArray(
        rcvbuf,
        9,
        2,
      );
      this.#extComData.MeterConnectStatus = this.#GetUintFromByteArray(
        rcvbuf,
        11,
        2,
      );
      this.#extComData.MeterCommunicateStatus = this.#GetUintFromByteArray(
        rcvbuf,
        13,
        2,
      );
      this.#extComData.L1.ActivePower = this.#GetIntFromByteArray(
        rcvbuf,
        15,
        2,
      );
      this.#extComData.L2.ActivePower = this.#GetIntFromByteArray(
        rcvbuf,
        17,
        2,
      );
      this.#extComData.L3.ActivePower = this.#GetIntFromByteArray(
        rcvbuf,
        19,
        2,
      );
      this.#extComData.TotalActivePower = this.#GetIntFromByteArray(
        rcvbuf,
        21,
        2,
      );
      this.#extComData.TotalReactivePower = this.#GetUintFromByteArray(
        rcvbuf,
        23,
        2,
      );
      this.#extComData.L1.PowerFactor =
        this.#GetUintFromByteArray(rcvbuf, 25, 2) / 100;
      this.#extComData.L2.PowerFactor =
        this.#GetUintFromByteArray(rcvbuf, 27, 2) / 100;
      this.#extComData.L3.PowerFactor =
        this.#GetUintFromByteArray(rcvbuf, 29, 2) / 100;
      this.#extComData.PowerFactor =
        this.#GetUintFromByteArray(rcvbuf, 31, 2) / 100;
      this.#extComData.Frequency =
        this.#GetUintFromByteArray(rcvbuf, 33, 2) / 100;
      this.#extComData.EnergyTotalSell =
        this.#GetFloatFromByteArray(rcvbuf, 35, 4) / 10;
      this.#extComData.EnergyTotalBuy =
        this.#GetFloatFromByteArray(rcvbuf, 39, 4) / 10;

      return true;
    } catch (error) {
      this.log.warn(`ReadExtComData: ${error.message ?? error}`);
      return false;
    }
  }

  async ReadBmsInfo() {
    let sendbuf = new Uint8Array(8);
    let crc;

    sendbuf[0] = GoodWeRegister.Addr.Inverter;
    sendbuf[1] = GoodWeRegister.FcDode.Read;
    sendbuf[2] = 0x90;
    sendbuf[3] = 0x8a;
    sendbuf[4] = 0x00;
    sendbuf[5] = 0x08;

    crc = this.#CalculatetCrc16(sendbuf, 0, 6);

    sendbuf[6] = crc >> 8;
    sendbuf[7] = crc & 0x00ff;

    try {
      const rcvbuf = await this.#request(
        sendbuf,
        (data) => this.#CheckRecRegisterData(data, sendbuf[1], sendbuf[5]),
        "ReadBmsInfo",
      );
      this.#bmsInfo.Status = this.#GetUintFromByteArray(rcvbuf, 5, 2);
      this.#bmsInfo.PackTemperature =
        this.#GetUintFromByteArray(rcvbuf, 7, 2) / 10;
      this.#bmsInfo.CurrentMaxCharge = this.#GetUintFromByteArray(rcvbuf, 9, 2);
      this.#bmsInfo.CurrentMaxDischarge = this.#GetUintFromByteArray(
        rcvbuf,
        11,
        2,
      );
      this.#bmsInfo.ErrorCode = this.#GetUintFromByteArray(rcvbuf, 13, 2);
      this.#bmsInfo.SOC = this.#GetUintFromByteArray(rcvbuf, 15, 2);
      this.#bmsInfo.SOH = this.#GetUintFromByteArray(rcvbuf, 17, 2);
      this.#bmsInfo.BatteryStrings = this.#GetUintFromByteArray(rcvbuf, 19, 2);

      return true;
    } catch (error) {
      this.log.warn(`ReadBmsInfo: ${error.message ?? error}`);
      return false;
    }
  }

  #CheckRecPacket(Data, CtrCode, FctCode) {
    let packetFormat = new Uint8Array(GoodWePacket.Format.Packet);
    let packetCrc = new Uint8Array(GoodWePacket.Format.Checksum);
    let i;
    let crc = 0;
    let low, high;

    packetFormat = Data.slice(0, GoodWePacket.Format.Packet);
    packetCrc = Data.slice(
      Data.length - GoodWePacket.Format.Checksum,
      Data.length,
    );

    for (i = 0; i < Data.length - GoodWePacket.Format.Checksum; i++) {
      crc = crc + Data[i];
    }

    high = crc >> 8;
    low = crc & 0x00ff;

    if (packetCrc[0] == high && packetCrc[1] == low) {
      if (
        packetFormat[0] == GoodWePacket.Header.High &&
        packetFormat[1] == GoodWePacket.Header.Low
      ) {
        if (
          packetFormat[2] == GoodWePacket.Addr.Inverter &&
          packetFormat[3] == GoodWePacket.Addr.AP
        ) {
          if (packetFormat[4] == CtrCode) {
            if (packetFormat[5] == (FctCode | 0x80)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  #CheckRecRegisterData(Data, FctCode, Length) {
    let registerFrame = new Uint8Array(GoodWeRegister.Format.Frame);
    let registerCrc = new Uint8Array(GoodWeRegister.Format.CRC16);
    let crc = 0;

    registerFrame = Data.slice(0, GoodWeRegister.Format.Frame);
    registerCrc = Data.slice(
      Data.length - GoodWeRegister.Format.CRC16,
      Data.length,
    );

    crc = this.#CalculatetCrc16(
      Data,
      2,
      Data.length - GoodWeRegister.Format.CRC16 - 2,
    );

    if (registerCrc[0] == crc >> 8 && registerCrc[1] == (crc & 0x00ff)) {
      if (
        registerFrame[0] == GoodWeRegister.RecvHeader.High &&
        registerFrame[1] == GoodWeRegister.RecvHeader.Low
      ) {
        if (registerFrame[2] == GoodWeRegister.Addr.Inverter) {
          if (registerFrame[3] == FctCode) {
            if (registerFrame[4] == Length * 2) {
              return true;
            }
          }
        }
      }
    }

    return false;
  }

  #GetStringFromByteArray(Data, Start, Length) {
    let buf = new Uint8Array(Length);
    let value;

    buf = Data.slice(Start, Start + Length);
    value = buf.toString();

    return value;
  }

  #GetUintFromByteArray(Data, Start, Length) {
    let buf = new Uint8Array(Length);
    let i;
    let value = 0;

    buf = Data.slice(Start, Start + Length);
    //buf.reverse();

    for (i = 0; i < Length; i++) {
      value = value << 8;
      value = value + buf[i];
    }

    return value;
  }

  #GetIntFromByteArray(Data, Start, Length) {
    let buf = new Uint8Array(Length);
    let i;
    let value = 0;

    buf = Data.slice(Start, Start + Length);
    //buf.reverse();

    for (i = 0; i < Length; i++) {
      value = value << 8;
      value = value + buf[i];
    }

    if ((value & 0x8000) == 0x8000) {
      value = value ^ 0xffff;
      value = value + 1;
      value = value * -1;
    }

    return value;
  }

  #GetFloatFromByteArray(Data, Start, Length) {
    let buf = new Uint8Array(Length);

    buf = Data.slice(Start, Start + Length);

    var bits = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
    //var bits = 0b10111101111110111110011101101101; // = -0,123;
    var sign = bits >>> 31 === 0 ? 1.0 : -1.0;
    var e = (bits >>> 23) & 0xff;
    var m = e === 0 ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
    var f = sign * m * Math.pow(2, e - 150);

    return f;
  }

  #CalculatetCrc16(Data, Start, Length) {
    let pos;
    let i;
    let crc = 0xffff;
    let ret;

    for (pos = Start; pos < Start + Length; pos++) {
      crc ^= Data[pos];

      for (i = 8; i != 0; i--) {
        if ((crc & 0x0001) != 0) {
          crc >>= 1;
          crc ^= 0xa001;
        } else {
          crc >>= 1;
        }
      }
    }

    ret = ((crc & 0x00ff) << 8) + ((crc & 0xff00) >> 8);

    return ret;
  }

  get Status() {
    return this.#status;
  }

  get IdInfo() {
    return this.#idInfo;
  }

  get DeviceInfo() {
    return this.#deviceInfo;
  }

  get RunningData() {
    return this.#runningData;
  }

  get ExtComData() {
    return this.#extComData;
  }

  get BmsInfo() {
    return this.#bmsInfo;
  }

  get FlashInfo() {
    return this.#flashInfo;
  }

  get BmsDetail() {
    return this.#bmsDetail;
  }

  get CeiAutoTest() {
    return this.#ceiAutoTest;
  }

  get PowerLimit() {
    return this.#powerLimit;
  }
}

module.exports = {
  GoodWePacket,
  GoodWeRegister,
  GoodWeIdInfo,
  GoodWeDeviceInfo,
  GoodWeMeterPhase,
  GoodWeExternalComData,
  GoodweBmSInfo,
  GoodWeUdp,
};
