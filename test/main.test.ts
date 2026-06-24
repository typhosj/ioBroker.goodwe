"use strict";

import assert from "node:assert/strict";
import EventEmitter from "node:events";
import proxyquire from "proxyquire";
import { PollScheduler } from "../src/scheduler";
import GoodWeStateManager from "../src/states";
import {
  optionalGroupConfigs,
  type RegisterGroup,
  registerGroups,
  TYPE,
} from "../src/lib/register-map";
import {
  bitfields,
  decodeBitfield,
  decodeValue,
  valueStates,
} from "../src/lib/status-definitions";
import {
  buildIdInfoRequest,
  clampDiscoveryConcurrency,
  extractIpv4Address,
  formatInverterOption,
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
    ]) {
      assert.ok(registerGroups[groupName], `${groupName} is missing`);
      assert.ok(registerGroups[groupName].entries.length > 0);
    }
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
  it("owns poll timeout lifecycle", async () => {
    let timeoutCallback: () => void = noop;
    let clearedTimer: ioBroker.Timeout | undefined;
    let pollCount = 0;
    const timer = 1 as ioBroker.Timeout;
    const adapter: SchedulerAdapterLike = {
      config: testConfig,
      log: testLogger,
      setStateChangedAsync: () => Promise.resolve(undefined),
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

function createInverter(socket: FakeSocket): GoodWeUdp {
  const { GoodWeUdp } = proxyquire("../src/GoodWe/GoodWe", {
    "node:dgram": {
      createSocket: () => socket,
    },
  }) as { GoodWeUdp: new (log: ioBroker.Logger) => GoodWeUdp };

  return new GoodWeUdp(testLogger);
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
