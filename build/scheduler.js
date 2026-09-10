"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollScheduler = exports.GoodWePollScheduler = void 0;
exports.clampPollCycle = clampPollCycle;
const errors_1 = require("./lib/errors");
const config_1 = require("./lib/config");
const register_map_1 = require("./lib/register-map");
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
class PollScheduler {
    adapter;
    poll;
    intervalMs;
    active = false;
    timer;
    constructor(adapter, poll, intervalMs) {
        this.adapter = adapter;
        this.poll = poll;
        this.intervalMs = intervalMs;
    }
    start() {
        if (this.active) {
            return;
        }
        this.active = true;
        void this.Run();
    }
    stop() {
        this.active = false;
        if (this.timer) {
            this.adapter.clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
    async Run() {
        try {
            await this.poll();
        }
        catch (error) {
            this.adapter.log.warn(`poll scheduler failed: ${(0, errors_1.errorMessage)(error)}`);
        }
        finally {
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
exports.PollScheduler = PollScheduler;
class GoodWePollScheduler {
    adapter;
    inverter;
    states;
    cycleCnt = 0;
    slowCnt = 0;
    reconnectDelay = 0;
    reconnectSkips = 0;
    deviceInfoRead = false;
    optionalGroupIndex = 0;
    scheduler;
    constructor(adapter, inverter, states, intervalMs) {
        this.adapter = adapter;
        this.inverter = inverter;
        this.states = states;
        this.scheduler = new PollScheduler(adapter, () => this.Poll(), intervalMs);
    }
    start() {
        this.scheduler.start();
    }
    stop() {
        this.scheduler.stop();
    }
    async Poll() {
        try {
            if (this.inverter.Status == false) {
                this.cycleCnt = 0;
                this.slowCnt = 0;
                // A reconnect can mean a different inverter or new firmware, so the
                // static device data is read again once the connection is back.
                this.deviceInfoRead = false;
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
                    this.adapter.log.warn("Inverter did not answer, retrying with increasing delay");
                }
                this.reconnectDelay = success
                    ? 0
                    : Math.min(ReconnectDelay.Max, Math.max(1, this.reconnectDelay * 2));
                this.reconnectSkips = this.reconnectDelay;
            }
            else {
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
                if (!(0, config_1.normalizeBoolean)(this.adapter.config.pollExtended, true)) {
                    return;
                }
                if (this.slowCnt > 0) {
                    this.slowCnt--;
                    return;
                }
                this.slowCnt =
                    Math.max(1, Math.ceil(OptionalGroupIntervalSeconds / pollCycle)) - 1;
                await this.UpdateAdditionalRegisterGroups();
            }
        }
        catch (error) {
            this.adapter.log.warn(`poll cycle failed: ${(0, errors_1.errorMessage)(error)}`);
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
    async UpdateDeviceInfo() {
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
        await this.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups.deviceInfo);
        await this.states.SetConnection(this.inverter.Status);
    }
    async UpdateRunningData() {
        const success = await this.inverter.ReadGroup("runningData");
        if (!success) {
            await this.states.SetConnection(false);
            return;
        }
        await this.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups.runningData);
        await this.states.UpdateDecodedRunningStatuses();
        await this.states.UpdateDerivedRunningStates();
    }
    async UpdateExtComData() {
        const success = await this.inverter.ReadGroup("extComData");
        if (!success) {
            await this.states.SetConnection(false);
            return;
        }
        await this.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups.extComData);
    }
    async UpdateBmsInfo() {
        const success = await this.inverter.ReadGroup("bmsInfo");
        if (!success) {
            await this.states.SetConnection(false);
            return;
        }
        await this.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups.bmsInfo);
        await this.states.UpdateDecodedBmsStatuses();
    }
    /**
     * Reads one optional register group per cycle, round robin.
     *
     * Reading all of them in one burst was the largest block of UDP traffic the
     * adapter produced, and every request in it can be lost. Spreading them out
     * costs each group a slower refresh and cuts the request count per minute to
     * a fraction; none of these groups changes fast enough to notice.
     */
    async UpdateAdditionalRegisterGroups() {
        const enabled = Object.keys(register_map_1.optionalGroupConfigs).filter((groupName) => this.states.IsRegisterGroupEnabled(groupName));
        if (enabled.length === 0) {
            return;
        }
        const groupName = enabled[this.optionalGroupIndex % enabled.length];
        this.optionalGroupIndex = (this.optionalGroupIndex + 1) % enabled.length;
        if (await this.inverter.ReadGroup(groupName, { optional: true })) {
            await this.states.UpdateStatesFromRegisterMap(register_map_1.registerGroups[groupName]);
            // Only this group adds the high words the decoder needs; the base group
            // already decodes itself in UpdateBmsInfo().
            if (groupName === "bmsInfoExtended") {
                await this.states.UpdateDecodedBmsStatuses();
            }
        }
        await this.states.SetConnection(this.inverter.Status);
    }
}
exports.GoodWePollScheduler = GoodWePollScheduler;
function clampPollCycle(value) {
    return (0, config_1.clampNumber)(value, PollCycle.Default, PollCycle.Min, PollCycle.Max);
}
