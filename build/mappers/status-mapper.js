"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDecodedBmsStatuses = getDecodedBmsStatuses;
exports.getDecodedRunningStatuses = getDecodedRunningStatuses;
const status_definitions_1 = require("../lib/status-definitions");
function getDecodedRunningStatuses(data) {
    const states = [
        {
            id: "RunningData.ErrorMessageActive",
            value: (0, status_definitions_1.decodeBitfield)(data.ErrorMessage, status_definitions_1.bitfields.errorMessage).join(", "),
        },
        {
            id: "RunningData.DiagStatusActive",
            value: (0, status_definitions_1.decodeBitfield)(data.DiagStatusL, status_definitions_1.bitfields.diagnosticStatus).join(", "),
        },
    ];
    return states;
}
function getDecodedBmsStatuses(bms, includeExtended) {
    const errorCode = (bms.ErrorCodeH ?? 0) * 0x10000 + (bms.ErrorCode ?? 0);
    const warningCode = (bms.WarningCodeH ?? 0) * 0x10000 + (bms.WarningCodeL ?? 0);
    const states = [
        {
            id: "BMSInfo.ErrorCodeActive",
            value: (0, status_definitions_1.decodeBitfield)(errorCode, status_definitions_1.bitfields.bmsAlarm).join(", "),
        },
    ];
    if (includeExtended) {
        states.push({
            id: "BMSInfo.WarningCodeActive",
            value: (0, status_definitions_1.decodeBitfield)(warningCode, status_definitions_1.bitfields.bmsWarning).join(", "),
        }, {
            id: "BMSInfo.DRMStatusActive",
            value: (0, status_definitions_1.decodeBitfield)(bms.DRMStatus ?? 0, status_definitions_1.bitfields.drmStatus).join(", "),
        });
    }
    return states;
}
