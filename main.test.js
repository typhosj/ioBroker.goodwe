"use strict";

const assert = require("node:assert/strict");
const { optionalGroupConfigs, registerGroups } = require("./lib/register-map");
const {
  bitfields,
  decodeBitfield,
  decodeValue,
  valueStates,
} = require("./lib/status-definitions");

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
