"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Created with @iobroker/create-adapter v2.3.0
 */
const utils = __importStar(require("@iobroker/adapter-core"));
const admin_messages_1 = require("./api/admin-messages");
const GoodWe_1 = require("./GoodWe/GoodWe");
const goodwe_discovery_1 = require("./lib/goodwe-discovery");
const scheduler_1 = require("./scheduler");
const states_1 = __importDefault(require("./states"));
class Goodwe extends utils.Adapter {
    inverter = new GoodWe_1.GoodWeUdp(this.log);
    states = new states_1.default(this, this.inverter);
    pollScheduler = new scheduler_1.GoodWePollScheduler(this, this.inverter, this.states, 1000);
    /**
     * @param [options]
     */
    constructor(options = {}) {
        super({
            ...options,
            name: "goodwe",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }
    InitializeServices() {
        this.inverter = new GoodWe_1.GoodWeUdp(this.log);
        this.states = new states_1.default(this, this.inverter);
        this.pollScheduler = new scheduler_1.GoodWePollScheduler(this, this.inverter, this.states, 1000);
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.InitializeServices();
        await this.states.InitializeObjects();
        await this.states.SetConnection(false);
        const configuredIp = (0, goodwe_discovery_1.extractIpv4Address)(this.config.ipAddr);
        if (configuredIp === "") {
            this.log.warn("No inverter IP address configured yet");
            return;
        }
        this.config.ipAddr = configuredIp;
        const ipValidation = (0, goodwe_discovery_1.validateIpv4Address)(this.config.ipAddr);
        if (!ipValidation.valid) {
            this.log.error(`Invalid inverter IP address "${this.config.ipAddr}": ${ipValidation.reason}`);
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
    onUnload(callback) {
        try {
            this.pollScheduler.stop();
            this.inverter.destructor();
            callback();
        }
        catch (e) {
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
    onStateChange(id, state) {
        if (state) {
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        }
        else {
            this.log.info(`state ${id} deleted`);
        }
    }
    async onMessage(obj) {
        await (0, admin_messages_1.handleAdapterMessage)(this, obj);
    }
}
if (require.main !== module) {
    /**
     * @param [options]
     */
    module.exports = (options = {}) => new Goodwe(options);
}
else {
    new Goodwe({});
}
