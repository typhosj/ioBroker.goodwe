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
const PollCycle = {
    Default: 10,
    Min: 10,
    Max: 3600,
};
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
    reconnectDelay = 0;
    reconnectSkips = 0;
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
                        if ((0, config_1.normalizeBoolean)(this.adapter.config.pollExtended, true)) {
                            await this.UpdateAdditionalRegisterGroups();
                        }
                        break;
                }
                if (this.cycleCnt >= clampPollCycle(this.adapter.config.pollCycle)) {
                    this.cycleCnt = 0;
                }
                this.cycleCnt++;
            }
        }
        catch (error) {
            this.adapter.log.warn(`poll cycle failed: ${(0, errors_1.errorMessage)(error)}`);
            await this.states.SetConnection(false);
        }
    }
    async UpdateDeviceInfo() {
        const success = await this.inverter.ReadGroup("deviceInfo");
        if (!success) {
            await this.states.SetConnection(false);
            return;
        }
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
    async UpdateAdditionalRegisterGroups() {
        for (const groupName of Object.keys(register_map_1.optionalGroupConfigs)) {
            if (!this.states.IsRegisterGroupEnabled(groupName)) {
                continue;
            }
            const group = register_map_1.registerGroups[groupName];
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
exports.GoodWePollScheduler = GoodWePollScheduler;
function clampPollCycle(value) {
    if (value === undefined || !Number.isFinite(value)) {
        return PollCycle.Default;
    }
    return Math.min(PollCycle.Max, Math.max(PollCycle.Min, Math.floor(value)));
}
