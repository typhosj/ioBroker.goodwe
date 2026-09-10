"use strict";

// Modbus exception codes the inverter can answer a read or write with.
const modbusExceptions: Record<number, string> = {
  1: "illegal function",
  2: "illegal data address",
  3: "illegal data value",
  4: "slave device failure",
  5: "acknowledge",
  6: "slave device busy",
  8: "memory parity error",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A request the inverter answered with a Modbus exception frame.
 *
 * Retrying does not help - an illegal register address stays illegal - so the
 * request layer aborts its retry loop when it sees this error.
 */
class ModbusExceptionError extends Error {
  readonly code: number;

  /**
   * @param name request name, used in the message
   * @param code Modbus exception code from the answer
   */
  constructor(name: string, code: number) {
    super(
      `${name} rejected by inverter: Modbus exception ${code} (${modbusExceptions[code] ?? "unknown"})`,
    );
    this.name = "ModbusExceptionError";
    this.code = code;
  }
}

export { errorMessage, ModbusExceptionError, modbusExceptions };
