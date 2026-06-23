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

## Configuration

* `ipAddr`: IP address of the inverter.
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



## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->
### 1.0.7 (2026-06-23)
* Hardened UDP communication with async request handling, timeout and retry support
* Added specification based register map and extended GoodWe register groups
* Added decoded status and bitfield states for inverter, BMS, DRM and diagnostics
* Added adapter options for request timeout, retries and per-group extended register polling
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
