![Logo](admin/goodwe.png)
# ioBroker.goodwe

[![NPM version](https://img.shields.io/npm/v/iobroker.goodwe.svg)](https://www.npmjs.com/package/iobroker.goodwe)
[![Downloads](https://img.shields.io/npm/dm/iobroker.goodwe.svg)](https://www.npmjs.com/package/iobroker.goodwe)
![Number of Installations](https://iobroker.live/badges/goodwe-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/goodwe-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.goodwe.png?downloads=true)](https://nodei.co/npm/iobroker.goodwe/)

**Tests:** ![Test and Release](https://github.com/FossyTom/ioBroker.goodwe/workflows/Test%20and%20Release/badge.svg)

## goodwe adapter for ioBroker

Communication with GoodWe Inverter ET/EH/BH/BT Series

## Supported data

The adapter reads the GoodWe EMS Modbus protocol v1.7 register blocks for ET/EH/BH/BT devices:

* Device information, including optional SIMCCID
* Running data
* External communication and extended meter data
* Flash information
* BMS information and BMS detailed information
* CEI auto test information
* Power limit information

Raw register values are kept as ioBroker states. Important mode and bitfield values are also exposed as decoded text states, for example active inverter errors, diagnostic status, BMS alarms and DRM status.

## Important states

| State area | Description |
| --- | --- |
| `DeviceInfo.*` | Inverter protocol, rated power, serial number, device type and firmware data |
| `RunningData.PV1.*` ... `RunningData.PV4.*` | PV voltage, current, power and mode |
| `RunningData.GridL1.*` ... `RunningData.GridL3.*` | Grid voltage, current, frequency and power |
| `RunningData.BackUpL1.*` ... `RunningData.BackUpL3.*` | Back-up output voltage, current, frequency, power and mode |
| `RunningData.Battery1.*` | Battery voltage, current, power and mode |
| `RunningData.*Energy*` | Daily and total energy counters |
| `RunningData.*Text` | Decoded inverter, grid, PV, battery and back-up mode states |
| `RunningData.ErrorMessageActive` | Active inverter error bits as text |
| `RunningData.DiagStatusActive` | Active diagnostic bits as text |
| `ExtComData.*` | Smart meter and communication data |
| `BMSInfo.*` | BMS status, SOC, SOH, error and warning data |
| `BMSInfo.*Active` | Decoded BMS alarm, warning and DRM bitfields |
| `CEIAutoTest.*` | CEI auto test values if supported by the inverter |

`RunningData.ModuleTemperature` and `RunningData.SafetyCountry` are the canonical state names. Older misspelled states are removed on adapter start.

## Configuration

* `ipAddr`: IP address of the inverter.
  The adapter validates this as a usable IPv4 host address on startup.
* `pollCycle`: Base poll cycle in seconds.
* `timeoutMs`: UDP request timeout in milliseconds.
* `retries`: Retry count per UDP request.
* `pollExtended`: Master switch for optional register groups.
* `pollSimccid`: Enables optional SIMCCID polling.
* `pollExtendedMeter`: Enables extended meter registers.
* `pollFlashInfo`: Enables flash information registers.
* `pollBmsExtended`: Enables extended BMS information registers.
* `pollBmsDetail`: Enables BMS detail registers, if supported by the inverter.
* `pollCeiAutoTest`: Enables CEI auto test registers.
* `pollPowerLimit`: Enables power limit registers, if supported by the inverter.
* `cleanupDisabledStates`: Deletes states of disabled optional register groups on adapter start.

The basic settings page also provides two actions:

* `Validate inverter IP`: Checks the configured address and sends the GoodWe ID request to UDP port 8899.
* `Search inverter in network`: Scans the configured `/24` subnet for GoodWe devices on UDP port 8899.

## Troubleshooting

Optional register groups depend on inverter model, firmware and connected hardware. If a group is not supported, the adapter skips it after a timeout backoff and keeps the main connection online.

Known model-dependent groups:

* `pollBmsDetail`: often unsupported unless the BMS exposes detail registers.
* `pollPowerLimit`: often unsupported on devices that do not expose power-limit telemetry.
* `pollCeiAutoTest`: can provide values on devices/firmware that support CEI auto test data.

If logs show optional register timeouts, disable the matching group in the advanced settings. Enable `cleanupDisabledStates` once and restart the adapter to remove states from disabled optional groups.

For unstable network connections, increase `timeoutMs` first. Increase `retries` only when the inverter occasionally misses packets, because retries also lengthen one poll cycle.


## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 1.0.9 (2026-06-23)
* Added validation for usable IPv4 inverter addresses
* Added GoodWe UDP reachability check from the admin configuration
* Added `/24` network discovery for GoodWe inverters via UDP port 8899

### 1.0.8 (2026-06-23)
* Added separate basic and advanced configuration tabs
* Added per-group optional register polling defaults based on real device feedback
* Removed legacy misspelled states and added startup cleanup for them
* Cleaned up legacy hard-coded decoder code in favor of the register map
* Finalized selected state units and roles
* Expanded README with state overview and troubleshooting

### 1.0.7 (2026-06-23)
* Hardened UDP communication with async request handling, timeout and retry support
* Added specification based register map and extended GoodWe register groups
* Added decoded status and bitfield states for inverter, BMS, DRM and diagnostics
* Added adapter options for request timeout, retries and per-group extended register polling
* Added optional cleanup for disabled extended register states
* Added register-map and status-decoding tests

### 1.0.6 (2025-04-02)
* (ty) updated dependencies
* (ty) extended logging

### 1.0.5 (2025-03-14)
* (ty) Fixed EnergyDayDischarge
* (mrx8) fixed memory leak

### 1.0.4 (2023-02-19)
* (Thomas Schönberger) Add some Logs for ENETUNREACH error

### 1.0.3 (2023-02-18)

* (Thomas Schönberger) Add TotalPowerPv object to running Data
* (Thomas Schönberger) Comm Error

### 1.0.2 (2022-12-31)

* (Thomas Schönberger) Add Bluefox to npm

### 1.0.1 (2022-12-31)
* (Thomas Schönberger) initial release

### 1.0.0 (2022-12-31)
* (Thomas Schönberger) initial release

## License
MIT License

Copyright (c) 2023 Thomas Schönberger <SchoenbergerThomas@freenet.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
