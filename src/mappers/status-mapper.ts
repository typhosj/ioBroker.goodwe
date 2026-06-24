"use strict";

import {
  bitfields,
  decodeBitfield,
  decodeValue,
  valueStates,
} from "../lib/status-definitions";

interface RunningStatusData {
  GridMode: number;
  WorkMode: number;
  OperationMode: number;
  Battery1: { Mode: number };
  Pv1: { Mode: number };
  Pv2: { Mode: number };
  Pv3: { Mode: number };
  Pv4: { Mode: number };
  BackUpL1: { Mode: number };
  BackUpL2: { Mode: number };
  BackUpL3: { Mode: number };
  ErrorMessage: number;
  DiagStatusL: number;
}

interface BmsStatusData {
  ErrorCode?: number;
  ErrorCodeH?: number;
  WarningCodeL?: number;
  WarningCodeH?: number;
  DRMStatus?: number;
}

interface MappedState {
  id: string;
  value: string;
}

function getDecodedRunningStatuses(data: RunningStatusData): MappedState[] {
  const states: MappedState[] = [
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

  const pvData = {
    PV1: data.Pv1,
    PV2: data.Pv2,
    PV3: data.Pv3,
    PV4: data.Pv4,
  };

  for (const pv of ["PV1", "PV2", "PV3", "PV4"] as const) {
    states.push({
      id: `RunningData.${pv}.ModeText`,
      value: decodeValue(pvData[pv].Mode, valueStates.pvMode),
    });
  }

  for (const phase of ["BackUpL1", "BackUpL2", "BackUpL3"] as const) {
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

function getDecodedBmsStatuses(
  bms: BmsStatusData,
  includeExtended: boolean,
): MappedState[] {
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

export type { BmsStatusData, MappedState, RunningStatusData };
export { getDecodedBmsStatuses, getDecodedRunningStatuses };
