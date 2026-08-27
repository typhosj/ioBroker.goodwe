# Older changes

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
