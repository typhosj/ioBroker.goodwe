"use strict";

const {
  bitfields,
  decodeBitfield,
  decodeValue,
  valueStates,
} = require("../lib/status-definitions");

function getDecodedRunningStatuses(data) {
  const states = [
    {
      id: "RunningData.GridModeText",
      value: decodeValue(data.GridMode, valueStates.gridStatus),
    },
    {
      id: "RunningData.WorkModeText",
      value: decodeValue(data.WorkMode, valueStates.workMode),
    },
    {
      id: "RunningData.OperationModeText",
      value: decodeValue(data.OperationMode, valueStates.operationMode),
    },
    {
      id: "RunningData.Battery1.ModeText",
      value: decodeValue(data.Battery1.Mode, valueStates.batteryStatus),
    },
  ];

  for (const pv of ["PV1", "PV2", "PV3", "PV4"]) {
    states.push({
      id: `RunningData.${pv}.ModeText`,
      value: decodeValue(data[pv.replace("PV", "Pv")].Mode, valueStates.pvMode),
    });
  }

  for (const phase of ["BackUpL1", "BackUpL2", "BackUpL3"]) {
    states.push({
      id: `RunningData.${phase}.ModeText`,
      value: decodeValue(data[phase].Mode, valueStates.backupStatus),
    });
  }

  states.push(
    {
      id: "RunningData.ErrorMessageActive",
      value: decodeBitfield(data.ErrorMessage, bitfields.errorMessage).join(
        ", ",
      ),
    },
    {
      id: "RunningData.DiagStatusActive",
      value: decodeBitfield(data.DiagStatusL, bitfields.diagnosticStatus).join(
        ", ",
      ),
    },
  );

  return states;
}

function getDecodedBmsStatuses(bms, includeExtended) {
  const errorCode = (bms.ErrorCodeH ?? 0) * 0x10000 + (bms.ErrorCode ?? 0);
  const warningCode =
    (bms.WarningCodeH ?? 0) * 0x10000 + (bms.WarningCodeL ?? 0);
  const states = [
    {
      id: "BMSInfo.ErrorCodeActive",
      value: decodeBitfield(errorCode, bitfields.bmsAlarm).join(", "),
    },
  ];

  if (includeExtended) {
    states.push(
      {
        id: "BMSInfo.WarningCodeActive",
        value: decodeBitfield(warningCode, bitfields.bmsWarning).join(", "),
      },
      {
        id: "BMSInfo.DRMStatusActive",
        value: decodeBitfield(bms.DRMStatus ?? 0, bitfields.drmStatus).join(
          ", ",
        ),
      },
    );
  }

  return states;
}

module.exports = {
  getDecodedBmsStatuses,
  getDecodedRunningStatuses,
};
