"use strict";

import assert from "node:assert/strict";
import EventEmitter from "node:events";
import net from "node:net";
import proxyquire from "proxyquire";
import {
  clampPollCycle,
  GoodWePollScheduler,
  PollScheduler,
} from "../src/scheduler";
import GoodWeStateManager from "../src/states";
import {
  optionalGroupConfigs,
  type RegisterEntry,
  type RegisterGroup,
  registerGroupOfState,
  registerGroups,
  TYPE,
  writableEntries,
  writableGroups,
} from "../src/lib/register-map";
import {
  applyControlWrite,
  clampWriteValue,
  stripNamespace,
  writableStateIds,
} from "../src/lib/control";
import { bitfields, decodeBitfield } from "../src/lib/status-definitions";
import {
  booleanDefaults,
  normalizeBoolean,
  normalizeBooleanConfig,
  normalizeTransport,
} from "../src/lib/config";
import {
  buildIdInfoRequest,
  clampDiscoveryConcurrency,
  clampProbeTimeout,
  extractIpv4Address,
  getIpv4CandidatesFromSubnet,
  isGoodWeIdInfoResponse,
  parseIdInfoResponse,
  validateIpv4Address,
} from "../src/lib/goodwe-discovery";
import {
  getDecodedBmsStatuses,
  getDecodedRunningStatuses,
} from "../src/mappers/status-mapper";
import { probeModbusTcp } from "../src/api/admin-messages";
import type * as AdminMessages from "../src/api/admin-messages";
import type { GoodWeUdp } from "../src/GoodWe/GoodWe";
import type * as DiscoveryTypes from "../src/lib/goodwe-discovery";

type StateAdapterLike = ConstructorParameters<typeof GoodWeStateManager>[0];
type SchedulerAdapterLike = ConstructorParameters<typeof PollScheduler>[0];

interface StateWrite {
  id: string;
  value: ioBroker.StateValue;
  ack: boolean;
}

interface ObjectWrite {
  id: string;
  object: ioBroker.SettableObject;
}

function noop(): void {}

const testLogger = {
  level: "debug",
  silly: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
} as unknown as ioBroker.Logger;

const testConfig: ioBroker.AdapterConfig = {
  ipAddr: "192.168.178.42",
  transport: "udp",
  discoverySubnet: "192.168.178.0/24",
  pollCycle: 10,
  timeoutMs: 5000,
  retries: 3,
  pollExtended: true,
  pollSimccid: false,
  pollExtendedMeter: false,
  pollFlashInfo: false,
  pollBmsExtended: false,
  pollBmsDetail: false,
  pollCeiAutoTest: false,
  pollPowerLimit: false,
  pollSettings: true,
  enableControl: false,
};

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
      "settingsBattery",
      "settingsEms",
    ]) {
      assert.ok(registerGroups[groupName], `${groupName} is missing`);
      assert.ok(registerGroups[groupName].entries.length > 0);
    }
  });

  it("marks only the documented control registers as writable", () => {
    assert.deepEqual(Array.from(writableEntries.keys()).sort(), [
      "Settings.Battery.ChargeCurrent",
      "Settings.Battery.DischargeDepth",
      "Settings.Battery.DischargeDepthOffline",
      "Settings.EmsMode",
      "Settings.EmsPowerLimit",
      "Settings.GridExportEnabled",
      "Settings.GridExportLimit",
    ]);

    for (const entry of writableEntries.values()) {
      // A multi register write would need an encoder, so the control path only
      // accepts values that fit into a single register.
      assert.equal(entry.registers, 1, `${entry.state} spans registers`);
      assert.ok(entry.writable && entry.writable.min < entry.writable.max);
    }
  });

  it("finds the register group of a state", () => {
    assert.equal(registerGroupOfState("Settings.EmsMode"), "settingsEms");
    assert.equal(registerGroupOfState("RunningData.GridMode"), "runningData");
    assert.equal(registerGroupOfState("Settings.Unknown"), "");
  });

  it("defines config switches for every optional group", () => {
    for (const groupName of Object.keys(optionalGroupConfigs)) {
      assert.ok(
        registerGroups[groupName],
        `${groupName} has no register group`,
      );
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

  it("defines enum labels directly on numeric mode states", () => {
    const runningEntries = new Map(
      registerGroups.runningData.entries.map((item) => [item.state, item]),
    );

    assert.equal(runningEntries.get("RunningData.GridMode")?.states?.[1], "OK");
    assert.equal(
      runningEntries.get("RunningData.OperationMode")?.states?.[4],
      "Battery",
    );
    assert.equal(
      runningEntries.get("RunningData.PV1.Mode")?.states?.[2],
      "Work",
    );
    assert.equal(
      runningEntries.get("RunningData.Battery1.Mode")?.states?.[3],
      "Charging",
    );
    assert.equal(
      runningEntries.get("RunningData.BackUpL1.Mode")?.states?.[0],
      "ON",
    );
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
      "Ah",
      "°C",
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
        assert.ok(
          allowedRoles.has(item.role),
          `${item.state} role ${item.role}`,
        );
        assert.ok(
          allowedUnits.has(item.unit),
          `${item.state} unit ${item.unit}`,
        );
      }
    }
  });
});

describe("status decoding", () => {
  it("decodes active bit names", () => {
    assert.deepEqual(decodeBitfield(0b101, bitfields.drmStatus), [
      "DRM0",
      "DRM2",
    ]);
  });

  it("decodes the diagnostic status bits up to bit 30", () => {
    assert.deepEqual(
      decodeBitfield(2 ** 29 + 2 ** 30, bitfields.diagnosticStatus),
      ["Discharge mode for BP", "BMSEmergencyCharging"],
    );
    assert.deepEqual(decodeBitfield(2 ** 31, bitfields.diagnosticStatus), []);
    assert.deepEqual(decodeBitfield(0, bitfields.diagnosticStatus), []);
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

  it("scans the configured network first and at most four networks", () => {
    const debug: string[] = [];
    const nic = (address: string, internal = false): object => ({
      address,
      family: "IPv4",
      internal,
    });
    const { getDiscoveryCandidates } = proxyquire(
      "../src/lib/goodwe-discovery",
      {
        "node:os": {
          networkInterfaces: () => ({
            // Windows lists Hyper-V and WSL adapters before the LAN.
            hyperv: [nic("172.20.1.1"), nic("172.21.1.1")],
            wsl: [nic("172.22.1.1"), nic("172.23.1.1")],
            lan: [nic("192.168.1.10"), { address: "fe80::1", family: "IPv6" }],
            loopback: [nic("127.0.0.1", true)],
          }),
        },
      },
    ) as typeof DiscoveryTypes;

    const candidates = getDiscoveryCandidates({
      ip: "192.168.178.42",
      log: { debug: (message: string) => debug.push(message) },
    });
    const networks = [
      ...new Set(candidates.map((ip) => ip.replace(/\.\d+$/, ""))),
    ];

    assert.deepEqual(networks, [
      "192.168.178",
      "172.20.1",
      "172.21.1",
      "172.22.1",
    ]);
    assert.equal(candidates.length, 4 * 254);
    assert.deepEqual(debug, [
      "Discovery scans 192.168.178.0/24, 172.20.1.0/24, 172.21.1.0/24, 172.22.1.0/24 and skips 172.23.1.0/24, 192.168.1.0/24",
    ]);
  });

  it("clamps discovery concurrency values", () => {
    assert.equal(clampDiscoveryConcurrency(0), 32);
    assert.equal(clampDiscoveryConcurrency(-1), 1);
    assert.equal(clampDiscoveryConcurrency(999), 254);
    assert.equal(clampDiscoveryConcurrency(7.9), 7);
  });

  it("builds the GoodWe ID info request", () => {
    assert.deepEqual(
      [...buildIdInfoRequest()],
      [0xaa, 0x55, 0xc0, 0x7f, 0x01, 0x02, 0x00, 0x02, 0x41],
    );
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

  it("logs socket close errors instead of swallowing them", async () => {
    const messages: string[] = [];
    const { probeGoodWeInverter } = proxyquire("../src/lib/goodwe-discovery", {
      "node:dgram": {
        createSocket: () => new ClosingErrorSocket(),
      },
    }) as typeof DiscoveryTypes;

    const result = await probeGoodWeInverter("192.168.178.42", {
      log: { debug: (message: string) => messages.push(message) },
      timeoutMs: 1,
    });

    assert.equal(result.reachable, false);
    assert.match(messages[0], /UDP discovery socket close failed/);
  });
});

describe("GoodWe UDP parser", () => {
  it("decodes register strings as ASCII text", async () => {
    const socket = new FakeSocket(() => {
      return buildRegisterResponse(registerGroups.deviceInfo, (response) => {
        response.write("GW1234567890ABCD", 11, 16, "ascii");
      });
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("deviceInfo"), true);
    assert.equal(inverter.DeviceInfo.SerialNumber, "GW1234567890ABCD");
  });

  it("decodes signed 32 bit register values", async () => {
    const socket = new FakeSocket(() => {
      return buildRegisterResponse(registerGroups.runningData, (response) => {
        response.writeInt32BE(-12345, 5 + (35216 - 35100) * 2);
      });
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("runningData"), true);
    assert.equal(inverter.RunningData.DerateFrozenPower, -12345);
  });

  it("decodes battery temperatures below zero", async () => {
    // The specification lists these registers as U16, which turned -0.1 °C
    // into 6553.5 °C. The extremes guard the sign bit on both sides.
    for (const [raw, expected] of [
      [-1, -0.1],
      [0, 0],
      [0x7fff, 3276.7],
      [-0x8000, -3276.8],
    ]) {
      const socket = new FakeSocket(() => {
        return buildRegisterResponse(registerGroups.bmsInfo, (response) => {
          response.writeInt16BE(raw, 5 + (37003 - 37002) * 2);
        });
      });
      const inverter = createInverter(socket);

      assert.equal(await inverter.ReadGroup("bmsInfo"), true);
      assert.equal(inverter.BmsInfo.PackTemperature, expected);
    }

    const socket = new FakeSocket(() => {
      return buildRegisterResponse(
        registerGroups.bmsInfoExtended,
        (response) => {
          response.writeInt16BE(-25, 5 + (37020 - 37000) * 2);
          response.writeInt16BE(-0x8000, 5 + (37021 - 37000) * 2);
        },
      );
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("bmsInfoExtended"), true);
    assert.equal(inverter.BmsInfo.MaximumCellTemperature, -2.5);
    assert.equal(inverter.BmsInfo.MinimumCellTemperature, -3276.8);
  });

  it("reports the battery discharge depth the way the SolarGo app shows it", async () => {
    // The register holds the reserve, 100 minus the depth: a live inverter set
    // to 95 % in the app answers 5. A value above 100 is not clamped, so a
    // broken register stays visible.
    for (const [raw, expected] of [
      [5, 95],
      [0, 100],
      [100, 0],
      [101, -1],
    ]) {
      const socket = new FakeSocket(() => {
        return buildRegisterResponse(
          registerGroups.settingsBattery,
          (response) => {
            response.writeUInt16BE(raw, 5 + (45356 - 45350) * 2);
            response.writeUInt16BE(raw, 5 + (45358 - 45350) * 2);
          },
        );
      });
      const inverter = createInverter(socket);

      assert.equal(await inverter.ReadGroup("settingsBattery"), true);
      const battery = inverter.Settings.Battery as Record<string, number>;
      assert.equal(battery.DischargeDepth, expected);
      assert.equal(battery.DischargeDepthOffline, expected);
    }
  });

  it("reads the work mode and the load control settings", async () => {
    const socket = new FakeSocket(() => {
      return buildRegisterResponse(
        registerGroups.settingsWorkMode,
        (response) => {
          response.writeUInt16BE(3, 5);
        },
      );
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("settingsWorkMode"), true);
    assert.equal(inverter.Settings.WorkMode, 3);
    assert.equal(registerGroups.settingsWorkMode.entries[0].states?.[3], "Eco");

    const loadSocket = new FakeSocket(() => {
      return buildRegisterResponse(
        registerGroups.settingsLoadControl,
        (response) => {
          response.writeUInt16BE(1, 5);
          response.writeUInt16BE(0, 7);
          response.writeUInt16BE(0xffff, 9);
        },
      );
    });
    const loadInverter = createInverter(loadSocket);

    assert.equal(await loadInverter.ReadGroup("settingsLoadControl"), true);
    assert.deepEqual(loadInverter.Settings.LoadControl, {
      Mode: 1,
      Switch: 0,
      Soc: 65535,
    });

    assert.equal(optionalGroupConfigs.settingsWorkMode, "pollSettings");
    assert.equal(optionalGroupConfigs.settingsLoadControl, "pollSettings");
    // Read only: nothing documents what these registers accept.
    assert.equal(writableGroups.has("settingsWorkMode"), false);
    assert.equal(writableGroups.has("settingsLoadControl"), false);
  });

  it("decodes meter power factors, reactive power and energy totals", async () => {
    // Raw values read from a GM3000 meter on a live GW10K-ET. Decoded the way
    // the specification says, the power factor read 3.33 and 648.18 and the
    // export total 1.68 million kWh.
    const socket = new FakeSocket(() => {
      return buildRegisterResponse(registerGroups.extComData, (response) => {
        response.writeInt16BE(-249, 5 + (36009 - 36000) * 2);
        response.writeUInt16BE(333, 5 + (36010 - 36000) * 2);
        response.writeInt16BE(-1000, 5 + (36011 - 36000) * 2);
        response.writeUInt16BE(64818, 5 + (36012 - 36000) * 2);
        response.writeInt16BE(1000, 5 + (36013 - 36000) * 2);
        response.writeFloatBE(16790020, 5 + (36015 - 36000) * 2);
        response.writeFloatBE(1426240, 5 + (36017 - 36000) * 2);
      });
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("extComData"), true);
    assert.equal(inverter.ExtComData.TotalReactivePower, -249);
    assert.equal(inverter.ExtComData.L1.PowerFactor, 0.333);
    assert.equal(inverter.ExtComData.L2.PowerFactor, -1);
    assert.equal(inverter.ExtComData.L3.PowerFactor, -0.718);
    assert.equal(inverter.ExtComData.PowerFactor, 1);
    assert.equal(inverter.ExtComData.EnergyTotalSell, 16790.02);
    assert.equal(inverter.ExtComData.EnergyTotalBuy, 1426.24);
  });

  it("accepts a padded datagram carrying the answer", async () => {
    // The dongle pads the 257 byte running data answer to 1024 bytes. Reading
    // the CRC from the end of the datagram rejected it and cost a retry. The
    // padding must not be zeros here: a Modbus CRC register that is 0 after a
    // valid frame stays 0 over zero bytes, so zero padding passes even the
    // broken check and would make this test prove nothing.
    const socket = new FakeSocket(() => {
      const frame = buildRegisterResponse(
        registerGroups.runningData,
        (response) => {
          response.writeInt16BE(-230, 5 + (35140 - 35100) * 2);
        },
      );

      return Buffer.concat([frame, Buffer.alloc(1024 - frame.length, 0xff)]);
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("runningData"), true);
    assert.equal(inverter.RunningData.AcActivePower, -230);
  });

  it("decodes byte offsets, signed values, and scaled values", async () => {
    const socket = new FakeSocket(() => {
      return buildRegisterResponse(registerGroups.runningData, (response) => {
        response[5 + (35119 - 35100) * 2] = 4;
        response[5 + (35119 - 35100) * 2 + 3] = 1;
        response.writeInt16BE(-230, 5 + (35140 - 35100) * 2);
        response.writeUInt16BE(2315, 5 + (35121 - 35100) * 2);
      });
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("runningData"), true);
    assert.equal(inverter.RunningData.Pv4.Mode, 4);
    assert.equal(inverter.RunningData.Pv1.Mode, 1);
    assert.equal(inverter.RunningData.AcActivePower, -230);
    assert.equal(inverter.RunningData.GridL1.Voltage, 231.5);
  });

  it("clamps invalid UDP retry configuration", async () => {
    const socket = new FakeSocket(() => buildIdInfoResponse());
    const inverter = createInverter(socket);

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, { retries: -1 }),
      true,
    );
  });
});

describe("state mapping", () => {
  async function deletedOnStart(
    config: Partial<ioBroker.AdapterConfig>,
  ): Promise<string[]> {
    const deleted: string[] = [];
    const adapter: StateAdapterLike = {
      config: { ...testConfig, ...config },
      log: testLogger,
      setObjectNotExistsAsync: () => Promise.resolve(undefined),
      extendObjectAsync: () => Promise.resolve(undefined),
      // Every object of an older start still exists.
      getObjectAsync: (id: string) =>
        Promise.resolve({ _id: id, type: "state" } as ioBroker.Object),
      delObjectAsync: (id: string) => {
        deleted.push(id);
        return Promise.resolve(undefined);
      },
      setStateChangedAsync: () => Promise.resolve(undefined),
    };

    await new GoodWeStateManager(
      adapter,
      {} as unknown as GoodWeUdp,
    ).CleanupDisabledOptionalStates();

    return deleted;
  }

  it("removes the work mode and load control states with pollSettings off", async () => {
    const deleted = await deletedOnStart({
      pollSettings: false,
      enableControl: true,
    });

    for (const id of [
      "Settings.WorkMode",
      "Settings.LoadControl.Mode",
      "Settings.LoadControl.Switch",
      "Settings.LoadControl.Soc",
      "Settings.LoadControl",
    ]) {
      assert.ok(deleted.includes(id), `${id} not deleted`);
    }

    // Inverter control still reads and writes the battery and EMS settings.
    for (const id of [
      "Settings",
      "Settings.Battery",
      "Settings.Battery.DischargeDepth",
      "Settings.EmsMode",
    ]) {
      assert.equal(deleted.includes(id), false, `${id} deleted`);
    }

    // Deepest first: a channel goes only after the channels below it.
    assert.ok(
      deleted.indexOf("Settings.LoadControl") >
        deleted.indexOf("Settings.LoadControl.Soc"),
    );
  });

  it("removes the whole settings channel with pollSettings and control off", async () => {
    const deleted = await deletedOnStart({
      pollSettings: false,
      enableControl: false,
    });

    for (const id of [
      "Settings.Battery.DischargeDepth",
      "Settings.EmsMode",
      "Settings.WorkMode",
      "Settings.Battery",
      "Settings",
    ]) {
      assert.ok(deleted.includes(id), `${id} not deleted`);
    }
    assert.ok(
      deleted.indexOf("Settings") > deleted.indexOf("Settings.Battery"),
    );
  });

  it("keeps every settings state with pollSettings on", async () => {
    const deleted = await deletedOnStart({ pollSettings: true });

    assert.deepEqual(
      deleted.filter((id) => id.startsWith("Settings")),
      [],
    );
  });

  it("creates numeric mode states with enum labels", async () => {
    const objects: ObjectWrite[] = [];
    const adapter: StateAdapterLike = {
      config: testConfig,
      log: testLogger,
      setObjectNotExistsAsync: (
        id: string,
        object: ioBroker.SettableObject,
      ) => {
        objects.push({ id, object });
        return Promise.resolve(undefined);
      },
      extendObjectAsync: () => Promise.resolve(undefined),
      getObjectAsync: () => Promise.resolve(undefined),
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: () => Promise.resolve(undefined),
    };
    const manager = new GoodWeStateManager(adapter, {} as unknown as GoodWeUdp);

    await manager.CreateObjectsFromRegisterMap();

    const gridMode = objects.find(
      (entry) => entry.id === "RunningData.GridMode",
    )?.object;

    assert.equal(gridMode?.type, "state");
    assert.deepEqual(gridMode?.common.states, {
      0: "Loss",
      1: "OK",
      2: "Fault",
    });
  });

  it("updates enum labels on existing numeric mode states", async () => {
    let enumUpdate: ioBroker.PartialObject | undefined;
    const adapter: StateAdapterLike = {
      config: testConfig,
      log: testLogger,
      setObjectNotExistsAsync: () => Promise.resolve(undefined),
      extendObjectAsync: (_id: string, object: ioBroker.PartialObject) => {
        enumUpdate = object;
        return Promise.resolve(undefined);
      },
      getObjectAsync: (id: string) =>
        Promise.resolve(
          id === "RunningData.GridMode"
            ? {
                _id: id,
                type: "state",
                common: {
                  name: "GridMode",
                  type: "number",
                  role: "value",
                  read: true,
                  write: false,
                },
                native: {},
              }
            : undefined,
        ),
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: () => Promise.resolve(undefined),
    };
    const manager = new GoodWeStateManager(adapter, {} as unknown as GoodWeUdp);

    await manager.UpdateExistingStateEnums("RunningData.GridMode", {
      0: "Loss",
      1: "OK",
      2: "Fault",
    });

    assert.deepEqual(enumUpdate, {
      type: "state",
      common: {
        states: {
          0: "Loss",
          1: "OK",
          2: "Fault",
        },
      },
    });
  });

  function legacyAdapter(
    existing: Record<string, Partial<ioBroker.StateCommon> | "channel">,
    updates: { id: string; object: ioBroker.PartialObject }[],
    objects: ObjectWrite[] = [],
  ): StateAdapterLike {
    return {
      config: testConfig,
      log: testLogger,
      setObjectNotExistsAsync: (
        id: string,
        object: ioBroker.SettableObject,
      ) => {
        objects.push({ id, object });
        return Promise.resolve(undefined);
      },
      extendObjectAsync: (id: string, object: ioBroker.PartialObject) => {
        updates.push({ id, object });
        return Promise.resolve(undefined);
      },
      getObjectAsync: (id: string) => {
        const common = existing[id];
        if (common === undefined) {
          return Promise.resolve(undefined);
        }
        return Promise.resolve(
          common === "channel"
            ? { _id: id, type: "channel", common: { name: id }, native: {} }
            : {
                _id: id,
                type: "state",
                common: {
                  name: id,
                  type: "number",
                  read: true,
                  write: false,
                  role: "value",
                  ...common,
                },
                native: {},
              },
        );
      },
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: () => Promise.resolve(undefined),
    };
  }

  it("brings states of older versions up to the register map and keeps hand-set metadata", async () => {
    const updates: { id: string; object: ioBroker.PartialObject }[] = [];
    const manager = new GoodWeStateManager(
      legacyAdapter(
        {
          oldC: { role: "value.temperature", unit: "C" },
          handK: { role: "value.temperature", unit: "K" },
          current: { role: "value.temperature", unit: "°C" },
          bare: {},
          emptyUnit: { unit: "" },
          handRole: { role: "value.power.produced" },
          handUnit: { unit: "kW" },
          genericOnly: { role: "value" },
          channel: "channel",
        },
        updates,
      ),
      {} as unknown as GoodWeUdp,
    );

    await manager.UpdateLegacyMetadata("oldC", "value.temperature", "°C");
    await manager.UpdateLegacyMetadata("handK", "value.temperature", "°C");
    await manager.UpdateLegacyMetadata("current", "value.temperature", "°C");
    await manager.UpdateLegacyMetadata("bare", "value.voltage", "V");
    await manager.UpdateLegacyMetadata("emptyUnit", "value.current", "A");
    await manager.UpdateLegacyMetadata("handRole", "value.power", "W");
    await manager.UpdateLegacyMetadata("handUnit", "value.power", "W");
    await manager.UpdateLegacyMetadata("genericOnly", "value", undefined);
    await manager.UpdateLegacyMetadata("channel", "value.power", "W");
    await manager.UpdateLegacyMetadata("missing", "value.power", "W");

    assert.deepEqual(updates, [
      { id: "oldC", object: { type: "state", common: { unit: "°C" } } },
      {
        id: "bare",
        object: { type: "state", common: { unit: "V", role: "value.voltage" } },
      },
      {
        id: "emptyUnit",
        object: { type: "state", common: { unit: "A", role: "value.current" } },
      },
      { id: "handRole", object: { type: "state", common: { unit: "W" } } },
      {
        id: "handUnit",
        object: { type: "state", common: { role: "value.power" } },
      },
    ]);
  });

  it("creates temperature states with unit °C and migrates read-only states only", async () => {
    const objects: ObjectWrite[] = [];
    const updates: { id: string; object: ioBroker.PartialObject }[] = [];
    const manager = new GoodWeStateManager(
      legacyAdapter(
        {
          "RunningData.AirTemperature": {
            role: "value.temperature",
            unit: "C",
          },
          "RunningData.PV1.Voltage": {},
          "Settings.GridExportLimit": {},
        },
        updates,
        objects,
      ),
      {} as unknown as GoodWeUdp,
    );

    await manager.CreateObjectsFromRegisterMap();

    const temperatures = objects.filter(
      (entry) =>
        entry.object.type === "state" &&
        entry.object.common.role === "value.temperature",
    );

    assert.ok(temperatures.length > 0);
    for (const entry of temperatures) {
      assert.equal(
        (entry.object.common as ioBroker.StateCommon).unit,
        "°C",
        entry.id,
      );
    }
    const legacy = updates.filter(
      (entry) => "unit" in (entry.object.common ?? {}),
    );
    assert.deepEqual(
      legacy.map((entry) => entry.id),
      ["RunningData.PV1.Voltage", "RunningData.AirTemperature"],
    );
    assert.ok(
      !updates.some(
        (entry) =>
          entry.id === "Settings.GridExportLimit" &&
          "unit" in (entry.object.common ?? {}),
      ),
    );
  });

  it("writes mapped register values through setStateChangedAsync", async () => {
    const writes: StateWrite[] = [];
    const adapter: StateAdapterLike = {
      config: testConfig,
      log: testLogger,
      setObjectNotExistsAsync: () => Promise.resolve(undefined),
      extendObjectAsync: () => Promise.resolve(undefined),
      getObjectAsync: () => Promise.resolve(undefined),
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: (
        id: string,
        value: ioBroker.StateValue,
        ack: boolean,
      ) => {
        writes.push({ id, value, ack });
        return Promise.resolve(undefined);
      },
    };
    const inverter = {
      RunningData: {
        Pv1: { Voltage: 231.5 },
      },
    };
    const manager = new GoodWeStateManager(
      adapter,
      inverter as unknown as GoodWeUdp,
    );

    await manager.UpdateStatesFromRegisterMap({
      name: "RunningData",
      start: 0,
      count: 1,
      channel: "RunningData",
      target: "RunningData",
      entries: [
        {
          address: 0,
          state: "RunningData.PV1.Voltage",
          model: "Pv1.Voltage",
          type: TYPE.U16,
          registers: 1,
          scale: 1,
          role: "value",
          byteOffset: 0,
        },
      ],
    });

    assert.deepEqual(writes, [
      { id: "RunningData.PV1.Voltage", value: 231.5, ack: true },
    ]);
  });

  it("treats charging or discharging battery mode with zero current as standby", async () => {
    const writes: StateWrite[] = [];
    const adapter: StateAdapterLike = {
      config: testConfig,
      log: testLogger,
      setObjectNotExistsAsync: () => Promise.resolve(undefined),
      extendObjectAsync: () => Promise.resolve(undefined),
      getObjectAsync: () => Promise.resolve(undefined),
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: (
        id: string,
        value: ioBroker.StateValue,
        ack: boolean,
      ) => {
        writes.push({ id, value, ack });
        return Promise.resolve(undefined);
      },
    };
    const inverter = {
      RunningData: {
        Battery1: { Mode: 2, Current: 0, Power: 3 },
      },
    };
    const manager = new GoodWeStateManager(
      adapter,
      inverter as unknown as GoodWeUdp,
    );

    await manager.UpdateStatesFromRegisterMap({
      name: "RunningData",
      start: 0,
      count: 1,
      channel: "RunningData",
      target: "RunningData",
      entries: [
        {
          address: 0,
          state: "RunningData.Battery1.Mode",
          model: "Battery1.Mode",
          type: TYPE.U16,
          registers: 1,
          scale: 1,
          role: "value",
          byteOffset: 0,
        },
      ],
    });

    assert.deepEqual(writes, [
      { id: "RunningData.Battery1.Mode", value: 1, ack: true },
    ]);
  });
});

describe("status mapping", () => {
  it("maps decoded running and BMS states", () => {
    const runningStates = getDecodedRunningStatuses({
      GridMode: 1,
      WorkMode: 2,
      OperationMode: 16,
      Battery1: { Mode: 3 },
      Pv1: { Mode: 1 },
      Pv2: { Mode: 2 },
      Pv3: { Mode: 0 },
      Pv4: { Mode: 99 },
      BackUpL1: { Mode: 0 },
      BackUpL2: { Mode: 1 },
      BackUpL3: { Mode: 0 },
      ErrorMessage: 0b11,
      DiagStatusL: 0b101,
    });
    const bmsStates = getDecodedBmsStatuses(
      {
        ErrorCode: 0b11,
        ErrorCodeH: 0,
        WarningCodeL: 0b11,
        WarningCodeH: 0,
        DRMStatus: 0b1000000000000001,
      },
      true,
    );

    assert.equal(
      runningStates.some((state) => state.id.endsWith("ModeText")),
      false,
    );
    assert.deepEqual(
      runningStates.find(
        (state) => state.id === "RunningData.ErrorMessageActive",
      ),
      {
        id: "RunningData.ErrorMessageActive",
        value: "GFCI Device Check Failure, AC HCT Check Failure",
      },
    );
    assert.deepEqual(
      bmsStates.find((state) => state.id === "BMSInfo.WarningCodeActive"),
      {
        id: "BMSInfo.WarningCodeActive",
        value: "Charging over-voltage1, Discharge under-voltage1",
      },
    );
    assert.deepEqual(
      bmsStates.find((state) => state.id === "BMSInfo.DRMStatusActive"),
      {
        id: "BMSInfo.DRMStatusActive",
        value: "DRM0, DRED Connected",
      },
    );
  });

  it("decodes only the BMS alarms without the extended BMS data", () => {
    // Before the first BMS read the codes are not there yet.
    assert.deepEqual(getDecodedBmsStatuses({}, false), [
      { id: "BMSInfo.ErrorCodeActive", value: "" },
    ]);
    assert.deepEqual(
      getDecodedBmsStatuses({ ErrorCodeH: 1 }, true).map((state) => state.id),
      [
        "BMSInfo.ErrorCodeActive",
        "BMSInfo.WarningCodeActive",
        "BMSInfo.DRMStatusActive",
      ],
    );
  });
});

describe("poll scheduler", () => {
  it("clamps invalid poll cycle configuration", () => {
    assert.equal(clampPollCycle(undefined), 10);
    assert.equal(clampPollCycle(Number.NaN), 10);
    assert.equal(clampPollCycle(0), 2);
    assert.equal(clampPollCycle(99.9), 99);
    assert.equal(clampPollCycle(9999), 3600);
  });

  it("owns poll timeout lifecycle", async () => {
    let timeoutCallback: () => void = noop;
    let clearedTimer: ioBroker.Timeout | undefined;
    let pollCount = 0;
    const timer = 1 as ioBroker.Timeout;
    const adapter: SchedulerAdapterLike = {
      config: testConfig,
      log: testLogger,
      setTimeout: (callback: () => void, _ms: number) => {
        timeoutCallback = callback;
        return timer;
      },
      clearTimeout: (timeout: ioBroker.Timeout) => {
        clearedTimer = timeout;
      },
    };
    const scheduler = new PollScheduler(
      adapter,
      () => {
        pollCount++;
        return Promise.resolve(undefined);
      },
      1000,
    );

    scheduler.start();
    await Promise.resolve();
    assert.equal(pollCount, 1);
    assert.equal(typeof timeoutCallback, "function");

    scheduler.stop();
    assert.equal(clearedTimer, timer);

    timeoutCallback();
    await Promise.resolve();
    assert.equal(pollCount, 1);
  });

  it("keeps polling after a poll threw", async () => {
    const warnings: string[] = [];
    let scheduled = 0;
    const scheduler = new PollScheduler(
      {
        config: testConfig,
        log: {
          ...testLogger,
          warn: (message: string) => warnings.push(message),
        },
        setTimeout: () => {
          scheduled++;
          return 1 as ioBroker.Timeout;
        },
        clearTimeout: noop,
      },
      () => Promise.reject(new Error("boom")),
      1000,
    );

    scheduler.start();
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.stop();

    assert.deepEqual(warnings, ["poll scheduler failed: boom"]);
    assert.equal(scheduled, 1);
  });
});

describe("poll traffic", () => {
  // Every lost UDP request costs a retry, so the scheduler must not read more
  // registers than the data actually changes.
  function createPollScheduler(
    config: ioBroker.AdapterConfig,
    overrides: Partial<
      Pick<
        GoodWeStateManager,
        | "IsRegisterGroupEnabled"
        | "IsControlEnabled"
        | "IsControlWritePending"
        | "UpdateStatesFromRegisterMap"
      >
    > = {},
    answered: (groupName: string) => boolean = () => true,
  ): {
    connection: boolean[];
    readOptions: Map<string, unknown>;
    reads: string[];
    scheduler: GoodWePollScheduler;
    setStatus: (online: boolean) => void;
    warnings: string[];
  } {
    const connection: boolean[] = [];
    const warnings: string[] = [];
    const reads: string[] = [];
    const readOptions = new Map<string, unknown>();
    let online = true;
    const inverter = {
      get Status(): boolean {
        return online;
      },
      ReadIdInfo: () => Promise.resolve(true),
      ReadGroup: (groupName: string, options?: unknown) => {
        reads.push(groupName);
        readOptions.set(groupName, options);
        return Promise.resolve(answered(groupName));
      },
    } as unknown as GoodWeUdp;
    const states = {
      IsRegisterGroupEnabled: (groupName: string) =>
        groupName !== "bmsDetail" && groupName !== "powerLimit",
      IsControlEnabled: () => false,
      IsControlWritePending: () => false,
      UpdateStatesFromRegisterMap: () => Promise.resolve(undefined),
      ...overrides,
      SetConnection: (value: boolean) => {
        connection.push(value);
        return Promise.resolve(undefined);
      },
      UpdateDecodedRunningStatuses: () => Promise.resolve(undefined),
      UpdateDecodedBmsStatuses: () => Promise.resolve(undefined),
      UpdateDerivedRunningStates: () => Promise.resolve(undefined),
    } as unknown as GoodWeStateManager;

    return {
      connection,
      readOptions,
      reads,
      warnings,
      scheduler: new GoodWePollScheduler(
        {
          config,
          log: {
            ...testLogger,
            warn: (message: string) => warnings.push(message),
          },
          setTimeout: () => 1 as ioBroker.Timeout,
          clearTimeout: noop,
        },
        inverter,
        states,
        1000,
      ),
      setStatus: (value: boolean) => {
        online = value;
      },
    };
  }

  it("reads the live groups once per configured cycle", async () => {
    // Five second cycle, one tick per second: 60 ticks are 12 cycles.
    const { reads, scheduler } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    for (let tick = 0; tick < 60; tick++) {
      await scheduler.Poll();
    }

    // The settings run with them: a script must not decide on a stale EmsMode.
    for (const groupName of [
      "runningData",
      "extComData",
      "bmsInfo",
      "settingsBattery",
      "settingsEms",
    ]) {
      assert.equal(
        reads.filter((name) => name === groupName).length,
        12,
        `${groupName} runs once per cycle`,
      );
    }
  });

  it("sends the smallest live read into the lossy first slot", async () => {
    const { reads, scheduler } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    for (let tick = 0; tick < 10; tick++) {
      await scheduler.Poll();
    }

    // The first request after the idle gap loses answers several times as
    // often as the ones behind it, so the order is deliberate, not incidental.
    assert.deepEqual(reads.slice(0, 4), [
      "deviceInfo",
      "bmsInfo",
      "runningData",
      "extComData",
    ]);
  });

  it("reads one optional group per slow slot, round robin", async () => {
    const { reads, scheduler } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    // 60 seconds hold twelve live cycles and, at one slot per 30 seconds,
    // two optional group reads.
    for (let tick = 0; tick < 60; tick++) {
      await scheduler.Poll();
    }

    const optional = reads.filter(
      (groupName) =>
        groupName in optionalGroupConfigs && !groupName.startsWith("settings"),
    );

    assert.deepEqual(optional, ["deviceSimccid", "extComDataExtended"]);
  });

  it("reads the read-only settings in the slow slot, not every cycle", async () => {
    const { reads, scheduler } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    // 300 seconds: 60 live cycles and ten slow slots, enough for every one of
    // the nine optional groups once.
    for (let tick = 0; tick < 300; tick++) {
      await scheduler.Poll();
    }

    for (const groupName of ["settingsWorkMode", "settingsLoadControl"]) {
      const count = reads.filter((name) => name === groupName).length;

      assert.ok(count >= 1 && count <= 2, `${groupName} read ${count} times`);
    }
    assert.equal(reads.filter((name) => name === "settingsEms").length, 60);
  });

  it("keeps the request count per minute well below the live cycle", async () => {
    const { reads, scheduler } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    for (let tick = 0; tick < 60; tick++) {
      await scheduler.Poll();
    }

    // Three live groups and two settings groups twelve times plus two optional
    // reads plus the single device info read. Every extra request is another
    // one that can be lost.
    assert.equal(reads.length, 63);
  });

  it("reads the static device data once per connection", async () => {
    const { reads, scheduler, setStatus } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    for (let tick = 0; tick < 60; tick++) {
      await scheduler.Poll();
    }

    assert.equal(reads.filter((name) => name === "deviceInfo").length, 1);

    // A reconnect can mean new firmware, so it is read again.
    setStatus(false);
    await scheduler.Poll();
    setStatus(true);

    for (let tick = 0; tick < 10; tick++) {
      await scheduler.Poll();
    }

    assert.equal(reads.filter((name) => name === "deviceInfo").length, 2);
  });

  it("keeps polling the control group with the optional groups switched off", async () => {
    const config = {
      ...testConfig,
      pollCycle: 5,
      pollExtended: false,
      pollSettings: false,
      enableControl: true,
    };
    const manager = new GoodWeStateManager(
      { config, log: testLogger } as unknown as StateAdapterLike,
      {} as unknown as GoodWeUdp,
    );
    const { readOptions, reads, scheduler } = createPollScheduler(config, {
      IsRegisterGroupEnabled: (groupName: string) =>
        manager.IsRegisterGroupEnabled(groupName),
      IsControlEnabled: () => manager.IsControlEnabled(),
    });

    for (let tick = 0; tick < 60; tick++) {
      await scheduler.Poll();
    }

    // The writable states would otherwise only change after a write of their own.
    assert.deepEqual(
      reads.filter((groupName) => groupName in optionalGroupConfigs),
      Array.from({ length: 12 }, () => [
        "settingsBattery",
        "settingsEms",
      ]).flat(),
    );
    // One lost answer must not freeze the writable states for an hour.
    for (const groupName of ["settingsBattery", "settingsEms"]) {
      assert.deepEqual(readOptions.get(groupName), {
        optional: true,
        backoff: false,
      });
    }
  });

  it("stops the cycle when the live data got no answer", async () => {
    const harness = createPollScheduler(
      { ...testConfig, pollCycle: 5 },
      {},
      (groupName) => {
        // The inverter drops off the network during the cycle.
        const answered = groupName !== "extComData";

        harness.setStatus(answered);
        return answered;
      },
    );

    await harness.scheduler.Poll();

    // Every read behind it would only run into its timeout, delay the
    // reconnect and pause its group for an hour.
    assert.deepEqual(harness.reads, [
      "deviceInfo",
      "bmsInfo",
      "runningData",
      "extComData",
    ]);
  });

  for (const lost of ["deviceInfo", "bmsInfo", "runningData", "extComData"]) {
    it(`reports the connection lost when ${lost} gets no answer`, async () => {
      const updated: string[] = [];
      const harness = createPollScheduler(
        testConfig,
        {
          UpdateStatesFromRegisterMap: (group: RegisterGroup) => {
            updated.push(group.name);
            return Promise.resolve(undefined);
          },
        },
        (groupName) => groupName !== lost,
      );

      await harness.scheduler.Poll();

      assert.equal(harness.connection.includes(false), true);
      // The states keep the last value the inverter sent.
      assert.equal(updated.includes(registerGroups[lost].name), false);
    });
  }

  it("reads the device info again after it got no answer", async () => {
    let answerDeviceInfo = false;
    const harness = createPollScheduler(
      { ...testConfig, pollCycle: 2 },
      {},
      (groupName) => groupName !== "deviceInfo" || answerDeviceInfo,
    );

    await harness.scheduler.Poll();
    answerDeviceInfo = true;
    // One idle tick, then the next cycle.
    await harness.scheduler.Poll();
    await harness.scheduler.Poll();
    await harness.scheduler.Poll();
    await harness.scheduler.Poll();

    assert.equal(
      harness.reads.filter((groupName) => groupName === "deviceInfo").length,
      2,
    );
  });

  it("takes the connection down when a cycle throws", async () => {
    const harness = createPollScheduler(testConfig, {
      UpdateStatesFromRegisterMap: () =>
        Promise.reject(new Error("object database gone")),
    });

    await harness.scheduler.Poll();

    assert.deepEqual(harness.connection.slice(-1), [false]);
    assert.ok(
      harness.warnings.some((message) =>
        message.includes("poll cycle failed: object database gone"),
      ),
      harness.warnings.join("\n"),
    );
  });

  it("does not report the old control values while a write runs", async () => {
    const updated: string[] = [];
    const { scheduler } = createPollScheduler(
      { ...testConfig, pollCycle: 5, enableControl: true },
      {
        IsControlEnabled: () => true,
        IsControlWritePending: () => true,
        UpdateStatesFromRegisterMap: (group: RegisterGroup) => {
          updated.push(group.name);
          return Promise.resolve();
        },
      },
    );

    await scheduler.Poll();

    // A read queued in front of the write would acknowledge the value the
    // script just replaced. The write reads the group back itself.
    assert.ok(updated.includes("BMSInfo"));
    assert.ok(!updated.includes("Settings.Ems"));
    assert.ok(!updated.includes("Settings.Battery"));
  });
});

function buildIdInfoResponse(): Buffer {
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

function writeAscii(
  buffer: Buffer,
  start: number,
  length: number,
  value: string,
): void {
  buffer.write(value.slice(0, length), start, length, "ascii");
}

function createInverter(socket: EventEmitter): GoodWeUdp {
  return createInverterWithSockets(() => socket);
}

function createInverterWithSockets(factory: () => EventEmitter): GoodWeUdp {
  const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {
    "node:dgram": {
      createSocket: factory,
    },
  }) as { GoodWeUdp: new (logHost: { log: ioBroker.Logger }) => GoodWeUdp };

  return new GoodWeUdp({ log: testLogger });
}

class FakeSocket extends EventEmitter {
  private readonly responseFactory: () => Buffer;

  constructor(responseFactory: () => Buffer) {
    super();
    this.responseFactory = responseFactory;
  }

  send(
    _buffer: Buffer,
    _offset: number,
    _length: number,
    _port: number,
    _ip: string,
    callback: (error?: Error) => void,
  ): void {
    callback(undefined);
    process.nextTick(() => this.emit("message", this.responseFactory()));
  }

  close(): void {}
}

class ClosingErrorSocket extends EventEmitter {
  send(
    _request: Buffer,
    _port: number,
    _ip: string,
    callback: (error?: Error) => void,
  ): void {
    callback(undefined);
  }

  once(): this {
    return this;
  }

  close(): void {
    throw new Error("already closed");
  }
}

function commonOf(
  objects: ObjectWrite[],
  id: string,
): { role: string; write: boolean | undefined } | undefined {
  const object = objects.find((entry) => entry.id === id)?.object;

  return object?.type === "state"
    ? { role: object.common.role, write: object.common.write }
    : undefined;
}

class RecordingSocket extends EventEmitter {
  private readonly requests: Buffer[];
  private readonly responseFactory: () => Buffer;

  constructor(requests: Buffer[], responseFactory: () => Buffer) {
    super();
    this.requests = requests;
    this.responseFactory = responseFactory;
  }

  send(
    buffer: Uint8Array,
    _offset: number,
    _length: number,
    _port: number,
    _ip: string,
    callback: (error?: Error) => void,
  ): void {
    this.requests.push(Buffer.from(buffer));
    callback(undefined);
    process.nextTick(() => this.emit("message", this.responseFactory()));
  }

  close(): void {}
}

function buildWriteResponse(address: number, value: number): Buffer {
  const response = Buffer.alloc(10);

  response[0] = 0xaa;
  response[1] = 0x55;
  response[2] = 0xf7;
  response[3] = 0x06;
  response.writeUInt16BE(address, 4);
  response.writeUInt16BE(value, 6);

  const crc = calculateCrc16(response, 2, 6);

  response[8] = crc >> 8;
  response[9] = crc & 0xff;

  return response;
}

function buildExceptionResponse(
  functionCode: number,
  exceptionCode: number,
): Buffer {
  const response = Buffer.alloc(7);

  response[0] = 0xaa;
  response[1] = 0x55;
  response[2] = 0xf7;
  response[3] = functionCode | 0x80;
  response[4] = exceptionCode;

  const crc = calculateCrc16(response, 2, 3);

  response[5] = crc >> 8;
  response[6] = crc & 0xff;

  return response;
}

function buildRegisterResponse(
  group: RegisterGroup,
  writePayload: (response: Buffer) => void,
): Buffer {
  const response = Buffer.alloc(5 + group.count * 2 + 2);

  response[0] = 0xaa;
  response[1] = 0x55;
  response[2] = 0xf7;
  response[3] = 0x03;
  response[4] = group.count * 2;

  writePayload(response);

  const crc = calculateCrc16(response, 2, response.length - 4);
  response[response.length - 2] = crc >> 8;
  response[response.length - 1] = crc & 0xff;

  return response;
}

function calculateCrc16(
  data: Uint8Array,
  start: number,
  length: number,
): number {
  let crc = 0xffff;

  for (let pos = start; pos < start + length; pos++) {
    crc ^= data[pos];

    for (let bit = 8; bit !== 0; bit--) {
      if ((crc & 0x0001) !== 0) {
        crc >>= 1;
        crc ^= 0xa001;
      } else {
        crc >>= 1;
      }
    }
  }

  return ((crc & 0x00ff) << 8) + ((crc & 0xff00) >> 8);
}

describe("inverter control", () => {
  const emsMode = writableEntries.get("Settings.EmsMode") as RegisterEntry;
  const exportLimit = writableEntries.get(
    "Settings.GridExportLimit",
  ) as RegisterEntry;

  function createControlContext(
    controlEnabled = true,
    options: {
      writeConfirmed?: boolean;
      readBack?: boolean;
      stored?: number;
      online?: boolean;
      closed?: boolean;
    } = {},
  ): {
    acknowledged: StateWrite[];
    context: Parameters<typeof applyControlWrite>[0];
    readOptions: unknown[];
    reads: string[];
    sequence: string[];
    updated: string[];
    writes: Array<{ address: number; value: number }>;
  } {
    const writes: Array<{ address: number; value: number }> = [];
    const reads: string[] = [];
    const readOptions: unknown[] = [];
    const sequence: string[] = [];
    const updated: string[] = [];
    const acknowledged: StateWrite[] = [];

    return {
      acknowledged,
      context: {
        adapter: { log: testLogger, namespace: "goodwe.0" },
        inverter: {
          Status: options.online !== false,
          Closed: options.closed === true,
          WriteRegister: (address: number, value: number) => {
            writes.push({ address, value });
            sequence.push("write");
            return Promise.resolve(options.writeConfirmed !== false);
          },
          ReadGroup: (groupName: string, groupOptions?: unknown) => {
            reads.push(groupName);
            readOptions.push(groupOptions);
            return Promise.resolve(options.readBack !== false);
          },
        },
        states: {
          IsControlEnabled: () => controlEnabled,
          RunControlWrite: async (write: () => Promise<void>) => {
            sequence.push("begin");
            await write();
            sequence.push("end");
          },
          UpdateStatesFromRegisterMap: (group: RegisterGroup) => {
            updated.push(group.name);
            return Promise.resolve();
          },
          Acknowledge: (id: string, value: ioBroker.StateValue) => {
            acknowledged.push({ id, value, ack: true });
            return Promise.resolve();
          },
          RegisterValue: () => options.stored ?? null,
        },
      },
      readOptions,
      reads,
      sequence,
      updated,
      writes,
    };
  }

  it("clamps written values into the register range", () => {
    assert.equal(clampWriteValue(exportLimit, 3500.4), 3500);
    assert.equal(clampWriteValue(exportLimit, -1), 0);
    assert.equal(clampWriteValue(exportLimit, 99999), 30000);
    // Input fields send numbers as text; an empty field must not become zero.
    assert.equal(clampWriteValue(exportLimit, "3500"), 3500);
    assert.equal(clampWriteValue(exportLimit, " 3500.4 "), 3500);
    assert.equal(clampWriteValue(exportLimit, "-1"), 0);
    assert.equal(clampWriteValue(exportLimit, " "), null);
    assert.equal(clampWriteValue(exportLimit, "3500 W"), null);
    // Number() reads these as 16 and 1000, but nobody typed them as numbers.
    assert.equal(clampWriteValue(exportLimit, "0x10"), null);
    assert.equal(clampWriteValue(exportLimit, "1e3"), null);
    assert.equal(clampWriteValue(exportLimit, Number.NaN), null);
    assert.equal(clampWriteValue(exportLimit, null), null);
  });

  it("refuses enum values the register does not define", () => {
    assert.equal(clampWriteValue(emsMode, 1), 1);
    assert.equal(clampWriteValue(emsMode, 12), 12);
    // Clamping would turn a typo into "discharge battery" instead of refusing.
    assert.equal(clampWriteValue(emsMode, 99), null);
    assert.equal(clampWriteValue(emsMode, 0), null);
    assert.equal(clampWriteValue(emsMode, 4.4), null);
  });

  it("accepts booleans only on an on/off register", () => {
    const gridExport = writableEntries.get(
      "Settings.GridExportEnabled",
    ) as RegisterEntry;

    assert.equal(clampWriteValue(gridExport, true), 1);
    assert.equal(clampWriteValue(gridExport, false), 0);
    // true would mean 1 W on a limit and "Auto" on the EMS mode.
    assert.equal(clampWriteValue(exportLimit, true), null);
    assert.equal(clampWriteValue(emsMode, true), null);
  });

  it("scales the state value into register units", () => {
    const scaled: RegisterEntry = {
      ...exportLimit,
      scale: 10,
      writable: { min: 0, max: 30000 },
    };

    assert.equal(clampWriteValue(scaled, 52.3), 523);
    assert.equal(clampWriteValue(scaled, 5000), 30000);
  });

  it("writes the battery charge current in tenths of an ampere", () => {
    const current = writableEntries.get(
      "Settings.Battery.ChargeCurrent",
    ) as RegisterEntry;

    assert.equal(clampWriteValue(current, 18.5), 185);
    assert.equal(clampWriteValue(current, 0), 0);
    assert.equal(clampWriteValue(current, 100), 1000);
    assert.equal(clampWriteValue(current, 150), 1000);
    assert.equal(clampWriteValue(current, -1), 0);
    assert.equal(clampWriteValue(current, "abc"), null);
  });

  it("converts the depth of discharge back into the reserve register", () => {
    for (const id of [
      "Settings.Battery.DischargeDepth",
      "Settings.Battery.DischargeDepthOffline",
    ]) {
      const depth = writableEntries.get(id) as RegisterEntry;

      // The register holds 100 minus the depth the SolarGo app shows.
      assert.equal(clampWriteValue(depth, 95), 5, id);
      assert.equal(clampWriteValue(depth, 90), 10, id);
      assert.equal(clampWriteValue(depth, "80"), 20, id);
      assert.equal(clampWriteValue(depth, 0), 100, id);
      // The SolarGo app stops at 95 %, so a deeper discharge is clamped.
      assert.equal(clampWriteValue(depth, 99), 5, id);
      assert.equal(clampWriteValue(depth, -5), 100, id);
      assert.equal(clampWriteValue(depth, Number.NaN), null, id);
    }
  });

  it("writes the depth of discharge and acknowledges it in state units", async () => {
    const control = createControlContext(true, { readBack: false });

    await applyControlWrite(
      control.context,
      "goodwe.0.Settings.Battery.DischargeDepth",
      { val: 90, ack: false } as ioBroker.State,
    );

    assert.deepEqual(control.writes, [{ address: 45356, value: 10 }]);
    assert.deepEqual(control.reads, ["settingsBattery", "settingsBattery"]);
    assert.deepEqual(control.acknowledged, [
      { id: "Settings.Battery.DischargeDepth", value: 90, ack: true },
    ]);
  });

  it("skips a depth of discharge the inverter already holds", async () => {
    const control = createControlContext(true, { stored: 95 });

    await applyControlWrite(
      control.context,
      "goodwe.0.Settings.Battery.DischargeDepth",
      { val: 95, ack: false } as ioBroker.State,
    );

    assert.deepEqual(control.writes, []);
    assert.deepEqual(control.updated, ["Settings.Battery"]);
  });

  it("subscribes exactly the writable states", () => {
    assert.deepEqual(writableStateIds().sort(), [
      "Settings.Battery.ChargeCurrent",
      "Settings.Battery.DischargeDepth",
      "Settings.Battery.DischargeDepthOffline",
      "Settings.EmsMode",
      "Settings.EmsPowerLimit",
      "Settings.GridExportEnabled",
      "Settings.GridExportLimit",
    ]);
  });

  it("strips the adapter namespace from a state id", () => {
    assert.equal(
      stripNamespace("goodwe.0.Settings.EmsMode", "goodwe.0"),
      "Settings.EmsMode",
    );
    assert.equal(
      stripNamespace("Settings.EmsMode", "goodwe.0"),
      "Settings.EmsMode",
    );
  });

  it("writes a clamped value and reads the register group back", async () => {
    const control = createControlContext();

    await applyControlWrite(
      control.context,
      "goodwe.0.Settings.GridExportLimit",
      { val: 99999, ack: false } as ioBroker.State,
    );

    assert.deepEqual(control.writes, [{ address: 47510, value: 30000 }]);
    // Read before the write to compare, read after it to confirm.
    assert.deepEqual(control.reads, ["settingsEms", "settingsEms"]);
    // Like the poll: a lost answer neither takes the connection offline nor
    // pauses the group of the writable states for an hour.
    assert.deepEqual(control.readOptions, [
      { optional: true, backoff: false },
      { optional: true, backoff: false },
    ]);
    assert.deepEqual(control.updated, ["Settings.Ems"]);
    // Marked as pending, so the poll does not report the old value meanwhile.
    assert.deepEqual(control.sequence, ["begin", "write", "end"]);
  });

  it("runs control writes one after the other", async () => {
    const manager = new GoodWeStateManager(
      { config: testConfig, log: testLogger } as unknown as StateAdapterLike,
      {} as unknown as GoodWeUdp,
    );
    const order: string[] = [];
    let release = (): void => {};

    const first = manager.RunControlWrite(async () => {
      order.push("first begin");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first end");
    });
    const second = manager.RunControlWrite(() => {
      order.push("second");
      return Promise.resolve();
    });

    await new Promise((resolve) => setImmediate(resolve));
    // Switched on and off again: the second write must not read the register
    // before the first one reached it, or it skips itself as already done.
    assert.deepEqual(order, ["first begin"]);

    release();
    await Promise.all([first, second]);

    assert.deepEqual(order, ["first begin", "first end", "second"]);
  });

  it("refuses a write while the inverter is offline", async () => {
    const control = createControlContext(true, { online: false });

    await applyControlWrite(control.context, "goodwe.0.Settings.EmsMode", {
      val: 4,
      ack: false,
    } as ioBroker.State);

    // Each request would only wait out its timeout and hold up the reconnect.
    assert.deepEqual(control.writes, []);
    assert.deepEqual(control.reads, []);
  });

  it("marks a control write as pending until it finished", async () => {
    const manager = new GoodWeStateManager(
      { config: testConfig, log: testLogger } as unknown as StateAdapterLike,
      {} as unknown as GoodWeUdp,
    );
    let pendingInside = false;

    await manager.RunControlWrite(() => {
      pendingInside = manager.IsControlWritePending();
      return Promise.resolve();
    });

    assert.equal(pendingInside, true);
    assert.equal(manager.IsControlWritePending(), false);

    await assert.rejects(
      manager.RunControlWrite(() => Promise.reject(new Error("lost"))),
    );
    // A failed write must not block the poll updates for good.
    assert.equal(manager.IsControlWritePending(), false);
  });

  it("skips a write the inverter already holds", async () => {
    const control = createControlContext(true, { stored: 3500 });

    await applyControlWrite(
      control.context,
      "goodwe.0.Settings.GridExportLimit",
      { val: 3500, ack: false } as ioBroker.State,
    );

    // A script repeating its setpoint must not send a register write each time.
    assert.deepEqual(control.writes, []);
    assert.deepEqual(control.reads, ["settingsEms"]);
    assert.deepEqual(control.updated, ["Settings.Ems"]);
  });

  it("stops a write the unload cut off", async () => {
    const control = createControlContext(true, {
      writeConfirmed: false,
      closed: true,
    });

    await applyControlWrite(control.context, "goodwe.0.Settings.EmsMode", {
      val: 4,
      ack: false,
    } as ioBroker.State);

    // No read-back and no warning: the socket is gone, not the inverter.
    assert.deepEqual(control.reads, ["settingsEms"]);
    assert.deepEqual(control.updated, []);
    assert.deepEqual(control.acknowledged, []);
  });

  it("restores the state of a refused write from the inverter", async () => {
    const control = createControlContext();

    await applyControlWrite(control.context, "goodwe.0.Settings.EmsMode", {
      val: 99,
      ack: false,
    } as ioBroker.State);

    // Seen live: without this 99 stayed on the state, unacknowledged, for minutes.
    assert.deepEqual(control.writes, []);
    assert.deepEqual(control.reads, ["settingsEms"]);
    assert.deepEqual(control.updated, ["Settings.Ems"]);
  });

  it("ignores acknowledged values, read-only states and disabled control", async () => {
    const acknowledged = createControlContext();
    await applyControlWrite(acknowledged.context, "goodwe.0.Settings.EmsMode", {
      val: 4,
      ack: true,
    } as ioBroker.State);

    const readOnly = createControlContext();
    await applyControlWrite(
      readOnly.context,
      "goodwe.0.Settings.Battery.Capacity",
      { val: 50, ack: false } as ioBroker.State,
    );

    const disabled = createControlContext(false);
    await applyControlWrite(disabled.context, "goodwe.0.Settings.EmsMode", {
      val: 4,
      ack: false,
    } as ioBroker.State);

    const refusedValue = createControlContext();
    await applyControlWrite(refusedValue.context, "goodwe.0.Settings.EmsMode", {
      val: "charge",
      ack: false,
    } as ioBroker.State);

    assert.deepEqual(acknowledged.writes, []);
    assert.deepEqual(readOnly.writes, []);
    assert.deepEqual(disabled.writes, []);
    assert.deepEqual(refusedValue.writes, []);
  });

  it("creates writable settings states only when control is enabled", async () => {
    const objects: ObjectWrite[] = [];
    const adapter: StateAdapterLike = {
      config: { ...testConfig, enableControl: true },
      log: testLogger,
      setObjectNotExistsAsync: (
        id: string,
        object: ioBroker.SettableObject,
      ) => {
        objects.push({ id, object });
        return Promise.resolve(undefined);
      },
      extendObjectAsync: () => Promise.resolve(undefined),
      getObjectAsync: () => Promise.resolve(undefined),
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: () => Promise.resolve(undefined),
    };

    await new GoodWeStateManager(
      adapter,
      {} as unknown as GoodWeUdp,
    ).CreateObjectsFromRegisterMap();

    const readOnlyObjects: ObjectWrite[] = [];

    await new GoodWeStateManager(
      {
        ...adapter,
        config: { ...testConfig, enableControl: false },
        setObjectNotExistsAsync: (
          id: string,
          object: ioBroker.SettableObject,
        ) => {
          readOnlyObjects.push({ id, object });
          return Promise.resolve(undefined);
        },
      },
      {} as unknown as GoodWeUdp,
    ).CreateObjectsFromRegisterMap();

    assert.deepEqual(commonOf(objects, "Settings.EmsMode"), {
      role: "level",
      write: true,
    });
    assert.deepEqual(commonOf(objects, "Settings.Battery.DischargeDepth"), {
      role: "level",
      write: true,
    });
    assert.deepEqual(commonOf(objects, "Settings.Battery.DischargeVoltage"), {
      role: "value.voltage",
      write: false,
    });
    assert.deepEqual(
      commonOf(readOnlyObjects, "Settings.Battery.DischargeDepth"),
      { role: "value.battery", write: false },
    );
    // A read-only state may not keep the "level" role: ioBroker pairs it with
    // write access, and the repository object check rejects the mismatch.
    assert.deepEqual(commonOf(readOnlyObjects, "Settings.EmsMode"), {
      role: "value",
      write: false,
    });
    assert.deepEqual(commonOf(readOnlyObjects, "Settings.GridExportLimit"), {
      role: "value.power",
      write: false,
    });
  });

  it("takes role and write permission back when control is switched off", async () => {
    const updates: Array<{ id: string; object: ioBroker.PartialObject }> = [];
    const adapter: StateAdapterLike = {
      config: testConfig,
      log: testLogger,
      setObjectNotExistsAsync: () => Promise.resolve(undefined),
      extendObjectAsync: (id: string, object: ioBroker.PartialObject) => {
        updates.push({ id, object });
        return Promise.resolve(undefined);
      },
      getObjectAsync: (id: string) =>
        Promise.resolve({
          _id: id,
          type: "state",
          common: {
            name: "EmsMode",
            type: "number",
            role: "level",
            read: true,
            write: true,
          },
          native: {},
        } as ioBroker.Object),
      delObjectAsync: () => Promise.resolve(undefined),
      setStateChangedAsync: () => Promise.resolve(undefined),
    };

    await new GoodWeStateManager(
      adapter,
      {} as unknown as GoodWeUdp,
    ).UpdateExistingControlFlags("Settings.EmsMode", "value", false);

    assert.deepEqual(updates, [
      {
        id: "Settings.EmsMode",
        object: { type: "state", common: { role: "value", write: false } },
      },
    ]);
  });

  it("writes a single register and accepts the inverter echo", async () => {
    const requests: Buffer[] = [];
    const socket = new RecordingSocket(requests, () =>
      buildWriteResponse(47511, 4),
    );
    const inverter = createInverter(socket);

    assert.equal(await inverter.WriteRegister(47511, 4), true);

    const request = requests[0];
    const crc = calculateCrc16(request, 0, 6);

    assert.deepEqual(
      Array.from(request.subarray(0, 6)),
      [0xf7, 0x06, 0xb9, 0x97, 0x00, 0x04],
    );
    assert.equal(request[6], crc >> 8);
    assert.equal(request[7], crc & 0xff);
  });

  it("refuses a write answer that echoes another value", async function () {
    this.timeout(10000);

    const sockets: ScriptedSocket[] = [];
    const inverter = createInverterWithSockets(() => {
      const socket = new ScriptedSocket(
        sockets.length === 0
          ? [buildIdInfoResponse(), buildWriteResponse(47511, 5)]
          : [null],
      );

      sockets.push(socket);

      return socket;
    });

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    assert.equal(await inverter.WriteRegister(47511, 4), false);
  });

  it("acknowledges the confirmed value when the read back fails", async () => {
    const control = createControlContext(true, { readBack: false });

    await applyControlWrite(control.context, "goodwe.0.Settings.EmsMode", {
      val: 4,
      ack: false,
    } as ioBroker.State);

    assert.deepEqual(control.writes, [{ address: 47511, value: 4 }]);
    assert.deepEqual(control.updated, []);
    assert.deepEqual(control.acknowledged, [
      { id: "Settings.EmsMode", value: 4, ack: true },
    ]);
  });

  it("leaves an unconfirmed write unacknowledged", async () => {
    const control = createControlContext(true, {
      readBack: false,
      writeConfirmed: false,
    });

    await applyControlWrite(control.context, "goodwe.0.Settings.EmsMode", {
      val: 4,
      ack: false,
    } as ioBroker.State);

    assert.deepEqual(control.acknowledged, []);
  });

  it("keeps the writable register group enabled while control is on", () => {
    assert.deepEqual(Array.from(writableGroups), [
      "settingsBattery",
      "settingsEms",
    ]);

    const manager = new GoodWeStateManager(
      {
        config: {
          ...testConfig,
          enableControl: true,
          pollExtended: false,
          pollSettings: false,
        },
        log: testLogger,
      } as unknown as StateAdapterLike,
      {} as unknown as GoodWeUdp,
    );

    // Without this the poll switches would delete the very objects main.ts
    // subscribes for inverter control.
    assert.equal(manager.IsRegisterGroupEnabled("settingsEms"), true);
    assert.equal(manager.IsRegisterGroupEnabled("settingsBattery"), true);
    assert.equal(manager.IsRegisterGroupEnabled("bmsDetail"), false);
  });
});

describe("Modbus exceptions", () => {
  it("fails a rejected write at once instead of retrying into timeouts", async function () {
    this.timeout(10000);

    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      buildExceptionResponse(0x06, 2),
    ]);
    const inverter = createInverter(socket);

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 5,
      }),
      true,
    );

    const started = Date.now();

    assert.equal(await inverter.WriteRegister(47511, 4), false);
    assert.ok(
      Date.now() - started < 1000,
      "a rejected write must not wait out six timeouts",
    );
    // An answered request proves the inverter is reachable, so the adapter must
    // not drop to offline just because it declined this register.
    assert.equal(inverter.Status, true);
  });

  it("keeps the repeated rejection away from the next request", async function () {
    this.timeout(10000);

    // Seen live on a GW10K-ET: the dongle answers a rejected register twice,
    // 240 to 280 ms apart, and answers the next request only after that. Sent
    // at once, the next request took the second rejection as its own.
    let sent = 0;
    const socket = new EventEmitter() as EventEmitter & {
      send: FakeSocket["send"];
      close: () => void;
    };
    socket.close = noop;
    socket.send = (_buffer, _offset, _length, _port, _ip, callback) => {
      sent++;
      callback(undefined);
      const emitAfter = (ms: number, frame: Buffer): void => {
        setTimeout(() => socket.emit("message", frame), ms);
      };

      if (sent === 1) {
        emitAfter(1, buildIdInfoResponse());
      } else if (sent === 2) {
        emitAfter(5, buildExceptionResponse(0x03, 2));
        emitAfter(280, buildExceptionResponse(0x03, 2));
      } else {
        emitAfter(
          sent === 3 ? 300 : 5,
          buildRegisterResponse(registerGroups.bmsInfo, (response) => {
            response.writeUInt16BE(77, 5 + (37007 - 37002) * 2);
          }),
        );
      }
    };
    const inverter = createInverter(socket);

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, { retries: 0 }),
      true,
    );
    assert.equal(
      await inverter.ReadGroup("powerLimit", { optional: true }),
      false,
    );
    assert.equal(await inverter.ReadGroup("bmsInfo"), true);
    assert.equal(inverter.BmsInfo.SOC, 77);
  });

  it("reports the exception code instead of a timeout", async () => {
    const messages: string[] = [];
    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      buildExceptionResponse(0x03, 2),
    ]);
    const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {
      "node:dgram": { createSocket: () => socket },
    }) as { GoodWeUdp: new (logHost: { log: ioBroker.Logger }) => GoodWeUdp };
    const inverter = new GoodWeUdp({
      log: {
        ...testLogger,
        warn: (message: string) => messages.push(message),
      },
    });

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, { retries: 3 }),
      true,
    );
    assert.equal(await inverter.ReadGroup("powerLimit"), false);
    assert.match(messages[0], /Modbus exception 2 \(illegal data address\)/);
  });
});

describe("request serialization", () => {
  it("sends the next request only after the running one is answered", async () => {
    const inFlight: number[] = [];
    let concurrent = 0;
    const socket = new (class extends EventEmitter {
      send(
        _buffer: Uint8Array,
        _offset: number,
        _length: number,
        _port: number,
        _ip: string,
        callback: (error?: Error) => void,
      ): void {
        concurrent++;
        inFlight.push(concurrent);
        callback(undefined);
        setTimeout(() => {
          concurrent--;
          this.emit(
            "message",
            buildRegisterResponse(registerGroups.settingsEms, () => {}),
          );
        }, 5);
      }

      close(): void {}
    })();
    const inverter = createInverter(socket);

    await Promise.all([
      inverter.ReadGroup("settingsEms"),
      inverter.ReadGroup("settingsEms"),
      inverter.ReadGroup("settingsEms"),
    ]);

    assert.deepEqual(inFlight, [1, 1, 1]);
  });
});

describe("runtime config normalization", () => {
  it("keeps UDP unless the transport is set to tcp", () => {
    assert.equal(normalizeTransport("tcp"), "tcp");
    assert.equal(normalizeTransport(" TCP "), "tcp");
    assert.equal(normalizeTransport("udp"), "udp");
    // Configs from before the option and hand edits must stay on UDP.
    assert.equal(normalizeTransport(undefined), "udp");
    assert.equal(normalizeTransport(""), "udp");
    assert.equal(normalizeTransport("modbus"), "udp");
    assert.equal(normalizeTransport(502), "udp");
  });

  it("normalizes boolean options from booleans, strings and numbers", () => {
    assert.equal(normalizeBoolean(true, false), true);
    assert.equal(normalizeBoolean(false, true), false);
    assert.equal(normalizeBoolean("true", false), true);
    assert.equal(normalizeBoolean("FALSE", true), false);
    assert.equal(normalizeBoolean("1", false), true);
    assert.equal(normalizeBoolean("0", true), false);
    assert.equal(normalizeBoolean("", true), false);
    assert.equal(normalizeBoolean(1, false), true);
    assert.equal(normalizeBoolean(0, true), false);
  });

  it("falls back to the io-package default for missing and invalid values", () => {
    assert.equal(normalizeBoolean(undefined, true), true);
    assert.equal(normalizeBoolean(null, false), false);
    assert.equal(normalizeBoolean("maybe", true), true);
    assert.equal(normalizeBoolean({}, false), false);
  });

  it("normalizes a stored native config in place", () => {
    const config: Record<string, unknown> = {
      pollExtended: "false",
      pollSimccid: "true",
      pollBmsDetail: 1,
    };

    normalizeBooleanConfig(config);

    assert.equal(config.pollExtended, false);
    assert.equal(config.pollSimccid, true);
    assert.equal(config.pollBmsDetail, true);
    assert.equal(config.pollFlashInfo, true);
    assert.equal(config.pollPowerLimit, false);
  });

  it("covers every optional register group switch", () => {
    for (const configKey of Object.values(optionalGroupConfigs)) {
      assert.equal(configKey in booleanDefaults, true, configKey);
    }
  });

  it("keeps optional groups enabled for string typed switches", () => {
    const manager = (config: Record<string, unknown>): GoodWeStateManager =>
      new GoodWeStateManager(
        {
          config: config as unknown as ioBroker.AdapterConfig,
          log: testLogger,
          setObjectNotExistsAsync: () => Promise.resolve(undefined),
          extendObjectAsync: () => Promise.resolve(undefined),
          getObjectAsync: () => Promise.resolve(undefined),
          delObjectAsync: () => Promise.resolve(undefined),
          setStateChangedAsync: () => Promise.resolve(undefined),
        },
        {} as unknown as GoodWeUdp,
      );

    assert.equal(
      manager({ ...testConfig, pollFlashInfo: "true" }).IsRegisterGroupEnabled(
        "flashInfo",
      ),
      true,
    );
    assert.equal(
      manager({ ...testConfig, pollFlashInfo: "false" }).IsRegisterGroupEnabled(
        "flashInfo",
      ),
      false,
    );
    assert.equal(
      manager({
        ...testConfig,
        pollExtended: "false",
        pollFlashInfo: true,
      }).IsRegisterGroupEnabled("flashInfo"),
      false,
    );
  });
});

describe("unload safety", () => {
  it("stops writing states once the adapter unloaded", async () => {
    const writes: StateWrite[] = [];
    const manager = new GoodWeStateManager(
      {
        config: testConfig,
        log: testLogger,
        setObjectNotExistsAsync: () => Promise.resolve(undefined),
        extendObjectAsync: () => Promise.resolve(undefined),
        getObjectAsync: () => Promise.resolve(undefined),
        delObjectAsync: () => Promise.resolve(undefined),
        setStateChangedAsync: (
          id: string,
          value: ioBroker.StateValue,
          ack: boolean,
        ) => {
          writes.push({ id, value, ack });
          return Promise.resolve(undefined);
        },
      },
      {} as unknown as GoodWeUdp,
    );

    await manager.SetConnection(true);
    manager.Stop();
    await manager.SetConnection(false);

    assert.deepEqual(writes, [
      { id: "info.connection", value: true, ack: true },
    ]);
  });
});

describe("reconnect backoff", () => {
  it("stops hammering the inverter while it stays offline", async () => {
    let idInfoCalls = 0;
    const inverter = {
      Status: false,
      ReadIdInfo: () => {
        idInfoCalls++;
        return Promise.resolve(false);
      },
    } as unknown as GoodWeUdp;
    const states = {
      SetConnection: () => Promise.resolve(undefined),
    } as unknown as GoodWeStateManager;
    const scheduler = new GoodWePollScheduler(
      {
        config: testConfig,
        log: testLogger,
        setTimeout: () => 1 as ioBroker.Timeout,
        clearTimeout: noop,
      },
      inverter,
      states,
      1000,
    );

    for (let tick = 0; tick < 8; tick++) {
      await scheduler.Poll();
    }

    assert.equal(idInfoCalls, 3);
  });
});

describe("UDP frame safety", () => {
  it("decodes unsigned 32 bit registers above 2^31", async () => {
    const socket = new FakeSocket(() => {
      return buildRegisterResponse(registerGroups.runningData, (response) => {
        response.writeUInt32BE(0xffffffff, 5 + (35220 - 35100) * 2);
      });
    });
    const inverter = createInverter(socket);

    assert.equal(await inverter.ReadGroup("runningData"), true);
    assert.equal(inverter.RunningData.DiagStatusL, 4294967295);
  });

  it("discards a late answer that matches the next request", async function () {
    this.timeout(10000);

    const staleFrame = buildRegisterResponse(
      registerGroups.flashInfo,
      (response) => {
        response.writeUInt16BE(0x1234, 5);
      },
    );
    const sockets: ScriptedSocket[] = [];
    const inverter = createInverterWithSockets(() => {
      const socket = new ScriptedSocket(
        sockets.length === 0 ? [buildIdInfoResponse(), null] : [null],
      );

      sockets.push(socket);

      return socket;
    });

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    // flashInfo stays unanswered and times out, which rebinds the socket.
    assert.equal(
      await inverter.ReadGroup("flashInfo", { optional: true }),
      false,
    );
    assert.equal(sockets.length, 2);

    // The inverter answers the abandoned request after the rebind. powerLimit
    // reads the same number of registers, so that answer would match its
    // matcher - it must not reach the new socket.
    sockets[0].emit("message", staleFrame);

    assert.equal(
      await inverter.ReadGroup("powerLimit", { optional: true }),
      false,
    );
    assert.deepEqual(inverter.PowerLimit, {});
  });

  it("recovers when the timed out answer never arrives", async function () {
    this.timeout(10000);

    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      // The answer to the first register read is lost on the network.
      null,
      buildRegisterResponse(registerGroups.runningData, () => {}),
    ]);
    const inverter = createInverter(socket);

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    assert.equal(await inverter.ReadGroup("runningData"), false);
    // The lost frame never shows up, so the next answer has to be accepted
    // instead of being dropped as the late one forever.
    assert.equal(await inverter.ReadGroup("runningData"), true);
  });

  it("reads an optional group again at once when its backoff is off", async function () {
    this.timeout(10000);

    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      null,
      buildRegisterResponse(registerGroups.settingsEms, () => {}),
    ]);
    const inverter = createInverter(socket);
    const options = { optional: true, backoff: false };

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    assert.equal(await inverter.ReadGroup("settingsEms", options), false);
    assert.equal(await inverter.ReadGroup("settingsEms", options), true);
  });

  it("pauses an optional group after a failed read", async function () {
    this.timeout(10000);

    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      null,
      buildRegisterResponse(registerGroups.flashInfo, () => {}),
    ]);
    const inverter = createInverter(socket);
    let sent = 0;
    const send = socket.send.bind(socket);

    socket.send = (...args: Parameters<ScriptedSocket["send"]>) => {
      sent++;
      send(...args);
    };

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    assert.equal(
      await inverter.ReadGroup("flashInfo", { optional: true }),
      false,
    );
    assert.equal(sent, 2);
    // Paused for an hour: no request, although the inverter would answer now.
    assert.equal(
      await inverter.ReadGroup("flashInfo", { optional: true }),
      false,
    );
    assert.equal(sent, 2);
    // The connection stays online, only the group sleeps.
    assert.equal(inverter.Status, true);
    assert.equal(await inverter.ReadGroup("flashInfo"), true);
  });

  it("warns once when the inverter stops answering", async function () {
    this.timeout(10000);

    const warnings: string[] = [];
    const socket = new ScriptedSocket([buildIdInfoResponse(), null]);
    const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {
      "node:dgram": { createSocket: () => socket },
    }) as { GoodWeUdp: new (logHost: { log: ioBroker.Logger }) => GoodWeUdp };
    const inverter = new GoodWeUdp({
      log: {
        ...testLogger,
        warn: (message: string) => warnings.push(message),
      },
    });

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    assert.equal(await inverter.ReadIdInfo(), false);
    assert.equal(await inverter.ReadIdInfo(), false);

    // The scheduler keeps probing while the inverter is gone; only the
    // transition is worth a warning.
    assert.deepEqual(warnings, [
      "ReadIdInfo: ReadIdInfo timed out after 1000 ms",
    ]);
  });

  it("reads a paused optional group again after a reconnect", async function () {
    this.timeout(10000);

    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      // The inverter drops off the network: the optional read pauses its group,
      // the live read takes the connection down.
      null,
      null,
      buildIdInfoResponse(),
      buildRegisterResponse(registerGroups.settingsBattery, () => {}),
    ]);
    const inverter = createInverter(socket);
    const options = { optional: true };

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 0,
      }),
      true,
    );
    assert.equal(await inverter.ReadGroup("settingsBattery", options), false);
    assert.equal(await inverter.ReadGroup("runningData"), false);
    assert.equal(inverter.Status, false);
    assert.equal(await inverter.ReadIdInfo(), true);
    // The group only failed because the inverter was gone, so it must not stay
    // paused for an hour.
    assert.equal(await inverter.ReadGroup("settingsBattery", options), true);
  });

  it("stays online while a retry recovers a lost answer", async function () {
    this.timeout(10000);

    const socket = new ScriptedSocket([
      buildIdInfoResponse(),
      null,
      buildRegisterResponse(registerGroups.runningData, () => {}),
    ]);
    const inverter = createInverter(socket);
    const statusAtSend: boolean[] = [];
    const send = socket.send.bind(socket);

    socket.send = (...args: Parameters<ScriptedSocket["send"]>) => {
      statusAtSend.push(inverter.Status);
      send(...args);
    };

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 1,
      }),
      true,
    );
    assert.equal(await inverter.ReadGroup("runningData"), true);
    // Connect, first attempt, retry. A control write arriving during the retry
    // reads this status and would be refused as offline.
    assert.deepEqual(statusAtSend, [false, true, true]);
  });

  it("stays quiet about requests the unload cut off", async () => {
    const warnings: string[] = [];
    const socket = new ScriptedSocket([buildIdInfoResponse(), null]);
    const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {
      "node:dgram": { createSocket: () => socket },
    }) as { GoodWeUdp: new (logHost: { log: ioBroker.Logger }) => GoodWeUdp };
    const inverter = new GoodWeUdp({
      log: {
        ...testLogger,
        warn: (message: string) => warnings.push(message),
      },
    });

    assert.equal(
      await inverter.Connect("192.168.178.42", 8899, {
        timeoutMs: 1000,
        retries: 2,
      }),
      true,
    );

    const write = inverter.WriteRegister(47511, 4);
    const read = inverter.ReadGroup("runningData");

    await new Promise((resolve) => setImmediate(resolve));
    inverter.destructor();

    assert.equal(await write, false);
    assert.equal(await read, false);
    assert.equal(inverter.Closed, true);
    // The adapter is shutting down; a warning here only reads like a fault.
    assert.deepEqual(warnings, []);
  });

  it("logs an unmatched frame when the logger appears after construction", () => {
    const socket = new EventEmitter();
    const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {
      "node:dgram": { createSocket: () => socket },
    }) as { GoodWeUdp: new (logHost: { log: ioBroker.Logger }) => GoodWeUdp };
    // The adapter assigns its logger asynchronously after the constructor ran.
    const logHost = {} as { log: ioBroker.Logger };

    new GoodWeUdp(logHost);
    logHost.log = testLogger;

    assert.doesNotThrow(() => socket.emit("message", Buffer.alloc(8)));
  });
});

describe("BMS status high words", () => {
  it("keeps the reserved high words out of the decoded alarm text", () => {
    const states = getDecodedBmsStatuses(
      {
        ErrorCode: 0b11,
        // Bit 16~31 of both codes are reserved in GoodWe API v1.7
        // (tables 8-7 and 8-8), so a set high word must not change the text.
        ErrorCodeH: 0xffff,
        WarningCodeL: 0b1,
        WarningCodeH: 0xffff,
        DRMStatus: 0,
      },
      true,
    );

    assert.equal(
      states.find((state) => state.id === "BMSInfo.ErrorCodeActive")?.value,
      "Charging over-voltage2, Discharging under-voltage2",
    );
    assert.equal(
      states.find((state) => state.id === "BMSInfo.WarningCodeActive")?.value,
      "Charging over-voltage1",
    );
  });
});

describe("Modbus TCP transport", () => {
  const servers: FakeModbusTcpServer[] = [];
  const tcp = { timeoutMs: 1000, transport: "tcp" as const };

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function startServer(
    answer: (request: Buffer, socket: net.Socket) => void,
  ): Promise<FakeModbusTcpServer> {
    const server = await FakeModbusTcpServer.start(answer);

    servers.push(server);

    return server;
  }

  it("reads register groups as Modbus TCP requests", async function () {
    this.timeout(10000);

    const server = await startServer((request, socket) => {
      socket.write(
        request.readUInt16BE(8) === 35000
          ? toModbusTcpAnswer(request, buildReadAnswer(1))
          : toModbusTcpAnswer(
              request,
              buildRegisterResponse(registerGroups.runningData, (response) => {
                response.writeInt16BE(-230, 5 + (35140 - 35100) * 2);
                response.writeUInt16BE(2315, 5 + (35121 - 35100) * 2);
              }),
            ),
      );
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 0 }),
      true,
    );
    assert.equal(await inverter.ReadGroup("runningData"), true);
    assert.equal(inverter.RunningData.AcActivePower, -230);
    assert.equal(inverter.RunningData.GridL1.Voltage, 231.5);
    inverter.destructor();

    // MBAP header with a counting transaction id, protocol 0 and the length of
    // unit id plus PDU, then the RTU frame without its CRC.
    assert.equal(
      server.requests[0].toString("hex"),
      "000100000006f70388b80001",
    );
    assert.equal(server.requests[1].readUInt16BE(0), 2);
    assert.equal(server.requests[1].readUInt16BE(8), 35100);
    assert.equal(
      server.requests[1].readUInt16BE(10),
      registerGroups.runningData.count,
    );
    assert.equal(server.connections, 1);
  });

  it("joins an answer split across segments and skips a stale one", async function () {
    this.timeout(10000);

    const server = await startServer((request, socket) => {
      const answer = toModbusTcpAnswer(request, buildReadAnswer(1));
      // A rejection: taken for the answer, it would fail the request.
      const stale = toModbusTcpAnswer(request, buildExceptionResponse(0x03, 2));

      stale.writeUInt16BE(request.readUInt16BE(0) - 1, 0);
      socket.write(Buffer.concat([stale, answer.subarray(0, 4)]));
      globalThis.setTimeout(() => socket.write(answer.subarray(4)), 50);
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 0 }),
      true,
    );
    inverter.destructor();
  });

  it("fails a rejected write at once", async function () {
    this.timeout(10000);

    const server = await startServer((request, socket) => {
      const functionCode = request[7];

      socket.write(
        toModbusTcpAnswer(
          request,
          functionCode === 0x03
            ? buildReadAnswer(1)
            : buildExceptionResponse(functionCode, 2),
        ),
      );
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 3 }),
      true,
    );

    const started = Date.now();

    assert.equal(await inverter.WriteRegister(47511, 4), false);
    // Neither a timeout nor the 600 ms the UDP dongle needs to repeat its
    // rejection: over Modbus TCP the repetition has the old transaction id.
    assert.ok(Date.now() - started < 300, "a rejection must not wait");
    assert.equal(inverter.Status, true);
    inverter.destructor();
  });

  it("keeps the connection when an answer is lost", async function () {
    this.timeout(10000);

    let requests = 0;
    const server = await startServer((request, socket) => {
      // The answer to the first request never arrives.
      if (requests++ > 0) {
        socket.write(toModbusTcpAnswer(request, buildReadAnswer(1)));
      }
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 1 }),
      true,
    );
    // The dongle 2.0 has few client slots; a reconnect per lost answer could
    // use them up.
    assert.equal(server.connections, 1);
    inverter.destructor();
  });

  it("connects again once every attempt is lost", async function () {
    this.timeout(10000);

    let firstConnection: net.Socket | undefined;
    const server = await startServer((request, socket) => {
      firstConnection ??= socket;

      // A half open connection: the dongle rebooted and forgot it.
      if (socket !== firstConnection) {
        socket.write(toModbusTcpAnswer(request, buildReadAnswer(1)));
      }
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 1 }),
      false,
    );
    assert.equal(server.connections, 1);
    assert.equal(await inverter.ReadIdInfo(), true);
    assert.equal(server.connections, 2);
    inverter.destructor();
  });

  it("connects again after the dongle closed the connection", async function () {
    this.timeout(10000);

    const server = await startServer((request, socket) => {
      socket.end(toModbusTcpAnswer(request, buildReadAnswer(1)));
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 0 }),
      true,
    );
    // Let the client see the close before it sends again.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    assert.equal(await inverter.ReadIdInfo(), true);
    assert.equal(server.connections, 2);
    inverter.destructor();
  });

  // 0 and 1 cannot hold unit id and function code, 255 is one byte more than
  // the largest Modbus frame, 0xffff would wait for 64 KiB that never come.
  for (const length of [0, 1, 255, 0xffff]) {
    it(`connects again after an answer with length field ${length}`, async function () {
      this.timeout(10000);

      let answered = 0;
      const server = await startServer((request, socket) => {
        const answer = toModbusTcpAnswer(request, buildReadAnswer(1));

        if (answered++ === 0) {
          answer.writeUInt16BE(length, 4);
        }

        socket.write(answer);
      });
      const inverter = createTcpInverter();

      assert.equal(
        await inverter.Connect("127.0.0.1", server.port, {
          ...tcp,
          retries: 1,
        }),
        true,
      );
      assert.equal(server.connections, 2);
      inverter.destructor();
    });
  }

  it("accepts an answer of the largest Modbus frame", async function () {
    this.timeout(10000);

    // 125 registers: unit id, function code, byte count and 250 data bytes,
    // the 254 the length field may hold at most.
    const server = await startServer((request, socket) => {
      socket.write(
        toModbusTcpAnswer(request, buildReadAnswer(request.readUInt16BE(10))),
      );
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 0 }),
      true,
    );
    assert.equal(registerGroups.runningData.count, 125);
    assert.equal(await inverter.ReadGroup("runningData"), true);
    assert.equal(server.connections, 1);
    inverter.destructor();
  });

  it("names the cause when the connection is refused", async function () {
    this.timeout(10000);

    const server = await startServer(() => {});
    const port = server.port;

    await server.close();

    const messages: string[] = [];
    const inverter = createTcpInverter({
      ...testLogger,
      debug: (message: string) => messages.push(message),
    });

    assert.equal(
      await inverter.Connect("127.0.0.1", port, { ...tcp, retries: 0 }),
      false,
    );
    assert.equal(inverter.Status, false);
    assert.ok(
      messages.some((message) => message.includes("ECONNREFUSED")),
      messages.join("\n"),
    );
  });

  it("sends nothing after the unload", async function () {
    this.timeout(10000);

    const server = await startServer((request, socket) => {
      socket.write(toModbusTcpAnswer(request, buildReadAnswer(1)));
    });
    const inverter = createTcpInverter();

    assert.equal(
      await inverter.Connect("127.0.0.1", server.port, { ...tcp, retries: 0 }),
      true,
    );
    inverter.destructor();
    assert.equal(await inverter.ReadIdInfo(), false);
    assert.equal(server.requests.length, 1);
  });
});

describe("Modbus TCP discovery", () => {
  const servers: FakeModbusTcpServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  async function probeServer(
    answer: (request: Buffer) => Buffer,
  ): Promise<DiscoveryTypes.ProbeResult> {
    const server = await FakeModbusTcpServer.start((request, socket) =>
      socket.write(toModbusTcpAnswer(request, answer(request))),
    );

    servers.push(server);

    return probeModbusTcp({ log: testLogger }, "127.0.0.1", 1000, server.port);
  }

  it("reads model and serial number of a GoodWe inverter", async function () {
    this.timeout(10000);

    const result = await probeServer((request) =>
      request.readUInt16BE(10) === 1
        ? buildReadAnswer(1)
        : buildRegisterResponse(registerGroups.deviceInfo, (response) => {
            writeAscii(response, 5 + 3 * 2, 16, "5010KETU229W0123");
            writeAscii(response, 5 + 11 * 2, 10, "GW8KN-ET");
          }),
    );

    assert.deepEqual(result, {
      ip: "127.0.0.1",
      reachable: true,
      transport: "tcp",
      idInfo: {
        modelName: "GW8KN-ET",
        serialNumber: "5010KETU229W0123",
        internalVersion: "",
      },
    });
  });

  it("skips a Modbus device that rejects the GoodWe registers", async function () {
    this.timeout(10000);

    const result = await probeServer(() => buildExceptionResponse(0x03, 2));

    assert.equal(result.reachable, false);
  });

  it("skips a Modbus device without a serial number in 35003", async function () {
    this.timeout(10000);

    const result = await probeServer((request) =>
      request.readUInt16BE(10) === 1
        ? buildReadAnswer(1)
        : buildRegisterResponse(registerGroups.deviceInfo, (response) => {
            // Control bytes are no serial number either.
            response.fill(0x01, 5 + 3 * 2, 5 + 11 * 2);
          }),
    );

    assert.equal(result.reachable, false);
    assert.match(result.error ?? "", /no GoodWe inverter/);
  });

  function loadDiscovery(answerUdp: boolean): {
    discovery: typeof DiscoveryTypes;
    udpSockets: () => number;
  } {
    let udpSockets = 0;
    const discovery = proxyquire("../src/lib/goodwe-discovery", {
      "node:dgram": {
        createSocket: () => {
          udpSockets++;
          return new IdInfoSocket(answerUdp);
        },
      },
    }) as typeof DiscoveryTypes;

    return { discovery, udpSockets: () => udpSockets };
  }

  it("searches only with the probe of the selected connection", async () => {
    const { discovery, udpSockets } = loadDiscovery(true);
    const result = await discovery.discoverGoodWeInverters({
      subnet: "192.168.178.0/24",
      timeoutMs: 100,
      concurrency: 254,
      probe: (ip) =>
        Promise.resolve(
          ip === "192.168.178.42"
            ? { ip, reachable: true, transport: "tcp" }
            : { ip, reachable: false },
        ),
    });

    assert.equal(result.searched, 254);
    assert.deepEqual(result.found, [
      { ip: "192.168.178.42", reachable: true, transport: "tcp" },
    ]);
    // The UDP probe would list a dongle answering both protocols a second time.
    assert.equal(udpSockets(), 0);
  });

  it("searches over UDP without a probe", async () => {
    const { discovery } = loadDiscovery(true);
    const result = await discovery.discoverGoodWeInverters({
      subnet: "192.168.178.0/24",
      timeoutMs: 100,
      concurrency: 254,
    });

    assert.equal(result.found.length, 254);
    assert.equal(result.found[0].transport, "udp");
    assert.equal(result.found[0].idInfo?.modelName, "GW10K-ET");
  });

  it("reports an address without UDP answer as unreachable", async () => {
    const { discovery } = loadDiscovery(false);
    const result = await discovery.probeGoodWeInverter("192.168.178.42", {
      timeoutMs: 100,
    });

    assert.deepEqual(result, {
      ip: "192.168.178.42",
      reachable: false,
      error: "No GoodWe response within 100 ms",
    });
  });
});

describe("admin messages", () => {
  // Records which probe runs; neither one reaches the network.
  function loadAdminMessages(): {
    handleAdapterMessage: typeof AdminMessages.handleAdapterMessage;
    probes: string[];
  } {
    const probes: string[] = [];
    const { handleAdapterMessage } = proxyquire("../src/api/admin-messages", {
      "../GoodWe/GoodWe": {
        GoodWeUdp: class {
          Connect(ip: string, port: number): Promise<boolean> {
            probes.push(`tcp ${ip}:${port}`);
            return Promise.resolve(false);
          }

          destructor(): void {}
        },
      },
      "../lib/goodwe-discovery": {
        probeGoodWeInverter: (ip: string) => {
          probes.push(`udp ${ip}`);
          return Promise.resolve({ ip, reachable: false });
        },
        discoverGoodWeInverters: async (
          options: DiscoveryTypes.DiscoveryOptions,
        ) => {
          await options.probe?.("192.168.178.7", 700);
          return { searched: 1, found: [] };
        },
      },
    }) as typeof AdminMessages;

    return { handleAdapterMessage, probes };
  }

  async function send(
    command: string,
    message: Record<string, unknown>,
    config: Partial<ioBroker.AdapterConfig>,
  ): Promise<{ probes: string[]; response: Record<string, unknown> }> {
    const { handleAdapterMessage, probes } = loadAdminMessages();
    const responses: Record<string, unknown>[] = [];

    await handleAdapterMessage(
      {
        config: { ...testConfig, ...config },
        log: testLogger,
        sendTo: (_instance, _command, payload) => responses.push(payload),
      },
      {
        command,
        message,
        from: "system.adapter.admin.0",
        callback: { message: {}, id: 1, ack: false, time: 0 },
      } as unknown as ioBroker.Message,
    );

    return { probes, response: responses[0] };
  }

  it("checks the IP with the transport of the unsaved form", async () => {
    const { probes, response } = await send(
      "validateIp",
      { ip: "192.168.178.42", transport: "tcp" },
      { transport: "udp" },
    );

    assert.deepEqual(probes, ["tcp 192.168.178.42:502"]);
    assert.equal(response.reachable, false);
    assert.match(String(response.error), /192\.168\.178\.42:502/);
  });

  it("checks the IP with the stored transport when the form sends none", async () => {
    assert.deepEqual(
      (await send("validateIp", { ip: "192.168.178.42" }, { transport: "tcp" }))
        .probes,
      ["tcp 192.168.178.42:502"],
    );
    assert.deepEqual(
      (
        await send(
          "validateIp",
          { ip: "192.168.178.42", transport: "udp" },
          { transport: "tcp" },
        )
      ).probes,
      ["udp 192.168.178.42"],
    );
  });

  it("searches with the selected transport only", async () => {
    assert.deepEqual(
      (await send("discoverInverters", { transport: "tcp" }, {})).probes,
      ["tcp 192.168.178.7:502"],
    );
    assert.deepEqual(
      (await send("discoverInverters", {}, { transport: "udp" })).probes,
      ["udp 192.168.178.7"],
    );
  });

  it("refuses an invalid IP without probing", async () => {
    const { probes, response } = await send(
      "validateIp",
      { ip: "127.0.0.1" },
      { ipAddr: "" },
    );

    assert.deepEqual(probes, []);
    assert.equal(response.valid, false);
    // An unusable address in the form falls back to the stored one, empty here.
    assert.equal(response.error, "IP address must contain four octets");
  });

  it("answers an unknown command with an error", async () => {
    const { response } = await send("reboot", {}, {});

    assert.equal(response.error, "Unknown command: reboot");
  });
});

describe("admin message limits", () => {
  it("clamps probe timeouts from admin messages", () => {
    assert.equal(clampProbeTimeout(undefined), 700);
    assert.equal(clampProbeTimeout("not a number"), 700);
    assert.equal(clampProbeTimeout(0), 700);
    assert.equal(clampProbeTimeout(1), 100);
    assert.equal(clampProbeTimeout(1e9), 10000);
    assert.equal(clampProbeTimeout(1500.9), 1500);
  });
});

function createTcpInverter(log: ioBroker.Logger = testLogger): GoodWeUdp {
  const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {}) as {
    GoodWeUdp: new (logHost: { log: ioBroker.Logger }) => GoodWeUdp;
  };

  return new GoodWeUdp({ log });
}

// Read answer in the AA55 format with the given number of zero registers.
function buildReadAnswer(count: number): Buffer {
  return buildRegisterResponse(
    { ...registerGroups.deviceInfo, count, entries: [] },
    () => {},
  );
}

// Turns an AA55 answer into the Modbus TCP answer to the given request: MBAP
// header of the request, unit id and PDU, no CRC.
function toModbusTcpAnswer(request: Buffer, frame: Buffer): Buffer {
  const unitAndPdu = frame.subarray(2, frame.length - 2);
  const header = Buffer.from(request.subarray(0, 6));

  header.writeUInt16BE(unitAndPdu.length, 4);

  return Buffer.concat([header, unitAndPdu]);
}

// Hands every 12 byte request to the answer callback; the client sends one
// register read or write at a time, each 12 bytes long.
class FakeModbusTcpServer {
  readonly requests: Buffer[] = [];
  connections = 0;
  private readonly sockets = new Set<net.Socket>();
  private readonly server: net.Server;

  private constructor(answer: (request: Buffer, socket: net.Socket) => void) {
    this.server = net.createServer((socket) => {
      let received = Buffer.alloc(0);

      this.connections++;
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("data", (chunk) => {
        received = Buffer.concat([received, chunk]);

        while (received.length >= 12) {
          const request = received.subarray(0, 12);

          received = received.subarray(12);
          this.requests.push(request);
          answer(request, socket);
        }
      });
    });
  }

  static async start(
    answer: (request: Buffer, socket: net.Socket) => void,
  ): Promise<FakeModbusTcpServer> {
    const server = new FakeModbusTcpServer(answer);

    await new Promise<void>((resolve) =>
      server.server.listen(0, "127.0.0.1", resolve),
    );

    return server;
  }

  get port(): number {
    return (this.server.address() as net.AddressInfo).port;
  }

  close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }

    // Closed twice by the refused connection test: the second call would
    // otherwise never resolve.
    if (!this.server.listening) {
      return Promise.resolve();
    }

    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

// UDP discovery socket that answers the ID request, or stays silent.
class IdInfoSocket extends EventEmitter {
  private readonly answer: boolean;

  constructor(answer: boolean) {
    super();
    this.answer = answer;
  }

  send(
    _request: Buffer,
    _port: number,
    _ip: string,
    callback: (error: Error | null) => void,
  ): void {
    callback(null);

    if (this.answer) {
      process.nextTick(() => this.emit("message", buildIdInfoResponse()));
    }
  }

  close(): void {}
}

// Answers the n-th send with frames[n], or nothing when that entry is null.
// The last entry is repeated for every further send.
class ScriptedSocket extends EventEmitter {
  private readonly frames: (Buffer | null)[];
  private sendCount = 0;

  constructor(frames: (Buffer | null)[]) {
    super();
    this.frames = frames;
  }

  send(
    _buffer: Buffer,
    _offset: number,
    _length: number,
    _port: number,
    _ip: string,
    callback: (error?: Error) => void,
  ): void {
    callback(undefined);

    const frame =
      this.sendCount < this.frames.length
        ? this.frames[this.sendCount]
        : this.frames[this.frames.length - 1];

    this.sendCount++;

    if (frame) {
      process.nextTick(() => this.emit("message", frame));
    }
  }

  close(): void {}
}
