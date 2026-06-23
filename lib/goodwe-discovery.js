"use strict";

const dgram = require("dgram");
const os = require("os");

const GOODWE_PORT = 8899;
const DEFAULT_PROBE_TIMEOUT_MS = 700;
const DEFAULT_DISCOVERY_CONCURRENCY = 32;

function validateIpv4Address(ip) {
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

function buildIdInfoRequest() {
  const data = Buffer.from([
    0xaa, 0x55, 0xc0, 0x7f, 0x01, 0x02, 0x00, 0x00, 0x00,
  ]);
  const checksum = checksum16(data, 0, data.length - 2);

  data[data.length - 2] = checksum >> 8;
  data[data.length - 1] = checksum & 0xff;

  return data;
}

function checksum16(data, start, length) {
  let checksum = 0;

  for (let index = start; index < start + length; index++) {
    checksum += data[index];
  }

  return checksum & 0xffff;
}

function isGoodWeIdInfoResponse(data) {
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

function parseIdInfoResponse(data) {
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

function readAscii(data, start, length) {
  return Buffer.from(data.slice(start, start + length))
    .toString("ascii")
    .replace(/\0/g, "")
    .trim();
}

function readUInt(data, start, length) {
  let value = 0;

  for (let index = start; index < start + length; index++) {
    value = (value << 8) + data[index];
  }

  return value;
}

function probeGoodWeInverter(ip, options = {}) {
  const validation = validateIpv4Address(ip);

  if (!validation.valid) {
    return Promise.resolve({
      ip,
      reachable: false,
      error: validation.reason,
    });
  }

  const port = options.port ?? GOODWE_PORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const request = buildIdInfoRequest();

  return new Promise((resolve) => {
    const client = dgram.createSocket("udp4");
    let done = false;

    const finish = (result) => {
      if (done) {
        return;
      }

      done = true;
      clearTimeout(timeout);
      try {
        client.close();
      } catch {
        // The socket can already be closed after early send errors.
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({
        ip: validation.ip,
        reachable: false,
        error: `No GoodWe response within ${timeoutMs} ms`,
      });
    }, timeoutMs);

    client.once("message", (response) => {
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

    client.once("error", (error) => {
      finish({
        ip: validation.ip,
        reachable: false,
        error: error.message,
      });
    });

    client.send(request, port, validation.ip, (error) => {
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

async function discoverGoodWeInverters(options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_DISCOVERY_CONCURRENCY;
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

function formatInverterOption(result) {
  const idInfo = result.idInfo ?? {};
  const firmwareVersion = isPlausibleVersionText(idInfo.firmwareVersion)
    ? idInfo.firmwareVersion
    : undefined;
  const labelParts = [
    result.ip,
    idInfo.modelName,
    idInfo.serialNumber ? `SN ${idInfo.serialNumber}` : undefined,
    firmwareVersion ? `FW ${firmwareVersion}` : undefined,
    idInfo.internalVersion,
  ].filter(Boolean);

  return {
    value: result.ip,
    label: labelParts.join(" | "),
  };
}

function isPlausibleVersionText(value) {
  return typeof value === "string" && /^[A-Za-z0-9._-]{2,20}$/.test(value);
}

function getDiscoveryCandidates(options = {}) {
  if (options.subnet) {
    return getIpv4CandidatesFromSubnet(options.subnet);
  }

  const subnets = new Set();
  const validation = validateIpv4Address(options.ip);

  if (validation.valid) {
    subnets.add(getSubnetFromOctets(validation.octets ?? []));
  }

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const validation = validateIpv4Address(entry.address);

      if (entry.family === "IPv4" && !entry.internal && validation.valid) {
        subnets.add(getSubnetFromOctets(validation.octets ?? []));
      }
    }
  }

  return Array.from(subnets).flatMap((subnet) =>
    getIpv4CandidatesFromSubnet(subnet),
  );
}

function getSubnetFromOctets(octets) {
  return `${octets.slice(0, 3).join(".")}.0/24`;
}

function getIpv4CandidatesFromSubnet(subnet) {
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

module.exports = {
  GOODWE_PORT,
  buildIdInfoRequest,
  discoverGoodWeInverters,
  formatInverterOption,
  getDiscoveryCandidates,
  getIpv4CandidatesFromSubnet,
  isGoodWeIdInfoResponse,
  parseIdInfoResponse,
  probeGoodWeInverter,
  validateIpv4Address,
};
