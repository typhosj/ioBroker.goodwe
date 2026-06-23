"use strict";

const assert = require("node:assert/strict");
const { optionalGroupConfigs, registerGroups } = require("./lib/register-map");
const {
  bitfields,
  decodeBitfield,
  decodeValue,
  valueStates,
} = require("./lib/status-definitions");
const {
  buildIdInfoRequest,
  clampDiscoveryConcurrency,
  extractIpv4Address,
  formatInverterOption,
  getIpv4CandidatesFromSubnet,
  isGoodWeIdInfoResponse,
  parseIdInfoResponse,
  validateIpv4Address,
} = require("./lib/goodwe-discovery");

describe("register map", () => {
  it("keeps all entries inside their request block", () => {
    for (const group of Object.values(registerGroups)) {
      for (const item of group.entries) {
        assert.ok(
          item.address >= group.start,
          `${item.state} is before ${group.name} start`,
        );
        assert.ok(
          item.address + item.registers <= group.start + group.count,
          `${item.state} exceeds ${group.name} block`,
        );
      }
    }
  });

  it("defines state and model paths for every register", () => {
    for (const group of Object.values(registerGroups)) {
      for (const item of group.entries) {
        assert.equal(typeof item.state, "string");
        assert.equal(typeof item.model, "string");
        assert.equal(typeof item.type, "string");
        assert.ok(item.state.includes("."));
      }
    }
  });

  it("contains the extended specification groups", () => {
    for (const groupName of [
      "deviceSimccid",
      "extComDataExtended",
      "flashInfo",
      "bmsInfoExtended",
      "bmsDetail",
      "ceiAutoTest",
      "powerLimit",
    ]) {
      assert.ok(registerGroups[groupName], `${groupName} is missing`);
      assert.ok(registerGroups[groupName].entries.length > 0);
    }
  });

  it("defines config switches for every optional group", () => {
    for (const groupName of Object.keys(optionalGroupConfigs)) {
      assert.ok(registerGroups[groupName], `${groupName} has no register group`);
      assert.match(optionalGroupConfigs[groupName], /^poll/);
    }
  });

  it("uses clean state names without legacy typos", () => {
    const runningStates = registerGroups.runningData.entries.map(
      (item) => item.state,
    );

    assert.equal(runningStates.includes("RunningData.ModulTemperature"), false);
    assert.ok(runningStates.includes("RunningData.ModuleTemperature"));
    assert.equal(runningStates.includes("RunningData.SaftyCountry"), false);
    assert.ok(runningStates.includes("RunningData.SafetyCountry"));
  });

  it("uses explicit units and sane roles", () => {
    const allowedRoles = new Set([
      "text",
      "value",
      "value.battery",
      "value.current",
      "value.energy",
      "value.frequency",
      "value.interval",
      "value.power",
      "value.temperature",
      "value.voltage",
    ]);
    const allowedUnits = new Set([
      undefined,
      "%",
      "A",
      "C",
      "Hz",
      "VA",
      "V",
      "W",
      "h",
      "kWh",
      "mV",
      "ms",
      "s",
      "var",
    ]);

    for (const group of Object.values(registerGroups)) {
      for (const item of group.entries) {
        assert.ok(allowedRoles.has(item.role), `${item.state} role ${item.role}`);
        assert.ok(allowedUnits.has(item.unit), `${item.state} unit ${item.unit}`);
      }
    }
  });
});

describe("status decoding", () => {
  it("decodes known enum values", () => {
    assert.equal(decodeValue(1, valueStates.gridStatus), "OK");
    assert.equal(decodeValue(4, valueStates.operationMode), "Battery");
  });

  it("marks unknown enum values", () => {
    assert.equal(decodeValue(99, valueStates.pvMode), "Unknown (99)");
  });

  it("decodes active bit names", () => {
    assert.deepEqual(decodeBitfield(0b101, bitfields.drmStatus), [
      "DRM0",
      "DRM2",
    ]);
  });
});

describe("GoodWe discovery helpers", () => {
  it("validates usable inverter IPv4 addresses", () => {
    assert.equal(validateIpv4Address("192.168.1.42").valid, true);
    assert.equal(validateIpv4Address("127.0.0.1").valid, false);
    assert.equal(validateIpv4Address("192.168.001.42").valid, false);
    assert.equal(validateIpv4Address("224.0.0.1").valid, false);
  });

  it("extracts an IPv4 address from display labels", () => {
    assert.equal(
      extractIpv4Address("192.168.178.29 | GW10KN-ET | SN 9010KETU231W1723"),
      "192.168.178.29",
    );
    assert.equal(extractIpv4Address("no inverter"), "");
  });

  it("creates /24 discovery candidates", () => {
    const candidates = getIpv4CandidatesFromSubnet("192.168.178.0/24");

    assert.equal(candidates.length, 254);
    assert.equal(candidates[0], "192.168.178.1");
    assert.equal(candidates[253], "192.168.178.254");
    assert.deepEqual(getIpv4CandidatesFromSubnet("192.168.178.0/16"), []);
  });

  it("clamps discovery concurrency values", () => {
    assert.equal(clampDiscoveryConcurrency(0), 32);
    assert.equal(clampDiscoveryConcurrency(-1), 1);
    assert.equal(clampDiscoveryConcurrency(999), 254);
    assert.equal(clampDiscoveryConcurrency(7.9), 7);
  });

  it("builds the GoodWe ID info request", () => {
    assert.deepEqual([...buildIdInfoRequest()], [
      0xaa,
      0x55,
      0xc0,
      0x7f,
      0x01,
      0x02,
      0x00,
      0x02,
      0x41,
    ]);
  });

  it("parses GoodWe ID info responses", () => {
    const response = buildIdInfoResponse();

    assert.equal(isGoodWeIdInfoResponse(response), true);
    assert.deepEqual(parseIdInfoResponse(response), {
      firmwareVersion: "01023",
      modelName: "GW10K-ET",
      serialNumber: "1234567890ABCDEF",
      nominalPvVoltage: 620,
      internalVersion: "ARM205-V1.7",
      safetyCountryCode: 3,
    });

    response[5] = 0x81;
    assert.equal(isGoodWeIdInfoResponse(response), false);
  });

  it("formats discovered inverters as admin select options", () => {
    assert.deepEqual(
      formatInverterOption({
        ip: "192.168.178.42",
        reachable: true,
        idInfo: {
          modelName: "GW10K-ET",
          serialNumber: "1234567890ABCDEF",
          firmwareVersion: "01023",
          internalVersion: "ARM205-V1.7",
        },
      }),
      {
        value: "192.168.178.42",
        label:
          "192.168.178.42 | GW10K-ET | SN 1234567890ABCDEF | FW 01023 | ARM205-V1.7",
      },
    );
  });

  it("omits implausible firmware text from admin select options", () => {
    assert.deepEqual(
      formatInverterOption({
        ip: "192.168.178.29",
        reachable: true,
        idInfo: {
          modelName: "GW10KN-ET",
          serialNumber: "9010KETU231W1723",
          firmwareVersion: "0<0<M",
        },
      }),
      {
        value: "192.168.178.29",
        label: "192.168.178.29 | GW10KN-ET | SN 9010KETU231W1723",
      },
    );
  });
});

function buildIdInfoResponse() {
  const response = Buffer.alloc(73);

  response[0] = 0xaa;
  response[1] = 0x55;
  response[2] = 0x7f;
  response[3] = 0xc0;
  response[4] = 0x01;
  response[5] = 0x82;
  writeAscii(response, 7, 5, "01023");
  writeAscii(response, 12, 10, "GW10K-ET");
  writeAscii(response, 38, 16, "1234567890ABCDEF");
  response.writeUInt32BE(6200, 54);
  writeAscii(response, 58, 12, "ARM205-V1.7");
  response[70] = 3;

  const checksum = response
    .slice(0, response.length - 2)
    .reduce((total, value) => total + value, 0);
  response[response.length - 2] = checksum >> 8;
  response[response.length - 1] = checksum & 0xff;

  return response;
}

function writeAscii(buffer, start, length, value) {
  buffer.write(value.slice(0, length), start, length, "ascii");
}
