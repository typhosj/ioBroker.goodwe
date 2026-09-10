"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoodWeUdp = exports.GoodweBmSInfo = exports.GoodWeExternalComData = exports.GoodWeMeterPhase = exports.GoodWeDeviceInfo = exports.GoodWeRegister = void 0;
const node_dgram_1 = __importDefault(require("node:dgram"));
const config_1 = require("../lib/config");
const errors_1 = require("../lib/errors");
const goodwe_discovery_1 = require("../lib/goodwe-discovery");
const register_map_1 = require("../lib/register-map");
class GoodWeRegister {
    static Format = { Frame: 5, CRC16: 2 };
    static RecvHeader = { High: 0xaa, Low: 0x55 };
    static Addr = { Inverter: 0xf7 };
    static FcCode = {
        Read: 0x03,
        WriteSingleRegister: 0x06,
    };
    // Header, address, function code, register address and value, without CRC.
    static WriteResponse = { Length: 10 };
    // Header, address, function code, exception code and CRC.
    static ExceptionResponse = { Length: 7, FcFlag: 0x80 };
}
exports.GoodWeRegister = GoodWeRegister;
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
    #client;
    #pendingRequests = [];
    #optionalGroupBackoffUntil = new Map();
    #timeoutMs = _a.DefaultTimeoutMs;
    #retries = _a.DefaultRetries;
    #closed = false;
    // Serializes every UDP request. The protocol has no transaction id, so two
    // requests in flight at once can only be told apart by function code and
    // payload length - and a timeout of one rebinds the socket of the other.
    #queue = Promise.resolve();
    #deviceInfo = new GoodWeDeviceInfo();
    #runningData = new GoodWeRunningData();
    #extComData = new GoodWeExternalComData();
    #bmsInfo = new GoodweBmSInfo();
    #flashInfo = {};
    #bmsDetail = {};
    #ceiAutoTest = {};
    #powerLimit = {};
    #settings = {};
    #logHost;
    // The adapter assigns its logger asynchronously after the constructor runs,
    // so a class field capturing adapter.log stores undefined and every log call
    // in a socket callback throws. Resolve the logger per call instead.
    get log() {
        return this.#logHost.log;
    }
    /**
     * @param logHost object exposing the logger, usually the adapter instance
     * @param logHost.log adapter logger, may be assigned after construction
     */
    constructor(logHost) {
        this.#logHost = logHost;
        this.#client = this.#createSocket();
    }
    #createSocket() {
        const client = node_dgram_1.default.createSocket("udp4");
        client.on("message", (rcvbuf) => this.#handleMessage(rcvbuf));
        client.on("error", (error) => {
            this.#status = _a.ConStatus.Offline;
            this.log.warn(`UDP socket error: ${error.message}`);
        });
        return client;
    }
    // The register protocol has no transaction id and the matcher can only check
    // function code plus payload length, so a late answer to a timed out request
    // would silently resolve the next request that reads the same number of
    // registers (flashInfo and powerLimit both read 14). Rebinding after a
    // timeout gives the next request a fresh source port, so answers to the
    // abandoned one can no longer reach it.
    #resetSocket() {
        this.#closeSocket();
        // After destructor() a rebind would resurrect the socket the adapter just
        // released, so a queued request must not create a new one.
        if (!this.#closed) {
            this.#client = this.#createSocket();
        }
    }
    #closeSocket() {
        const previous = this.#client;
        previous.removeAllListeners();
        try {
            previous.close();
        }
        catch {
            // Already closed or never bound - nothing to release.
        }
    }
    destructor() {
        this.#closed = true;
        for (const request of this.#pendingRequests.splice(0)) {
            this.#clearPendingRequest(request);
            request.reject(new Error("Socket closed"));
        }
        this.#closeSocket();
    }
    Connect(IpAddr, Port, options = {}) {
        this.#ipAddr = IpAddr;
        this.#port = Port;
        this.#timeoutMs = (0, config_1.clampNumber)(options.timeoutMs, _a.DefaultTimeoutMs, 1000, 30000);
        this.#retries = (0, config_1.clampNumber)(options.retries, _a.DefaultRetries, 0, 5);
        return this.ReadIdInfo();
    }
    #handleMessage(rcvbuf) {
        const requestIndex = this.#pendingRequests.findIndex((request) => request.matcher(rcvbuf) || request.exception(rcvbuf) !== null);
        if (requestIndex === -1) {
            // Head and waiting requests, because the 1024 byte frames seen at night
            // arrive 1255 ms after a RunningData request and are the only lead on
            // whether this is a rejected answer or foreign traffic on the port.
            this.log.debug?.(`Ignoring unmatched UDP frame (${rcvbuf.length} bytes, pending: ${this.#pendingRequests.map((request) => request.name).join(",") || "none"}): ${rcvbuf.subarray(0, 16).toString("hex")}`);
            return;
        }
        const [request] = this.#pendingRequests.splice(requestIndex, 1);
        const exceptionCode = request.exception(rcvbuf);
        this.#clearPendingRequest(request);
        if (exceptionCode !== null) {
            request.reject(new errors_1.ModbusExceptionError(request.name, exceptionCode));
            return;
        }
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
    /**
     * Queues a request so only one is ever in flight.
     *
     * @param sendbuf request frame
     * @param matcher accepts the answer belonging to this request
     * @param name request name, used for logging and error messages
     * @param exception reads the Modbus exception code out of a rejection frame
     */
    #request(sendbuf, matcher, name, exception = () => null) {
        const run = () => this.#requestNow(sendbuf, matcher, name, exception);
        const next = this.#queue.then(run, run);
        this.#queue = next.catch(() => undefined);
        return next;
    }
    async #requestNow(sendbuf, matcher, name, exception) {
        let lastError;
        if (this.#closed) {
            throw new Error("Socket closed");
        }
        for (let attempt = 0; attempt <= this.#retries; attempt++) {
            try {
                const response = await new Promise((resolve, reject) => {
                    const request = {
                        name,
                        matcher,
                        exception,
                        resolve,
                        reject,
                        timeout: null,
                    };
                    const timeout = globalThis.setTimeout(() => {
                        const requestIndex = this.#pendingRequests.indexOf(request);
                        if (requestIndex !== -1) {
                            this.#pendingRequests.splice(requestIndex, 1);
                        }
                        this.#resetSocket();
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
                // A rejection is an answer: the inverter is reachable, and repeating a
                // request it declined only costs another timeout.
                if (error instanceof errors_1.ModbusExceptionError) {
                    this.#status = _a.ConStatus.Online;
                    throw error;
                }
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
        sendbuf[1] = GoodWeRegister.FcCode.Read;
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
        const rcvbuf = await this.#request(sendbuf, (data) => this.#CheckRecRegisterData(data, sendbuf[1], sendbuf[5]), group.name, (data) => this.#ExceptionCode(data, sendbuf[1]));
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
        // The group names the getter holding its values, and every getter hands out
        // the object itself, so parsing into it updates what states.ts reads later.
        const target = group
            ? this[group.target]
            : undefined;
        if (!group || !target) {
            this.log.warn(`Unknown register group: ${groupName}`);
            return false;
        }
        if (isOptional && backoffUntil > Date.now()) {
            return false;
        }
        const previousStatus = this.#status;
        try {
            await this.#readRegisterGroup(group, target);
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
                this.log.debug?.(`${group.name}: ${(0, errors_1.errorMessage)(error)}`);
                return false;
            }
            this.log.warn(`${group.name}: ${(0, errors_1.errorMessage)(error)}`);
            return false;
        }
    }
    #buildWriteRegisterRequest(address, value) {
        const sendbuf = new Uint8Array(8);
        sendbuf[0] = GoodWeRegister.Addr.Inverter;
        sendbuf[1] = GoodWeRegister.FcCode.WriteSingleRegister;
        sendbuf[2] = address >> 8;
        sendbuf[3] = address & 0x00ff;
        sendbuf[4] = value >> 8;
        sendbuf[5] = value & 0x00ff;
        const crc = this.#CalculatetCrc16(sendbuf, 0, 6);
        sendbuf[6] = crc >> 8;
        sendbuf[7] = crc & 0x00ff;
        return sendbuf;
    }
    /**
     * Writes a single holding register and waits for the inverter to echo it.
     *
     * @param address register address
     * @param value register value, already clamped by the caller
     */
    async WriteRegister(address, value) {
        const sendbuf = this.#buildWriteRegisterRequest(address, value);
        try {
            await this.#request(sendbuf, (data) => this.#CheckRecWriteData(data, address, value), `WriteRegister ${address}`, (data) => this.#ExceptionCode(data, sendbuf[1]));
            return true;
        }
        catch (error) {
            this.log.warn(`WriteRegister ${address}: ${(0, errors_1.errorMessage)(error)}`);
            return false;
        }
    }
    /**
     * Asks the inverter for its ID info and uses the answer as a liveness check.
     *
     * The parsed fields are not surfaced as states, so the frame is only built
     * and validated - both with the helpers the admin discovery already uses.
     */
    async ReadIdInfo() {
        const wasOnline = this.#status === _a.ConStatus.Online;
        try {
            await this.#request((0, goodwe_discovery_1.buildIdInfoRequest)(), (data) => (0, goodwe_discovery_1.isGoodWeIdInfoResponse)(data), "ReadIdInfo");
            return true;
        }
        catch (error) {
            // Only the transition to offline is worth a warning; the scheduler keeps
            // retrying and would otherwise fill the log every reconnect attempt.
            if (wasOnline) {
                this.log.warn(`ReadIdInfo: ${(0, errors_1.errorMessage)(error)}`);
            }
            else {
                this.log.debug?.(`ReadIdInfo: ${(0, errors_1.errorMessage)(error)}`);
            }
            return false;
        }
    }
    /**
     * Reads the Modbus exception code out of a rejection frame.
     *
     * A rejected request is answered with the function code plus 0x80 instead of
     * the expected payload. Without this the frame matches no request and the
     * caller waits out the full timeout of every retry before it learns anything.
     *
     * @param Data received frame
     * @param FctCode function code of the request
     */
    #ExceptionCode(Data, FctCode) {
        // Padded datagrams reach this check too, so the fixed frame length decides,
        // not the datagram length.
        if (Data.length < GoodWeRegister.ExceptionResponse.Length) {
            return null;
        }
        const crc = this.#CalculatetCrc16(Data, 2, GoodWeRegister.ExceptionResponse.Length - GoodWeRegister.Format.CRC16 - 2);
        if (Data[0] !== GoodWeRegister.RecvHeader.High ||
            Data[1] !== GoodWeRegister.RecvHeader.Low ||
            Data[2] !== GoodWeRegister.Addr.Inverter ||
            Data[3] !== (FctCode | GoodWeRegister.ExceptionResponse.FcFlag) ||
            Data[5] !== crc >> 8 ||
            Data[6] !== (crc & 0x00ff)) {
            return null;
        }
        return Data[4];
    }
    // A write answer is a fixed length echo of the request, so it carries no
    // payload length byte the generic register check could use.
    #CheckRecWriteData(Data, address, value) {
        if (Data.length < GoodWeRegister.WriteResponse.Length) {
            return false;
        }
        const crc = this.#CalculatetCrc16(Data, 2, GoodWeRegister.WriteResponse.Length - GoodWeRegister.Format.CRC16 - 2);
        return (Data[0] === GoodWeRegister.RecvHeader.High &&
            Data[1] === GoodWeRegister.RecvHeader.Low &&
            Data[2] === GoodWeRegister.Addr.Inverter &&
            Data[3] === GoodWeRegister.FcCode.WriteSingleRegister &&
            Data[4] === address >> 8 &&
            Data[5] === (address & 0x00ff) &&
            Data[6] === value >> 8 &&
            Data[7] === (value & 0x00ff) &&
            Data[8] === crc >> 8 &&
            Data[9] === (crc & 0x00ff));
    }
    #CheckRecRegisterData(Data, FctCode, Length) {
        // The dongle pads: the 257 byte running data answer arrives in a 1024 byte
        // datagram. Reading the CRC from the end of the datagram then fails and the
        // request runs into its timeout although the answer is right there - 63
        // times in 16.5 hours, every single one of them followed by a retry. So the
        // frame length comes from the request, not from the datagram, and trailing
        // bytes are ignored the same way #CheckRecWriteData already ignores them.
        const frameLength = GoodWeRegister.Format.Frame + Length * 2 + GoodWeRegister.Format.CRC16;
        if (Data.length < frameLength) {
            return false;
        }
        const registerFrame = Data.slice(0, GoodWeRegister.Format.Frame);
        const registerCrc = Data.slice(frameLength - GoodWeRegister.Format.CRC16, frameLength);
        const crc = this.#CalculatetCrc16(Data, 2, frameLength - GoodWeRegister.Format.CRC16 - 2);
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
        // readUIntBE, not a shift loop: "<< 8" truncates to int32, so U32 registers
        // with bit 31 set would be reported as negative values.
        return Buffer.from(Data.slice(Start, Start + Length)).readUIntBE(0, Length);
    }
    #GetIntFromByteArray(Data, Start, Length) {
        return Buffer.from(Data.slice(Start, Start + Length)).readIntBE(0, Length);
    }
    #GetFloatFromByteArray(Data, Start, Length) {
        return Buffer.from(Data.slice(Start, Start + Length)).readFloatBE(0);
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
    get Settings() {
        return this.#settings;
    }
}
exports.GoodWeUdp = GoodWeUdp;
_a = GoodWeUdp;
