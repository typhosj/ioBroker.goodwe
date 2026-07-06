"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollScheduler = exports.GoodWePollScheduler = void 0;
exports.clampPollCycle = clampPollCycle;
const register_map_1 = require("./lib/register-map");
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
            this.adapter.log.warn(`poll scheduler failed: ${error.message ?? error}`);
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
                const success = await this.inverter.ReadIdInfo();
                await this.states.SetConnection(success);
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
                        if (this.adapter.config.pollExtended !== false) {
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
            this.adapter.log.warn(`poll cycle failed: ${error.message ?? error}`);
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
        await this.adapter.setStateChangedAsync("RunningData.TotalPowerPv", this.inverter.RunningData.TotalPowerPv, true);
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
