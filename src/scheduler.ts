"use strict";

import { errorMessage } from "./lib/errors";
import { clampNumber } from "./lib/config";
import { EcoModeV2Probe } from "./lib/eco-mode";
import {
  optionalGroupConfigs,
  registerGroups,
  writableGroups,
} from "./lib/register-map";
import type { GoodWeUdp } from "./GoodWe/GoodWe";
import type GoodWeStateManager from "./states";

const ReconnectDelay = {
  // Skipped 1s ticks between reconnect attempts while the inverter is offline.
  Max: 60,
};

// Seconds between two reads of the live data: running data, meter and BMS.
const PollCycle = {
  Default: 10,
  Min: 2,
  Max: 3600,
};

// Target seconds between two optional group reads. The optional groups hold
// settings and diagnostics that barely move, so they share one slot and are
// read round robin instead of on the live cycle.
const OptionalGroupIntervalSeconds = 30;

// Settings a script or the GoodWe app can change at any moment. Behind the
// round robin slot they were minutes old, so they are read on the live cycle.
// All of them are small: nine, four, one and sixteen registers.
const SettingsGroups = [
  "settingsBattery",
  "settingsEms",
  "settingsWorkMode",
  "settingsEcoMode",
];

interface SchedulerAdapter {
  config: ioBroker.AdapterConfig;
  log: ioBroker.Logger;
  setTimeout: (
    callback: () => void,
    ms: number,
  ) => ioBroker.Timeout | undefined;
  clearTimeout: (timeout: ioBroker.Timeout) => void;
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
      this.adapter.log.warn(`poll scheduler failed: ${errorMessage(error)}`);
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
  private slowCnt = 0;
  private reconnectDelay = 0;
  private reconnectSkips = 0;
  private deviceInfoRead = false;
  // Whether the firmware keeps its eco mode slots in 47515 ff. (EcoModeV1),
  // undefined until the probe got an answer on this connection.
  private ecoModeV1: boolean | undefined;
  private ecoProbeLost = 0;
  private optionalGroupIndex = 0;
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
        this.slowCnt = 0;
        // A reconnect can mean a different inverter or new firmware, so the
        // static device data is read again once the connection is back.
        this.deviceInfoRead = false;
        this.ecoModeV1 = undefined;
        this.ecoProbeLost = 0;

        if (this.reconnectSkips > 0) {
          this.reconnectSkips--;
          return;
        }

        const success = await this.inverter.ReadIdInfo();
        await this.states.SetConnection(success);

        // ReadIdInfo() only logs on debug once the inverter is already offline,
        // so without this the adapter would go yellow after a single timeout and
        // never say why again.
        if (!success && this.reconnectDelay === 0) {
          this.adapter.log.warn(
            "Inverter did not answer, retrying with increasing delay",
          );
        }

        this.reconnectDelay = success
          ? 0
          : Math.min(ReconnectDelay.Max, Math.max(1, this.reconnectDelay * 2));
        this.reconnectSkips = this.reconnectDelay;
      } else {
        // The scheduler ticks once a second; the configured cycle decides how
        // many of those ticks are idle.
        if (this.cycleCnt > 0) {
          this.cycleCnt--;
          return;
        }

        const pollCycle = clampPollCycle(this.adapter.config.pollCycle);

        this.cycleCnt = pollCycle - 1;

        // Order matters on a weak link. Measured over 527 cycles, the first
        // request after the idle gap lost 3.6 % of its answers while the two
        // behind it lost 0.4 % and 1.5 %, at an identical request count. The
        // small BMS read goes first so a lost first answer costs the least,
        // and so the next measurement tells position and response size apart:
        // if the loss follows this slot, it is the idle gap, not the 257 byte
        // running data frame.
        await this.UpdateDeviceInfo();
        await this.UpdateBmsInfo();
        await this.UpdateRunningData();
        await this.UpdateExtComData();

        // The last live read got no answer, so the inverter is most likely gone.
        // Reading on would run every remaining request into its timeout before
        // the reconnect starts, and pause each optional group for an hour.
        if (!this.inverter.Status) {
          return;
        }

        await this.UpdateSettings();

        // No early return on pollExtended: IsRegisterGroupEnabled() already
        // applies it, and inverter control keeps its group polled regardless.
        if (this.slowCnt > 0) {
          this.slowCnt--;
          return;
        }

        this.slowCnt =
          Math.max(1, Math.ceil(OptionalGroupIntervalSeconds / pollCycle)) - 1;
        await this.UpdateAdditionalRegisterGroups();
      }
    } catch (error) {
      this.adapter.log.warn(`poll cycle failed: ${errorMessage(error)}`);
      await this.states.SetConnection(false);
    }
  }

  /**
   * Reads the static device data once per connection.
   *
   * Serial number, model, firmware and rated power do not change while the
   * adapter runs. Re-reading them every cycle only added UDP requests that can
   * be lost, so later cycles just refresh the connection indicator.
   */
  async UpdateDeviceInfo(): Promise<void> {
    if (this.deviceInfoRead) {
      await this.states.SetConnection(this.inverter.Status);
      return;
    }

    const success = await this.inverter.ReadGroup("deviceInfo");

    if (!success) {
      await this.states.SetConnection(false);
      return;
    }

    this.deviceInfoRead = true;
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
    await this.states.UpdateDerivedRunningStates();
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

  /**
   * Reads the enabled settings groups on the live cycle.
   */
  async UpdateSettings(): Promise<void> {
    for (const groupName of SettingsGroups) {
      if (
        this.states.IsRegisterGroupEnabled(groupName) &&
        (groupName !== "settingsEcoMode" || (await this.HasEcoModeV1()))
      ) {
        await this.ReadOptionalGroup(groupName);
      }
    }
  }

  /**
   * Finds out once per connection whether the eco mode slots at 47515 mean
   * anything on this firmware.
   *
   * Firmware from ARM 19 keeps its slots at 47547 (EcoModeV2) and still
   * answers 47515, with values that are no slots: a live GW10K-ET with ARM 29
   * reported three enabled slots from 18:19 to 18:19 that the SolarGo app does
   * not show. EcoModeV1 firmware rejects 47547.
   */
  async HasEcoModeV1(): Promise<boolean> {
    if (this.ecoModeV1 !== undefined) {
      return this.ecoModeV1;
    }

    // Known limit: firmware that drops reads of 47547 instead of rejecting them
    // loses the slot states until the next reconnect. Three tries keep a few
    // lost answers on a weak link from costing a V1 inverter its slots, and a
    // silent firmware from stalling every cycle on the probe's timeouts.
    if (this.ecoProbeLost >= 3) {
      return false;
    }

    const probe = await this.inverter.ProbeRegisters(
      EcoModeV2Probe.start,
      EcoModeV2Probe.count,
    );

    if (probe === "lost") {
      this.ecoProbeLost++;
      return false;
    }

    this.ecoModeV1 = probe === "rejected";

    if (!this.ecoModeV1) {
      this.adapter.log.info(
        "This firmware uses the newer eco mode registers, the eco mode slot states stay empty",
      );
      // Values from before a firmware update would otherwise stay on the
      // states and look like active slots.
      await this.states.ClearRegisterGroup(registerGroups.settingsEcoMode);
    }

    return this.ecoModeV1;
  }

  /**
   * Reads one optional register group per cycle, round robin.
   *
   * Reading all of them in one burst was the largest block of UDP traffic the
   * adapter produced, and every request in it can be lost. Spreading them out
   * costs each group a slower refresh and cuts the request count per minute to
   * a fraction; none of these groups changes fast enough to notice.
   */
  async UpdateAdditionalRegisterGroups(): Promise<void> {
    const enabled = Object.keys(optionalGroupConfigs).filter(
      (groupName) =>
        !SettingsGroups.includes(groupName) &&
        this.states.IsRegisterGroupEnabled(groupName),
    );

    if (enabled.length === 0) {
      return;
    }

    const groupName = enabled[this.optionalGroupIndex % enabled.length];

    this.optionalGroupIndex = (this.optionalGroupIndex + 1) % enabled.length;

    await this.ReadOptionalGroup(groupName);
  }

  /**
   * Reads one optional register group and writes its states.
   *
   * @param groupName register group name
   */
  async ReadOptionalGroup(groupName: string): Promise<void> {
    // An unsupported optional group sleeps for an hour after a failed read. The
    // group inverter control writes into must not: one lost answer would freeze
    // the writable states for that hour.
    const controlGroup =
      writableGroups.has(groupName) && this.states.IsControlEnabled();

    const read = await this.inverter.ReadGroup(groupName, {
      optional: true,
      backoff: !controlGroup,
    });

    // A poll read queued in front of a control write returns the old value, and
    // writing it would acknowledge that value right after a script set a new
    // one. The control write reads the group back itself.
    if (read && !(controlGroup && this.states.IsControlWritePending())) {
      await this.states.UpdateStatesFromRegisterMap(registerGroups[groupName]);

      // Only this group adds the high words the decoder needs; the base group
      // already decodes itself in UpdateBmsInfo().
      if (groupName === "bmsInfoExtended") {
        await this.states.UpdateDecodedBmsStatuses();
      }
    }

    await this.states.SetConnection(this.inverter.Status);
  }
}

function clampPollCycle(value: number | undefined): number {
  return clampNumber(value, PollCycle.Default, PollCycle.Min, PollCycle.Max);
}

export type { SchedulerAdapter };
export { clampPollCycle, GoodWePollScheduler, PollScheduler };
