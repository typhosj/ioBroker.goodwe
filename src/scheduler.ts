"use strict";

import { optionalGroupConfigs, registerGroups } from "./lib/register-map";
import type { GoodWeUdp } from "./GoodWe/GoodWe";
import type GoodWeStateManager from "./states";

interface SchedulerAdapter {
  config: ioBroker.AdapterConfig;
  log: ioBroker.Logger;
  setTimeout: (callback: () => void, ms: number) => ioBroker.Timeout;
  clearTimeout: (timeout: ioBroker.Timeout) => void;
  setStateChangedAsync: (
    id: string,
    state: ioBroker.StateValue,
    ack: boolean,
  ) => Promise<unknown>;
}

class PollScheduler {
  private adapter: SchedulerAdapter;
  private poll: () => Promise<void>;
  private intervalMs: number;
  private active = false;
  private timer: ioBroker.Timeout | undefined;

  constructor(
    adapter: SchedulerAdapter,
    poll: () => Promise<void>,
    intervalMs: number,
  ) {
    this.adapter = adapter;
    this.poll = poll;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;
    void this.Run();
  }

  stop(): void {
    this.active = false;

    if (this.timer) {
      this.adapter.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async Run(): Promise<void> {
    try {
      await this.poll();
    } catch (error) {
      this.adapter.log.warn(`poll scheduler failed: ${error.message ?? error}`);
    } finally {
      if (this.active) {
        this.timer = this.adapter.setTimeout(() => {
          this.timer = undefined;
          if (!this.active) {
            return;
          }

          void this.Run();
        }, this.intervalMs);
      }
    }
  }
}

class GoodWePollScheduler {
  private adapter: SchedulerAdapter;
  private inverter: GoodWeUdp;
  private states: GoodWeStateManager;
  private cycleCnt = 0;
  private scheduler: PollScheduler;

  constructor(
    adapter: SchedulerAdapter,
    inverter: GoodWeUdp,
    states: GoodWeStateManager,
    intervalMs: number,
  ) {
    this.adapter = adapter;
    this.inverter = inverter;
    this.states = states;
    this.scheduler = new PollScheduler(adapter, () => this.Poll(), intervalMs);
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  async Poll(): Promise<void> {
    try {
      if (this.inverter.Status == false) {
        this.cycleCnt = 0;
        const success = await this.inverter.ReadIdInfo();
        await this.states.SetConnection(success);
      } else {
        switch (this.cycleCnt) {
          case 1:
            await this.UpdateDeviceInfo();
            break;

          case 3:
            await this.UpdateRunningData();
            break;

          case 5:
            await this.UpdateExtComData();
            break;

          case 7:
            await this.UpdateBmsInfo();
            break;

          case 9:
            if (this.adapter.config.pollExtended !== false) {
              await this.UpdateAdditionalRegisterGroups();
            }
            break;
        }

        if (this.cycleCnt >= this.adapter.config.pollCycle) {
          this.cycleCnt = 0;
        }

        this.cycleCnt++;
      }
    } catch (error) {
      this.adapter.log.warn(`poll cycle failed: ${error.message ?? error}`);
      await this.states.SetConnection(false);
    }
  }

  async UpdateDeviceInfo(): Promise<void> {
    const success = await this.inverter.ReadGroup("deviceInfo");

    if (!success) {
      await this.states.SetConnection(false);
      return;
    }

    await this.states.UpdateStatesFromRegisterMap(registerGroups.deviceInfo);
    await this.states.SetConnection(this.inverter.Status);
  }

  async UpdateRunningData(): Promise<void> {
    const success = await this.inverter.ReadGroup("runningData");

    if (!success) {
      await this.states.SetConnection(false);
      return;
    }

    await this.states.UpdateStatesFromRegisterMap(registerGroups.runningData);
    await this.states.UpdateDecodedRunningStatuses();
    await this.adapter.setStateChangedAsync(
      "RunningData.TotalPowerPv",
      this.inverter.RunningData.TotalPowerPv,
      true,
    );
  }

  async UpdateExtComData(): Promise<void> {
    const success = await this.inverter.ReadGroup("extComData");

    if (!success) {
      await this.states.SetConnection(false);
      return;
    }

    await this.states.UpdateStatesFromRegisterMap(registerGroups.extComData);
  }

  async UpdateBmsInfo(): Promise<void> {
    const success = await this.inverter.ReadGroup("bmsInfo");

    if (!success) {
      await this.states.SetConnection(false);
      return;
    }

    await this.states.UpdateStatesFromRegisterMap(registerGroups.bmsInfo);
    await this.states.UpdateDecodedBmsStatuses();
  }

  async UpdateAdditionalRegisterGroups(): Promise<void> {
    for (const groupName of Object.keys(optionalGroupConfigs)) {
      if (!this.states.IsRegisterGroupEnabled(groupName)) {
        continue;
      }

      const group = registerGroups[groupName];
      const success = await this.inverter.ReadGroup(groupName, {
        optional: true,
      });

      if (success) {
        await this.states.UpdateStatesFromRegisterMap(group);
      }
    }

    await this.states.UpdateDecodedBmsStatuses();
    await this.states.SetConnection(this.inverter.Status);
  }
}

export type { SchedulerAdapter };
export { GoodWePollScheduler, PollScheduler };
