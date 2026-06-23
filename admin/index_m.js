"use strict";

/* global $, M, adapter, instance, sendTo */
/* eslint-disable @typescript-eslint/no-unused-vars */

function load(settings, onChange) {
  $(".tabs").tabs();

  $(".value").each(function () {
    const $element = $(this);
    const id = $element.attr("id");
    const value = settings[id];

    if ($element.attr("type") === "checkbox") {
      $element.prop("checked", value === true);
    } else {
      $element.val(value ?? "");
    }

    $element.on("change keyup", () => onChange());
  });

  $("#validateIp").on("click", validateIp);
  $("#discoverInverters").on("click", discoverInverters);
  $("#discoveryResult").on("click", ".use-inverter-ip", function () {
    const ip = $(this).data("ip");

    $("#ipAddr").val(ip);
    M.updateTextFields();
    onChange();
    showToast(`IP ${ip} applied`);
  });

  onChange(false);
  M.updateTextFields();
}

function save(callback) {
  const settings = {};

  $(".value").each(function () {
    const $element = $(this);
    const id = $element.attr("id");

    if ($element.attr("type") === "checkbox") {
      settings[id] = $element.prop("checked");
    } else if ($element.hasClass("number")) {
      settings[id] = Number($element.val());
    } else {
      settings[id] = String($element.val() ?? "").trim();
    }
  });

  callback(settings);
}

function validateIp() {
  sendCommand(
    "validateIp",
    {
      ip: $("#ipAddr").val(),
      timeoutMs: 1000,
    },
    (response) => {
      if (response?.valid && response?.reachable) {
        showToast("Inverter reachable");
        return;
      }

      showToast(response?.error || "Inverter not reachable");
    },
  );
}

function discoverInverters() {
  const $result = $("#discoveryResult");
  $result.html('<div class="progress"><div class="indeterminate"></div></div>');

  sendCommand(
    "discoverInverters",
    {
      ip: $("#ipAddr").val(),
      subnet: $("#discoverySubnet").val(),
      timeoutMs: 700,
      concurrency: 64,
    },
    (response) => renderDiscoveryResult(response),
  );
}

function sendCommand(command, message, callback) {
  sendTo(`${adapter}.${instance}`, command, message, callback);
}

function renderDiscoveryResult(response) {
  const found = Array.isArray(response?.found) ? response.found : [];
  const searched = Number(response?.searched ?? 0);

  if (found.length === 0) {
    $("#discoveryResult").html(
      `<div class="discovery-empty">No inverter found. Searched ${searched} addresses.</div>`,
    );
    return;
  }

  const rows = found.map((inverter) => {
    const info = inverter.idInfo ?? {};
    const details = [
      escapeHtml(info.modelName),
      info.serialNumber ? `SN ${escapeHtml(info.serialNumber)}` : "",
      info.internalVersion ? escapeHtml(info.internalVersion) : "",
    ]
      .filter(Boolean)
      .join(" | ");

    return `
			<tr>
				<td>${escapeHtml(inverter.ip)}</td>
				<td>${details}</td>
				<td class="right-align">
					<a class="waves-effect waves-light btn-small blue use-inverter-ip" data-ip="${escapeHtml(inverter.ip)}">Use</a>
				</td>
			</tr>`;
  });

  $("#discoveryResult").html(`
		<div>Found ${found.length} inverter(s). Searched ${searched} addresses.</div>
		<table class="striped responsive-table">
			<thead>
				<tr>
					<th>IP</th>
					<th>Info</th>
					<th></th>
				</tr>
			</thead>
			<tbody>${rows.join("")}</tbody>
		</table>`);
}

function showToast(message) {
  if (M?.toast) {
    M.toast({ html: escapeHtml(message), displayLength: 3000 });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
