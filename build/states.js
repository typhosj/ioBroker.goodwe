"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./lib/config");
const register_map_1 = require("./lib/register-map");
const status_mapper_1 = require("./mappers/status-mapper");
const optionalDerivedStates = {
    bmsInfoExtended: ["BMSInfo.WarningCodeActive", "BMSInfo.DRMStatusActive"],
};
const legacyModeTextStates = [
    "RunningData.GridModeText",
    "RunningData.WorkModeText",
    "RunningData.OperationModeText",
    "RunningData.PV1.ModeText",
    "RunningData.PV2.ModeText",
    "RunningData.PV3.ModeText",
    "RunningData.PV4.ModeText",
    "RunningData.Battery1.ModeText",
    "RunningData.BackUpL1.ModeText",
    "RunningData.BackUpL2.ModeText",
    "RunningData.BackUpL3.ModeText",
];
class GoodWeStateManager {
    adapter;
    inverter;
    stopped = false;
    constructor(adapter, inverter) {
        this.adapter = adapter;
        this.inverter = inverter;
    }
    /**
     * Blocks further state writes once the adapter unloads.
     *
     * A poll that is still in flight when onUnload() runs would otherwise write
     * states after the adapter reported shutdown.
     */
    Stop() {
        this.stopped = true;
    }
    async Write(id, value) {
        if (this.stopped) {
            return;
        }
        await this.adapter.setStateChangedAsync(id, value, true);
    }
    async InitializeObjects() {
        await this.DeleteLegacyTypoStates();
        await this.DeleteLegacyModeTextStates();
        await this.CleanupDisabledOptionalStates();
        await this.CreateObjectsFromRegisterMap();
        await this.CreateDerivedObjects();
        await this.CreateDecodedStatusObjects();
    }
    async SetConnection(value) {
        await this.Write("info.connection", value);
    }
    IsRegisterGroupEnabled(groupName) {
        const configKey = register_map_1.optionalGroupConfigs[groupName];
        if (!configKey) {
            return true;
        }
        // Normalize here as well: a mistyped switch does not only disable the
        // group, it makes CleanupDisabledOptionalStates() delete its objects.
        const config = this.adapter.config;
        return ((0, config_1.normalizeBoolean)(config.pollExtended, true) &&
            (0, config_1.normalizeBoolean)(config[configKey], config_1.booleanDefaults[configKey] ?? false));
    }
    async CreateObjectsFromRegisterMap() {
        const channels = new Set();
        for (const [groupName, group] of Object.entries(register_map_1.registerGroups)) {
            if (!this.IsRegisterGroupEnabled(groupName)) {
                continue;
            }
            channels.add(group.channel);
            for (const item of group.entries) {
                const parts = item.state.split(".");
                parts.pop();
                while (parts.length > 0) {
                    channels.add(parts.join("."));
                    parts.pop();
                }
            }
        }
        for (const channel of channels) {
            await this.adapter.setObjectNotExistsAsync(channel, {
                type: "channel",
                common: { name: channel.split(".").pop() ?? channel },
                native: {},
            });
        }
        for (const [groupName, group] of Object.entries(register_map_1.registerGroups)) {
            if (!this.IsRegisterGroupEnabled(groupName)) {
                continue;
            }
            for (const item of group.entries) {
                await this.adapter.setObjectNotExistsAsync(item.state, {
                    type: "state",
                    common: {
                        name: item.state.split(".").pop() ?? item.state,
                        type: item.type === register_map_1.TYPE.STRING ? "string" : "number",
                        role: item.type === register_map_1.TYPE.STRING ? "text" : item.role,
                        read: true,
                        write: false,
                        unit: item.unit,
                        states: item.states,
                    },
                    native: {
                        address: item.address,
                        type: item.type,
                        scale: item.scale,
                    },
                });
                await this.UpdateExistingStateEnums(item.state, item.states);
            }
        }
    }
    async UpdateExistingStateEnums(id, states) {
        if (!states) {
            return;
        }
        const object = await this.adapter.getObjectAsync(id);
        if (object?.type !== "state") {
            return;
        }
        if (JSON.stringify(object.common.states) === JSON.stringify(states)) {
            return;
        }
        await this.adapter.extendObjectAsync(id, {
            type: "state",
            common: { states },
        });
        this.adapter.log.info(`Updated enum labels for ${id}`);
    }
    async CreateDerivedObjects() {
        await this.adapter.setObjectNotExistsAsync("RunningData.TotalPowerPv", {
            type: "state",
            common: {
                name: "TotalPowerPv",
                type: "number",
                role: "value.power",
                read: true,
                write: false,
                unit: "W",
            },
            native: {},
        });
    }
    async CleanupDisabledOptionalStates() {
        const enabledChannels = new Set();
        for (const [groupName, group] of Object.entries(register_map_1.registerGroups)) {
            if (!this.IsRegisterGroupEnabled(groupName)) {
                continue;
            }
            for (const channel of this.GetRegisterGroupChannels(group)) {
                enabledChannels.add(channel);
            }
        }
        for (const groupName of Object.keys(register_map_1.optionalGroupConfigs)) {
            if (this.IsRegisterGroupEnabled(groupName)) {
                continue;
            }
            const group = register_map_1.registerGroups[groupName];
            for (const item of group.entries) {
                const object = await this.adapter.getObjectAsync(item.state);
                if (object) {
                    await this.adapter.delObjectAsync(item.state);
                    this.adapter.log.debug(`Deleted disabled optional state ${item.state}`);
                }
            }
            for (const state of optionalDerivedStates[groupName] ?? []) {
                await this.DeleteObjectIfExists(state);
            }
            for (const channel of this.GetRegisterGroupChannels(group)
                .filter((channel) => !enabledChannels.has(channel))
                .sort((left, right) => right.split(".").length - left.split(".").length)) {
                await this.DeleteObjectIfExists(channel);
            }
        }
    }
    GetRegisterGroupChannels(group) {
        const channels = new Set([group.channel]);
        for (const item of group.entries) {
            const parts = item.state.split(".");
            parts.pop();
            while (parts.length > 0) {
                channels.add(parts.join("."));
                parts.pop();
            }
        }
        return Array.from(channels);
    }
    async DeleteObjectIfExists(id) {
        const object = await this.adapter.getObjectAsync(id);
        if (object) {
            await this.adapter.delObjectAsync(id);
            this.adapter.log.debug(`Deleted disabled optional object ${id}`);
        }
    }
    async DeleteLegacyTypoStates() {
        for (const state of [
            "RunningData.ModulTemperature",
            "RunningData.SaftyCountry",
        ]) {
            const object = await this.adapter.getObjectAsync(state);
            if (object) {
                await this.adapter.delObjectAsync(state);
                this.adapter.log.info(`Deleted legacy typo state ${state}`);
            }
        }
    }
    async DeleteLegacyModeTextStates() {
        for (const state of legacyModeTextStates) {
            const object = await this.adapter.getObjectAsync(state);
            if (object) {
                await this.adapter.delObjectAsync(state);
                this.adapter.log.info(`Deleted legacy mode text state ${state}`);
            }
        }
    }
    async CreateDecodedStatusObjects() {
        const states = [
            "RunningData.ErrorMessageActive",
            "RunningData.DiagStatusActive",
            "BMSInfo.ErrorCodeActive",
        ];
        if (this.IsRegisterGroupEnabled("bmsInfoExtended")) {
            states.push(...optionalDerivedStates.bmsInfoExtended);
        }
        for (const state of states) {
            await this.adapter.setObjectNotExistsAsync(state, {
                type: "state",
                common: {
                    name: state.split(".").pop() ?? state,
                    type: "string",
                    role: "text",
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
    }
    async UpdateStatesFromRegisterMap(group) {
        const getter = this.GroupGetter(group);
        if (getter === "") {
            this.adapter.log.error(`No inverter model getter for register group ${group.name}`);
            return;
        }
        const source = this.inverter[getter];
        for (const item of group.entries) {
            await this.Write(item.state, this.GetStateValue(item.state, item.model, source));
        }
    }
    GroupGetter(group) {
        switch (group.name) {
            case "DeviceInfo":
                return "DeviceInfo";
            case "RunningData":
                return "RunningData";
            case "ExtComData":
                return "ExtComData";
            case "BMSInfo":
                return "BmsInfo";
            case "DeviceInfo.SIMCCID":
                return "DeviceInfo";
            case "ExtComData.Extended":
                return "ExtComData";
            case "FlashInfo":
                return "FlashInfo";
            case "BMSInfo.Extended":
                return "BmsInfo";
            case "BMSDetail":
                return "BmsDetail";
            case "CEIAutoTest":
                return "CeiAutoTest";
            case "PowerLimit":
                return "PowerLimit";
            default:
                return "";
        }
    }
    GetStateValue(state, path, source) {
        const value = this.GetMappedValue(path, source);
        if (state === "RunningData.Battery1.Mode" &&
            (value === 2 || value === 3) &&
            (this.GetMappedValue("Battery1.Current", source) === 0 ||
                this.GetMappedValue("Battery1.Power", source) === 0)) {
            return 1;
        }
        return value;
    }
    GetMappedValue(path, source) {
        const value = path
            .split(".")
            .reduce((current, part) => current && typeof current === "object"
            ? current[part]
            : undefined, source);
        return value;
    }
    async UpdateDerivedRunningStates() {
        await this.Write("RunningData.TotalPowerPv", this.inverter.RunningData.TotalPowerPv);
    }
    async UpdateDecodedRunningStatuses() {
        for (const state of (0, status_mapper_1.getDecodedRunningStatuses)(this.inverter.RunningData)) {
            await this.Write(state.id, state.value);
        }
    }
    async UpdateDecodedBmsStatuses() {
        for (const state of (0, status_mapper_1.getDecodedBmsStatuses)(this.inverter.BmsInfo, this.IsRegisterGroupEnabled("bmsInfoExtended"))) {
            await this.Write(state.id, state.value);
        }
    }
}
exports.default = GoodWeStateManager;
