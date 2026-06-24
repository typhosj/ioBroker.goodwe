"use strict";

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

import * as utils from "@iobroker/adapter-core";
import {
  type AdapterMessage,
  handleAdapterMessage,
} from "./api/admin-messages";
import { GoodWeUdp } from "./GoodWe/GoodWe";
import {
  extractIpv4Address,
  validateIpv4Address,
} from "./lib/goodwe-discovery";
import { GoodWePollScheduler } from "./scheduler";
import GoodWeStateManager from "./states";

class Goodwe extends utils.Adapter {
  inverter = new GoodWeUdp(this.log);
  states = new GoodWeStateManager(this, this.inverter);
  pollScheduler = new GoodWePollScheduler(
    this,
    this.inverter,
    this.states,
    1000,
  );

  /**
   * @param [options]
   */
  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({
      ...options,
      name: "goodwe",
    });

    this.on("ready", this.onReady.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  InitializeServices(): void {
    this.inverter = new GoodWeUdp(this.log);
    this.states = new GoodWeStateManager(this, this.inverter);
    this.pollScheduler = new GoodWePollScheduler(
      this,
      this.inverter,
      this.states,
      1000,
    );
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady(): Promise<void> {
    this.InitializeServices();
    await this.states.InitializeObjects();
    await this.states.SetConnection(false);

    const configuredIp = extractIpv4Address(this.config.ipAddr);

    if (configuredIp === "") {
      this.log.warn("No inverter IP address configured yet");
      return;
    }

    this.config.ipAddr = configuredIp;
    const ipValidation = validateIpv4Address(this.config.ipAddr);

    if (!ipValidation.valid) {
      this.log.error(
        `Invalid inverter IP address "${this.config.ipAddr}": ${ipValidation.reason}`,
      );
      return;
    }

    await this.inverter.Connect(this.config.ipAddr, 8899, {
      timeoutMs: this.config.timeoutMs,
      retries: this.config.retries,
    });

    this.pollScheduler.start();
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback
   */
  onUnload(callback: () => void): void {
    try {
      this.pollScheduler.stop();
      this.inverter.destructor();

      callback();
    } catch (e) {
      this.log.error(`error: ${e}`);
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   *
   * @param id
   * @param state
   */
  onStateChange(id: string, state: ioBroker.State | null | undefined): void {
    if (state) {
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
    } else {
      this.log.info(`state ${id} deleted`);
    }
  }

  async onMessage(obj: AdapterMessage): Promise<void> {
    await handleAdapterMessage(this, obj);
  }
}

if (require.main !== module) {
  /**
   * @param [options]
   */
  module.exports = (options: Partial<utils.AdapterOptions> = {}) =>
    new Goodwe(options);
} else {
  new Goodwe({});
}
