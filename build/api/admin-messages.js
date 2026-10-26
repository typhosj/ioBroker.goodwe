"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAdapterMessage = handleAdapterMessage;
exports.probeModbusTcp = probeModbusTcp;
const GoodWe_1 = require("../GoodWe/GoodWe");
const config_1 = require("../lib/config");
const errors_1 = require("../lib/errors");
const goodwe_discovery_1 = require("../lib/goodwe-discovery");
async function handleAdapterMessage(adapter, obj) {
    if (!obj?.command) {
        return;
    }
    const respond = (payload) => {
        if (obj.callback) {
            adapter.sendTo(obj.from, obj.command, payload, obj.callback);
        }
    };
    // The form may not be saved yet, so its transport wins over the stored one.
    // Only that transport is probed: the TCP probe sends register reads to every
    // device listening on port 502, and some of them serve a single client only.
    const probe = (0, config_1.normalizeTransport)(obj.message?.transport ?? adapter.config.transport) ===
        "tcp"
        ? (ip, timeoutMs) => probeModbusTcp(adapter, ip, timeoutMs)
        : (ip, timeoutMs) => (0, goodwe_discovery_1.probeGoodWeInverter)(ip, { timeoutMs });
    try {
        switch (obj.command) {
            case "validateIp": {
                const ip = getConfiguredIp(adapter, obj.message?.ip);
                const validation = (0, goodwe_discovery_1.validateIpv4Address)(ip);
                if (!validation.valid) {
                    respond({
                        valid: false,
                        reachable: false,
                        error: validation.reason,
                    });
                    return;
                }
                const result = await probe(validation.ip, (0, goodwe_discovery_1.clampProbeTimeout)(obj.message?.timeoutMs));
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
                const result = await (0, goodwe_discovery_1.discoverGoodWeInverters)({
                    ip: getConfiguredIp(adapter, obj.message?.ip),
                    subnet: getConfiguredSubnet(adapter, obj.message?.subnet),
                    timeoutMs: (0, goodwe_discovery_1.clampProbeTimeout)(obj.message?.timeoutMs),
                    concurrency: Number(obj.message?.concurrency) || undefined,
                    log: adapter.log,
                    probe,
                });
                respond(result);
                return;
            }
            default:
                respond({ error: `Unknown command: ${obj.command}` });
        }
    }
    catch (error) {
        respond({ error: (0, errors_1.errorMessage)(error) });
    }
}
/**
 * Checks that a GoodWe inverter answers over Modbus TCP and reads its model
 * and serial number from the device info block.
 *
 * A separate client, not the polling one: the check runs for an address the
 * form may not have saved yet. Other Modbus devices on port 502 either reject
 * register 35000 or return no printable serial number there, so they are not
 * reported as inverters.
 *
 * @param logHost logger source
 * @param logHost.log adapter logger
 * @param ip validated address
 * @param timeoutMs answer timeout
 * @param port Modbus TCP port, only tests pass another one
 */
async function probeModbusTcp(logHost, ip, timeoutMs, port = config_1.transportPorts.tcp) {
    const inverter = new GoodWe_1.GoodWeUdp(logHost, "tcp");
    const options = { optional: true, backoff: false };
    try {
        if (!(await inverter.Connect(ip, port, {
            timeoutMs,
            retries: 0,
            transport: "tcp",
        })) ||
            !(await inverter.ReadGroup("deviceInfo", options))) {
            return {
                ip,
                reachable: false,
                error: `No Modbus TCP answer from ${ip}:${port}`,
            };
        }
        const { DeviceType, SerialNumber, ARM_IntFirmwareVersion } = inverter.DeviceInfo;
        if (!/^[\x21-\x7e]+$/.test(SerialNumber)) {
            return {
                ip,
                reachable: false,
                error: `${ip}:${port} is no GoodWe inverter`,
            };
        }
        return {
            ip,
            reachable: true,
            transport: "tcp",
            idInfo: {
                modelName: DeviceType,
                serialNumber: SerialNumber,
                internalVersion: ARM_IntFirmwareVersion,
            },
        };
    }
    finally {
        inverter.destructor();
    }
}
function getConfiguredIp(adapter, messageIp) {
    const ipFromMessage = (0, goodwe_discovery_1.extractIpv4Address)(messageIp);
    if (ipFromMessage !== "") {
        return ipFromMessage;
    }
    return (0, goodwe_discovery_1.extractIpv4Address)(adapter.config.ipAddr);
}
function getConfiguredSubnet(adapter, messageSubnet) {
    if (typeof messageSubnet === "string" && messageSubnet.trim() !== "") {
        return messageSubnet.trim();
    }
    if (typeof adapter.config.discoverySubnet === "string" &&
        adapter.config.discoverySubnet.trim() !== "") {
        return adapter.config.discoverySubnet.trim();
    }
    return undefined;
}
