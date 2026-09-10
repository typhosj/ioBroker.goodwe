"use strict";

import assert from "node:assert/strict";
import EventEmitter from "node:events";
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
});

describe("poll traffic", () => {
  // Every lost UDP request costs a retry, so the scheduler must not read more
  // registers than the data actually changes.
  function createPollScheduler(config: ioBroker.AdapterConfig): {
    reads: string[];
    scheduler: GoodWePollScheduler;
    setStatus: (online: boolean) => void;
  } {
    const reads: string[] = [];
    let online = true;
    const inverter = {
      get Status(): boolean {
        return online;
      },
      ReadIdInfo: () => Promise.resolve(true),
      ReadGroup: (groupName: string) => {
        reads.push(groupName);
        return Promise.resolve(true);
      },
    } as unknown as GoodWeUdp;
    const states = {
      IsRegisterGroupEnabled: (groupName: string) =>
        groupName !== "bmsDetail" && groupName !== "powerLimit",
      SetConnection: () => Promise.resolve(undefined),
      UpdateStatesFromRegisterMap: () => Promise.resolve(undefined),
      UpdateDecodedRunningStatuses: () => Promise.resolve(undefined),
      UpdateDecodedBmsStatuses: () => Promise.resolve(undefined),
      UpdateDerivedRunningStates: () => Promise.resolve(undefined),
    } as unknown as GoodWeStateManager;

    return {
      reads,
      scheduler: new GoodWePollScheduler(
        {
          config,
          log: testLogger,
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

    for (const groupName of ["runningData", "extComData", "bmsInfo"]) {
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

    const optional = reads.filter((groupName) =>
      Object.keys(optionalGroupConfigs).includes(groupName),
    );

    assert.deepEqual(optional, ["deviceSimccid", "extComDataExtended"]);
  });

  it("keeps the request count per minute well below the live cycle", async () => {
    const { reads, scheduler } = createPollScheduler({
      ...testConfig,
      pollCycle: 5,
    });

    for (let tick = 0; tick < 60; tick++) {
      await scheduler.Poll();
    }

    // Three live groups twelve times plus two optional reads plus the single
    // device info read. Every extra request is another one that can be lost.
    assert.equal(reads.length, 39);
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
    options: { writeConfirmed?: boolean; readBack?: boolean } = {},
  ): {
    acknowledged: StateWrite[];
    context: Parameters<typeof applyControlWrite>[0];
    reads: string[];
    updated: string[];
    writes: Array<{ address: number; value: number }>;
  } {
    const writes: Array<{ address: number; value: number }> = [];
    const reads: string[] = [];
    const updated: string[] = [];
    const acknowledged: StateWrite[] = [];

    return {
      acknowledged,
      context: {
        adapter: { log: testLogger, namespace: "goodwe.0" },
        inverter: {
          WriteRegister: (address: number, value: number) => {
            writes.push({ address, value });
            return Promise.resolve(options.writeConfirmed !== false);
          },
          ReadGroup: (groupName: string) => {
            reads.push(groupName);
            return Promise.resolve(options.readBack !== false);
          },
        },
        states: {
          IsControlEnabled: () => controlEnabled,
          UpdateStatesFromRegisterMap: (group: RegisterGroup) => {
            updated.push(group.name);
            return Promise.resolve();
          },
          Acknowledge: (id: string, value: ioBroker.StateValue) => {
            acknowledged.push({ id, value, ack: true });
            return Promise.resolve();
          },
        },
      },
      reads,
      updated,
      writes,
    };
  }

  it("clamps written values into the register range", () => {
    assert.equal(clampWriteValue(exportLimit, 3500.4), 3500);
    assert.equal(clampWriteValue(exportLimit, -1), 0);
    assert.equal(clampWriteValue(exportLimit, 99999), 30000);
    assert.equal(clampWriteValue(exportLimit, true), 1);
    assert.equal(clampWriteValue(exportLimit, "3500"), null);
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

  it("scales the state value into register units", () => {
    const scaled: RegisterEntry = {
      ...exportLimit,
      scale: 10,
      writable: { min: 0, max: 30000 },
    };

    assert.equal(clampWriteValue(scaled, 52.3), 523);
    assert.equal(clampWriteValue(scaled, 5000), 30000);
  });

  it("subscribes exactly the writable states", () => {
    assert.deepEqual(writableStateIds().sort(), [
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
      "goodwe.0.Settings.Battery.DischargeDepth",
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
      role: "value.battery",
      write: false,
    });
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
    assert.deepEqual(Array.from(writableGroups), ["settingsEms"]);

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
    assert.equal(manager.IsRegisterGroupEnabled("settingsBattery"), false);
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
