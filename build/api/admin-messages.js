"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAdapterMessage = handleAdapterMessage;
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
                const result = await (0, goodwe_discovery_1.probeGoodWeInverter)(validation.ip, {
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
                const result = await (0, goodwe_discovery_1.discoverGoodWeInverters)({
                    ip: getConfiguredIp(adapter, obj.message?.ip),
                    subnet: getConfiguredSubnet(adapter, obj.message?.subnet),
                    timeoutMs: Number(obj.message?.timeoutMs) || 700,
                    concurrency: Number(obj.message?.concurrency) || undefined,
                });
                respond(result);
                return;
            }
            default:
                respond({ error: `Unknown command: ${obj.command}` });
        }
    }
    catch (error) {
        respond({ error: error.message ?? String(error) });
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
