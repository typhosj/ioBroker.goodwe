"use strict";

/* global $, M, _, adapter, instance, sendTo, document */
/* eslint-disable @typescript-eslint/no-unused-vars, prefer-template */

function load(settings, onChange) {
  if (!settings) {
    settings = {};
  }

  translatePage();
  initTabs();

  $(".value").each(function () {
    var $element = $(this);
    var id = $element.attr("id");
    var value = settings[id];

    if ($element.attr("type") === "checkbox") {
      $element.prop("checked", value === true);
    } else {
      $element.val(value === undefined || value === null ? "" : value);
    }

    $element.on("change keyup", function () {
      onChange();
    });
  });

  $("#validateIp").on("click", function () {
    validateIp();
  });
  $("#discoverInverters").on("click", function () {
    discoverInverters();
  });
  $("#discoveryResult").on("click", ".use-inverter-ip", function () {
    var ip = $(this).attr("data-ip");

    $("#ipAddr").val(ip);
    updateTextFields();
    onChange();
    showToast(t("IP %s applied").replace("%s", ip));
  });

  onChange(false);
  updateTextFields();
}

function save(callback) {
  var settings = {};

  $(".value").each(function () {
    var $element = $(this);
    var id = $element.attr("id");

    if ($element.attr("type") === "checkbox") {
      settings[id] = $element.prop("checked");
    } else if ($element.hasClass("number")) {
      settings[id] = Number($element.val());
    } else {
      settings[id] = String($element.val() || "").trim();
    }
  });

  callback(settings);
}

function initTabs() {
  if ($.fn && $.fn.tabs) {
    $(".tabs").tabs();
    return;
  }

  if (typeof M !== "undefined" && M.Tabs) {
    M.Tabs.init(document.querySelectorAll(".tabs"));
  }
}

function validateIp() {
  sendCommand(
    "validateIp",
    {
      ip: $("#ipAddr").val(),
      timeoutMs: 1000,
    },
    function (response) {
      if (response && response.valid && response.reachable) {
        showToast(t("Inverter reachable"));
        return;
      }

      showToast((response && response.error) || t("Inverter not reachable"));
    },
  );
}

function discoverInverters() {
  var $result = $("#discoveryResult");
  $result.html('<div class="progress"><div class="indeterminate"></div></div>');

  sendCommand(
    "discoverInverters",
    {
      ip: $("#ipAddr").val(),
      subnet: $("#discoverySubnet").val(),
      timeoutMs: 700,
      concurrency: 64,
    },
    function (response) {
      renderDiscoveryResult(response);
    },
  );
}

function sendCommand(command, message, callback) {
  sendTo(adapter + "." + instance, command, message, callback);
}

function renderDiscoveryResult(response) {
  var found = response && Array.isArray(response.found) ? response.found : [];
  var searched = Number(response && response.searched ? response.searched : 0);
  var rows = [];
  var index;

  if (found.length === 0) {
    $("#discoveryResult").html(
      '<div class="discovery-empty">' +
        t("No inverter found. Searched %s addresses.").replace("%s", searched) +
        "</div>",
    );
    return;
  }

  for (index = 0; index < found.length; index++) {
    rows.push(renderDiscoveryRow(found[index]));
  }

  $("#discoveryResult").html(
    "<div>" +
      t("Found %s inverter(s). Searched %s addresses.")
        .replace("%s", found.length)
        .replace("%s", searched) +
      '</div><table class="striped responsive-table"><thead><tr><th>IP</th><th>Info</th><th></th></tr></thead><tbody>' +
      rows.join("") +
      "</tbody></table>",
  );
}

function renderDiscoveryRow(inverter) {
  var info = inverter.idInfo || {};
  var details = [];

  if (info.modelName) {
    details.push(escapeHtml(info.modelName));
  }
  if (info.serialNumber) {
    details.push("SN " + escapeHtml(info.serialNumber));
  }
  if (info.internalVersion) {
    details.push(escapeHtml(info.internalVersion));
  }

  return (
    "<tr><td>" +
    escapeHtml(inverter.ip) +
    "</td><td>" +
    details.join(" | ") +
    '</td><td class="right-align"><a class="waves-effect waves-light btn-small blue use-inverter-ip" data-ip="' +
    escapeHtml(inverter.ip) +
    '">' +
    t("Use") +
    "</a></td></tr>"
  );
}

function translatePage() {
  $(".translate").each(function () {
    var $element = $(this);
    var text = $element.text();

    $element.text(t(text));
  });
}

function t(text) {
  if (typeof _ === "function") {
    return _(text);
  }

  return text;
}

function updateTextFields() {
  if (typeof M !== "undefined" && M.updateTextFields) {
    M.updateTextFields();
  }
}

function showToast(message) {
  if (typeof M !== "undefined" && M.toast) {
    M.toast({ html: escapeHtml(message), displayLength: 3000 });
  } else {
    $("#discoveryResult").prepend(
      '<div class="discovery-empty">' + escapeHtml(message) + "</div>",
    );
  }
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
