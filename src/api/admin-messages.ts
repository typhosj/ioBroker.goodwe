"use strict";

import { GoodWeUdp } from "../GoodWe/GoodWe";
import { normalizeTransport, transportPorts } from "../lib/config";
import { errorMessage } from "../lib/errors";
import {
  clampProbeTimeout,
  discoverGoodWeInverters,
  extractIpv4Address,
  type Probe,
  probeGoodWeInverter,
  type ProbeResult,
  validateIpv4Address,
} from "../lib/goodwe-discovery";

type AdapterMessage = ioBroker.Message;

interface MessageAdapter {
  config: ioBroker.AdapterConfig;
  log: ioBroker.Logger;
  sendTo: (
    instanceName: string,
    command: string,
    message: Record<string, unknown>,
    callback?: ioBroker.MessageCallback | ioBroker.MessageCallbackInfo,
  ) => void;
}

async function handleAdapterMessage(
  adapter: MessageAdapter,
  obj: AdapterMessage,
): Promise<void> {
  if (!obj?.command) {
    return;
  }

  const respond = (payload: Record<string, unknown>): void => {
    if (obj.callback) {
      adapter.sendTo(obj.from, obj.command, payload, obj.callback);
    }
  };

  // The form may not be saved yet, so its transport wins over the stored one.
  // Only that transport is probed: the TCP probe sends register reads to every
  // device listening on port 502, and some of them serve a single client only.
  const probe: Probe =
    normalizeTransport(obj.message?.transport ?? adapter.config.transport) ===
    "tcp"
      ? (ip, timeoutMs) => probeModbusTcp(adapter, ip, timeoutMs)
      : (ip, timeoutMs) => probeGoodWeInverter(ip, { timeoutMs });

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

        const result = await probe(
          validation.ip,
          clampProbeTimeout(obj.message?.timeoutMs),
        );

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
          timeoutMs: clampProbeTimeout(obj.message?.timeoutMs),
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
  } catch (error) {
    respond({ error: errorMessage(error) });
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
async function probeModbusTcp(
  logHost: { log: ioBroker.Logger },
  ip: string,
  timeoutMs: number,
  port = transportPorts.tcp,
): Promise<ProbeResult> {
  const inverter = new GoodWeUdp(logHost, "tcp");
  const options = { optional: true, backoff: false };

  try {
    if (
      !(await inverter.Connect(ip, port, {
        timeoutMs,
        retries: 0,
        transport: "tcp",
      })) ||
      !(await inverter.ReadGroup("deviceInfo", options))
    ) {
      return {
        ip,
        reachable: false,
        error: `No Modbus TCP answer from ${ip}:${port}`,
      };
    }

    const { DeviceType, SerialNumber, ARM_IntFirmwareVersion } =
      inverter.DeviceInfo;

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
  } finally {
    inverter.destructor();
  }
}

function getConfiguredIp(adapter: MessageAdapter, messageIp: unknown): string {
  const ipFromMessage = extractIpv4Address(messageIp);

  if (ipFromMessage !== "") {
    return ipFromMessage;
  }

  return extractIpv4Address(adapter.config.ipAddr);
}

function getConfiguredSubnet(
  adapter: MessageAdapter,
  messageSubnet: unknown,
): string | undefined {
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

export type { AdapterMessage, MessageAdapter };
export { handleAdapterMessage, probeModbusTcp };
