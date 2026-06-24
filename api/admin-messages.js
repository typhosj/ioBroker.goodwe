"use strict";

const {
  discoverGoodWeInverters,
  extractIpv4Address,
  probeGoodWeInverter,
  validateIpv4Address,
} = require("../lib/goodwe-discovery");

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
  } catch (error) {
    respond({ error: error.message ?? String(error) });
  }
}

function getConfiguredIp(adapter, messageIp) {
  const ipFromMessage = extractIpv4Address(messageIp);

  if (ipFromMessage !== "") {
    return ipFromMessage;
  }

  return extractIpv4Address(adapter.config.ipAddr);
}

function getConfiguredSubnet(adapter, messageSubnet) {
  if (typeof messageSubnet === "string" && messageSubnet.trim() !== "") {
    return messageSubnet.trim();
  }

  if (
    typeof adapter.config.discoverySubnet === "string" &&
    adapter.config.discoverySubnet.trim() !== ""
  ) {
    return adapter.config.discoverySubnet.trim();
  }

  return undefined;
}

module.exports = {
  handleAdapterMessage,
};
