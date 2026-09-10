"use strict";

import dgram from "node:dgram";
import os from "node:os";
import { clampNumber } from "./config";
import { errorMessage } from "./errors";

const GOODWE_PORT = 8899;
const DEFAULT_PROBE_TIMEOUT_MS = 700;
const DEFAULT_DISCOVERY_CONCURRENCY = 32;
const MIN_PROBE_TIMEOUT_MS = 100;
const MAX_PROBE_TIMEOUT_MS = 10000;
const MAX_DISCOVERY_SUBNETS = 4;

interface LoggerLike {
  debug?: (message: string) => void;
}

type IpValidation =
  | { valid: true; ip: string; octets: number[] }
  | { valid: false; reason: string };

interface IdInfo {
  firmwareVersion: string;
  modelName: string;
  serialNumber: string;
  nominalPvVoltage: number;
  internalVersion: string;
  safetyCountryCode: number;
}

interface ProbeResult {
  ip: string;
  reachable: boolean;
  idInfo?: Partial<IdInfo>;
  error?: string;
}

interface ProbeOptions {
  port?: number;
  timeoutMs?: number;
  log?: LoggerLike;
}

interface DiscoveryOptions {
  ip?: string;
  subnet?: string;
  timeoutMs?: number;
  concurrency?: number;
}

function validateIpv4Address(ip: unknown): IpValidation {
  if (typeof ip !== "string") {
    return { valid: false, reason: "IP address must be a string" };
  }

  const value = ip.trim();
  const parts = value.split(".");

  if (parts.length !== 4) {
    return { valid: false, reason: "IP address must contain four octets" };
  }

  const octets = [];

  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { valid: false, reason: "IP address contains non-numeric octets" };
    }

    if (part.length > 1 && part.startsWith("0")) {
      return { valid: false, reason: "IP address contains leading zeroes" };
    }

    const octet = Number(part);

    if (octet < 0 || octet > 255) {
      return { valid: false, reason: "IP address octets must be 0-255" };
    }

    octets.push(octet);
  }

  if (octets[0] === 0) {
    return { valid: false, reason: "0.0.0.0/8 is not a usable host address" };
  }

  if (octets[0] === 127) {
    return { valid: false, reason: "127.0.0.0/8 is localhost" };
  }

  if (octets[0] >= 224) {
    return {
      valid: false,
      reason: "multicast and reserved addresses are not usable host addresses",
    };
  }

  if (octets[0] === 169 && octets[1] === 254) {
    return {
      valid: false,
      reason: "169.254.0.0/16 link-local addresses are not supported",
    };
  }

  if (octets.every((octet) => octet === 255)) {
    return { valid: false, reason: "255.255.255.255 is a broadcast address" };
  }

  return { valid: true, ip: value, octets };
}

function extractIpv4Address(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const matches = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];

  for (const match of matches) {
    if (validateIpv4Address(match).valid) {
      return match;
    }
  }

  return "";
}

function buildIdInfoRequest(): Buffer {
  const data = Buffer.from([
    0xaa, 0x55, 0xc0, 0x7f, 0x01, 0x02, 0x00, 0x00, 0x00,
  ]);
  const checksum = checksum16(data, 0, data.length - 2);

  data[data.length - 2] = checksum >> 8;
  data[data.length - 1] = checksum & 0xff;

  return data;
}

function checksum16(data: Uint8Array, start: number, length: number): number {
  let checksum = 0;

  for (let index = start; index < start + length; index++) {
    checksum += data[index];
  }

  return checksum & 0xffff;
}

function isGoodWeIdInfoResponse(data: unknown): data is Uint8Array {
  if (!Buffer.isBuffer(data) && !(data instanceof Uint8Array)) {
    return false;
  }

  if (data.length < 73) {
    return false;
  }

  const expected = checksum16(data, 0, data.length - 2);
  const actual = (data[data.length - 2] << 8) + data[data.length - 1];

  return (
    actual === expected &&
    data[0] === 0xaa &&
    data[1] === 0x55 &&
    data[2] === 0x7f &&
    data[3] === 0xc0 &&
    data[4] === 0x01 &&
    data[5] === 0x82
  );
}

function parseIdInfoResponse(data: Uint8Array): IdInfo {
  if (!isGoodWeIdInfoResponse(data)) {
    throw new Error("Invalid GoodWe ID response");
  }

  return {
    firmwareVersion: readAscii(data, 7, 5),
    modelName: readAscii(data, 12, 10),
    serialNumber: readAscii(data, 38, 16),
    nominalPvVoltage: readUInt(data, 54, 4) / 10,
    internalVersion: readAscii(data, 58, 12),
    safetyCountryCode: data[70],
  };
}

function readAscii(data: Uint8Array, start: number, length: number): string {
  return Buffer.from(data.slice(start, start + length))
    .toString("ascii")
    .replace(/\0/g, "")
    .trim();
}

function readUInt(data: Uint8Array, start: number, length: number): number {
  let value = 0;

  for (let index = start; index < start + length; index++) {
    // Multiply instead of "<< 8": the shift would truncate to int32.
    value = value * 256 + data[index];
  }

  return value;
}

function probeGoodWeInverter(
  ip: string,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const validation = validateIpv4Address(ip);

  if (!validation.valid) {
    return Promise.resolve({
      ip,
      reachable: false,
      error: validation.reason,
    });
  }

  const port = options.port ?? GOODWE_PORT;
  const timeoutMs = clampProbeTimeout(options.timeoutMs);
  const request = buildIdInfoRequest();

  return new Promise((resolve) => {
    const client = dgram.createSocket("udp4");
    let done = false;
    const timeout = globalThis.setTimeout(() => {
      finish({
        ip: validation.ip,
        reachable: false,
        error: `No GoodWe response within ${timeoutMs} ms`,
      });
    }, timeoutMs);

    function finish(result: ProbeResult): void {
      if (done) {
        return;
      }

      done = true;
      globalThis.clearTimeout(timeout);
      try {
        client.close();
      } catch (error) {
        options.log?.debug?.(
          `UDP discovery socket close failed: ${errorMessage(error)}`,
        );
      }
      resolve(result);
    }

    client.once("message", (response: Buffer) => {
      if (!isGoodWeIdInfoResponse(response)) {
        finish({
          ip: validation.ip,
          reachable: false,
          error: "UDP response did not match GoodWe ID info format",
        });
        return;
      }

      finish({
        ip: validation.ip,
        reachable: true,
        idInfo: parseIdInfoResponse(response),
      });
    });

    client.once("error", (error: Error) => {
      finish({
        ip: validation.ip,
        reachable: false,
        error: error.message,
      });
    });

    client.send(request, port, validation.ip, (error: Error | null) => {
      if (error) {
        finish({
          ip: validation.ip,
          reachable: false,
          error: error.message,
        });
      }
    });
  });
}

async function discoverGoodWeInverters(
  options: DiscoveryOptions = {},
): Promise<{ searched: number; found: ProbeResult[] }> {
  const timeoutMs = clampProbeTimeout(options.timeoutMs);
  const concurrency = clampDiscoveryConcurrency(options.concurrency);
  const candidates = getDiscoveryCandidates(options);
  const found = [];

  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const results = await Promise.all(
      batch.map((ip) => probeGoodWeInverter(ip, { timeoutMs })),
    );

    for (const result of results) {
      if (result.reachable) {
        found.push(result);
      }
    }
  }

  return {
    searched: candidates.length,
    found,
  };
}

// Both take 0 and "" as "not set", so an admin form that sends an empty field
// gets the default instead of the smallest allowed value.
function clampProbeTimeout(value: unknown): number {
  return clampNumber(
    Number(value) || DEFAULT_PROBE_TIMEOUT_MS,
    DEFAULT_PROBE_TIMEOUT_MS,
    MIN_PROBE_TIMEOUT_MS,
    MAX_PROBE_TIMEOUT_MS,
  );
}

function clampDiscoveryConcurrency(value: unknown): number {
  return clampNumber(
    Number(value) || DEFAULT_DISCOVERY_CONCURRENCY,
    DEFAULT_DISCOVERY_CONCURRENCY,
    1,
    254,
  );
}

function getDiscoveryCandidates(options: DiscoveryOptions = {}): string[] {
  if (options.subnet) {
    return getIpv4CandidatesFromSubnet(options.subnet);
  }

  const subnets = new Set<string>();
  const validation = validateIpv4Address(options.ip);

  // Insertion order decides which subnets survive the cap, so the configured
  // address goes first - it is the one the user actually cares about.
  if (validation.valid) {
    subnets.add(getSubnetFromOctets(validation.octets));
  }

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const validation = validateIpv4Address(entry.address);

      if (entry.family === "IPv4" && !entry.internal && validation.valid) {
        subnets.add(getSubnetFromOctets(validation.octets));
      }
    }
  }

  // Container bridges and VPN adapters all count as external, so an unbounded
  // scan can mean thousands of probes for a host that has one real network.
  return Array.from(subnets)
    .slice(0, MAX_DISCOVERY_SUBNETS)
    .flatMap((subnet) => getIpv4CandidatesFromSubnet(subnet));
}

function getSubnetFromOctets(octets: number[]): string {
  return `${octets.slice(0, 3).join(".")}.0/24`;
}

function getIpv4CandidatesFromSubnet(subnet: string): string[] {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.0\/24$/.exec(subnet);

  if (!match) {
    return [];
  }

  const prefix = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
  const validation = validateIpv4Address(`${prefix}.1`);

  if (!validation.valid) {
    return [];
  }

  return Array.from({ length: 254 }, (_, index) => `${prefix}.${index + 1}`);
}

export type {
  DiscoveryOptions,
  IdInfo,
  IpValidation,
  ProbeOptions,
  ProbeResult,
};
export {
  GOODWE_PORT,
  buildIdInfoRequest,
  clampDiscoveryConcurrency,
  clampProbeTimeout,
  discoverGoodWeInverters,
  extractIpv4Address,
  getDiscoveryCandidates,
  getIpv4CandidatesFromSubnet,
  isGoodWeIdInfoResponse,
  parseIdInfoResponse,
  probeGoodWeInverter,
  validateIpv4Address,
};
