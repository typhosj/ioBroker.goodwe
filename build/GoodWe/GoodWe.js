"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoodWeUdp = exports.GoodweBmSInfo = exports.GoodWeExternalComData = exports.GoodWeMeterPhase = exports.GoodWeDeviceInfo = exports.GoodWeIdInfo = exports.GoodWeRegister = exports.GoodWePacket = void 0;
const node_dgram_1 = __importDefault(require("node:dgram"));
const register_map_1 = require("../lib/register-map");
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
exports.GoodWePacket = GoodWePacket;
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
exports.GoodWeRegister = GoodWeRegister;
class GoodWeIdInfo {
    FirmwareVersion = "";
    ModelName = "";
    Na = new Uint8Array(16);
    SerialNumber = "";
    NomVpv = 0.0;
    InternalVersion = "";
    SafetyCountryCode = 0x00;
}
exports.GoodWeIdInfo = GoodWeIdInfo;
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
exports.GoodWeDeviceInfo = GoodWeDeviceInfo;
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
    ModuleTemperature = 0.0;
    RadiatorTemperature = 0.0;
    FunctionBitValue = 0;
    BusVoltage = 0.0;
    NbusVoltage = 0.0;
    Battery1 = new DcParameters();
    WarningCode = 0;
    SafetyCountry = 0;
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
exports.GoodWeMeterPhase = GoodWeMeterPhase;
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
exports.GoodWeExternalComData = GoodWeExternalComData;
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
exports.GoodweBmSInfo = GoodweBmSInfo;
class GoodWeUdp {
    static ConStatus = { Offline: false, Online: true };
    static DefaultTimeoutMs = 5000;
    static DefaultRetries = 1;
    #status = _a.ConStatus.Offline;
    #ipAddr = "";
    #port = 0;
    #client = node_dgram_1.default.createSocket("udp4");
    #pendingRequests = [];
    #optionalGroupBackoffUntil = new Map();
    #timeoutMs = _a.DefaultTimeoutMs;
    #retries = _a.DefaultRetries;
    #idInfo = new GoodWeIdInfo();
    #deviceInfo = new GoodWeDeviceInfo();
    #runningData = new GoodWeRunningData();
    #extComData = new GoodWeExternalComData();
    #bmsInfo = new GoodweBmSInfo();
    #flashInfo = {};
    #bmsDetail = {};
    #ceiAutoTest = {};
    #powerLimit = {};
    log;
    /**
     * @param log
     */
    constructor(log) {
        this.log = log;
        this.#client.on("message", (rcvbuf) => this.#handleMessage(rcvbuf));
        this.#client.on("error", (error) => {
            this.#status = _a.ConStatus.Offline;
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
        this.#timeoutMs = clampNumber(options.timeoutMs, _a.DefaultTimeoutMs, 1000, 30000);
        this.#retries = clampNumber(options.retries, _a.DefaultRetries, 0, 5);
        return this.ReadIdInfo();
    }
    #handleMessage(rcvbuf) {
        const requestIndex = this.#pendingRequests.findIndex((request) => request.matcher(rcvbuf));
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
            globalThis.clearTimeout(request.timeout);
            request.timeout = null;
        }
    }
    #send(sendbuf) {
        return new Promise((resolve, reject) => {
            this.#client.send(sendbuf, 0, sendbuf.length, this.#port, this.#ipAddr, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(undefined);
            });
        });
    }
    async #request(sendbuf, matcher, name) {
        let lastError;
        for (let attempt = 0; attempt <= this.#retries; attempt++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    const request = {
                        matcher,
                        resolve,
                        reject,
                        timeout: null,
                    };
                    const timeout = globalThis.setTimeout(() => {
                        const requestIndex = this.#pendingRequests.indexOf(request);
                        if (requestIndex !== -1) {
                            this.#pendingRequests.splice(requestIndex, 1);
                        }
                        reject(new Error(`${name} timed out after ${this.#timeoutMs} ms`));
                    }, this.#timeoutMs);
                    request.timeout = timeout;
                    this.#pendingRequests.push(request);
                    this.#send(sendbuf).catch((error) => {
                        const requestIndex = this.#pendingRequests.indexOf(request);
                        if (requestIndex !== -1) {
                            this.#pendingRequests.splice(requestIndex, 1);
                        }
                        this.#clearPendingRequest(request);
                        reject(error instanceof Error
                            ? error
                            : new Error(typeof error === "string" ? error : "UDP send failed"));
                    });
                });
                this.#status = _a.ConStatus.Online;
                return response;
            }
            catch (error) {
                lastError = error;
                this.#status = _a.ConStatus.Offline;
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
        const rcvbuf = await this.#request(sendbuf, (data) => this.#CheckRecRegisterData(data, sendbuf[1], sendbuf[5]), group.name);
        for (const item of group.entries) {
            this.#setModelValue(target, item.model, this.#parseRegisterValue(rcvbuf, group.start, item));
        }
        return rcvbuf;
    }
    #parseRegisterValue(data, start, item) {
        const offset = 5 + (item.address - start) * 2;
        let value;
        switch (item.type) {
            case register_map_1.TYPE.S16:
                value = this.#GetIntFromByteArray(data, offset, 2);
                break;
            case register_map_1.TYPE.U32:
                value = this.#GetUintFromByteArray(data, offset, 4);
                break;
            case register_map_1.TYPE.S32:
                value = this.#GetIntFromByteArray(data, offset, 4);
                break;
            case register_map_1.TYPE.FLOAT:
                value = this.#GetFloatFromByteArray(data, offset, 4);
                break;
            case register_map_1.TYPE.STRING:
                value = this.#GetStringFromByteArray(data, offset, item.registers * 2);
                break;
            case register_map_1.TYPE.BYTE:
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
        if (key) {
            current[key] = value;
        }
    }
    async ReadGroup(groupName, options = {}) {
        const group = register_map_1.registerGroups[groupName];
        const isOptional = options.optional === true;
        const backoffUntil = this.#optionalGroupBackoffUntil.get(groupName) ?? 0;
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
        if (isOptional && backoffUntil > Date.now()) {
            return false;
        }
        const previousStatus = this.#status;
        try {
            await this.#readRegisterGroup(group, targets[groupName]);
            this.#optionalGroupBackoffUntil.delete(groupName);
            if (groupName === "runningData") {
                this.#runningData.TotalPowerPv =
                    this.#runningData.Pv1.Power +
                        this.#runningData.Pv2.Power +
                        this.#runningData.Pv3.Power +
                        this.#runningData.Pv4.Power;
            }
            return true;
        }
        catch (error) {
            if (isOptional) {
                this.#status = previousStatus;
                this.#optionalGroupBackoffUntil.set(groupName, Date.now() + 60 * 60 * 1000);
                this.log.debug?.(`${group.name}: ${error.message ?? error}`);
                return false;
            }
            this.log.warn(`${group.name}: ${error.message ?? error}`);
            return false;
        }
    }
    async ReadIdInfo() {
        const sendbuf = new Uint8Array(9);
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
            const rcvbuf = await this.#request(sendbuf, (data) => this.#CheckRecPacket(data, sendbuf[4], sendbuf[5]), "ReadIdInfo");
            this.#idInfo.FirmwareVersion = this.#GetStringFromByteArray(rcvbuf, 7, 5);
            this.#idInfo.ModelName = this.#GetStringFromByteArray(rcvbuf, 12, 10);
            this.#idInfo.Na = rcvbuf.slice(22, 37);
            this.#idInfo.SerialNumber = this.#GetStringFromByteArray(rcvbuf, 38, 16);
            this.#idInfo.NomVpv = this.#GetUintFromByteArray(rcvbuf, 54, 4) / 10;
            this.#idInfo.InternalVersion = this.#GetStringFromByteArray(rcvbuf, 58, 12);
            this.#idInfo.SafetyCountryCode = rcvbuf[70];
            return true;
        }
        catch (error) {
            this.log.warn(`ReadIdInfo: ${error.message ?? error}`);
            return false;
        }
    }
    async ReadDeviceInfo() {
        return this.ReadGroup("deviceInfo");
    }
    async ReadRunningData() {
        return this.ReadGroup("runningData");
    }
    async ReadExtComData() {
        return this.ReadGroup("extComData");
    }
    async ReadBmsInfo() {
        return this.ReadGroup("bmsInfo");
    }
    #CheckRecPacket(Data, CtrCode, FctCode) {
        let packetFormat = new Uint8Array(GoodWePacket.Format.Packet);
        let packetCrc = new Uint8Array(GoodWePacket.Format.Checksum);
        let i;
        let crc = 0;
        packetFormat = Data.slice(0, GoodWePacket.Format.Packet);
        packetCrc = Data.slice(Data.length - GoodWePacket.Format.Checksum, Data.length);
        for (i = 0; i < Data.length - GoodWePacket.Format.Checksum; i++) {
            crc = crc + Data[i];
        }
        const high = crc >> 8;
        const low = crc & 0x00ff;
        if (packetCrc[0] == high && packetCrc[1] == low) {
            if (packetFormat[0] == GoodWePacket.Header.High &&
                packetFormat[1] == GoodWePacket.Header.Low) {
                if (packetFormat[2] == GoodWePacket.Addr.Inverter &&
                    packetFormat[3] == GoodWePacket.Addr.AP) {
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
        registerCrc = Data.slice(Data.length - GoodWeRegister.Format.CRC16, Data.length);
        crc = this.#CalculatetCrc16(Data, 2, Data.length - GoodWeRegister.Format.CRC16 - 2);
        if (registerCrc[0] == crc >> 8 && registerCrc[1] == (crc & 0x00ff)) {
            if (registerFrame[0] == GoodWeRegister.RecvHeader.High &&
                registerFrame[1] == GoodWeRegister.RecvHeader.Low) {
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
        return Buffer.from(Data.slice(Start, Start + Length))
            .toString("ascii")
            .replace(/\0/g, "")
            .trim();
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
        return Buffer.from(Data.slice(Start, Start + Length)).readIntBE(0, Length);
    }
    #GetFloatFromByteArray(Data, Start, Length) {
        let buf = new Uint8Array(Length);
        buf = Data.slice(Start, Start + Length);
        const bits = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
        //var bits = 0b10111101111110111110011101101101; // = -0,123;
        const sign = bits >>> 31 === 0 ? 1.0 : -1.0;
        const e = (bits >>> 23) & 0xff;
        const m = e === 0 ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
        const f = sign * m * Math.pow(2, e - 150);
        return f;
    }
    #CalculatetCrc16(Data, Start, Length) {
        let pos;
        let i;
        let crc = 0xffff;
        for (pos = Start; pos < Start + Length; pos++) {
            crc ^= Data[pos];
            for (i = 8; i != 0; i--) {
                if ((crc & 0x0001) != 0) {
                    crc >>= 1;
                    crc ^= 0xa001;
                }
                else {
                    crc >>= 1;
                }
            }
        }
        const ret = ((crc & 0x00ff) << 8) + ((crc & 0xff00) >> 8);
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
exports.GoodWeUdp = GoodWeUdp;
_a = GoodWeUdp;
function clampNumber(value, fallback, min, max) {
    if (value === undefined || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.floor(value)));
}
