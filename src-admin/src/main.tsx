import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import de from "../../admin/i18n/de.json";
import en from "../../admin/i18n/en.json";
import es from "../../admin/i18n/es.json";
import fr from "../../admin/i18n/fr.json";
import it from "../../admin/i18n/it.json";
import nl from "../../admin/i18n/nl.json";
import pl from "../../admin/i18n/pl.json";
import pt from "../../admin/i18n/pt.json";
import ru from "../../admin/i18n/ru.json";
import uk from "../../admin/i18n/uk.json";
import zhCn from "../../admin/i18n/zh-cn.json";
import "./style.css";

type NativeConfig = {
  ipAddr: string;
  discoverySubnet: string;
  pollCycle: number;
  timeoutMs: number;
  retries: number;
  pollExtended: boolean;
  pollSimccid: boolean;
  pollExtendedMeter: boolean;
  pollFlashInfo: boolean;
  pollBmsExtended: boolean;
  pollBmsDetail: boolean;
  pollCeiAutoTest: boolean;
  pollPowerLimit: boolean;
};

type DiscoveryInfo = {
  modelName?: string;
  serialNumber?: string;
  internalVersion?: string;
};

type DiscoveryItem = {
  ip: string;
  idInfo?: DiscoveryInfo;
};

type DiscoveryResponse = {
  found?: DiscoveryItem[];
  searched?: number;
  error?: string;
};

type ValidateResponse = {
  valid?: boolean;
  reachable?: boolean;
  error?: string;
};

type AdapterWindow = Window &
  typeof globalThis & {
    adapter: string;
    instance: number;
    systemLang?: string;
    sendTo: (
      target: string,
      command: string,
      message: Record<string, unknown>,
      callback: (response: unknown) => void,
    ) => void;
    load: (
      settings: Partial<NativeConfig>,
      onChange: (changed?: boolean) => void,
    ) => void;
    save: (callback: (settings: NativeConfig) => void) => void;
  };

type TranslationKey = keyof typeof en;
type Translations = Record<TranslationKey, string>;

const DEFAULT_CONFIG: NativeConfig = {
  ipAddr: "",
  discoverySubnet: "",
  pollCycle: 10,
  timeoutMs: 5000,
  retries: 1,
  pollExtended: true,
  pollSimccid: true,
  pollExtendedMeter: true,
  pollFlashInfo: true,
  pollBmsExtended: true,
  pollBmsDetail: false,
  pollCeiAutoTest: true,
  pollPowerLimit: false,
};

const ADVANCED_FIELDS: Array<{ key: keyof NativeConfig; label: string }> = [
  { key: "pollExtended", label: "Poll extended registers" },
  { key: "pollSimccid", label: "Poll SIMCCID" },
  { key: "pollExtendedMeter", label: "Poll extended meter" },
  { key: "pollFlashInfo", label: "Poll flash info" },
  { key: "pollBmsExtended", label: "Poll BMS extended" },
  { key: "pollBmsDetail", label: "Poll BMS detail" },
  { key: "pollCeiAutoTest", label: "Poll CEI auto test" },
  { key: "pollPowerLimit", label: "Poll power limit" },
];

let currentConfig: NativeConfig = DEFAULT_CONFIG;
let notifyChange: (changed?: boolean) => void = () => undefined;

const TRANSLATIONS: Record<string, Translations> = {
  de,
  en,
  es,
  fr,
  it,
  nl,
  pl,
  pt,
  ru,
  uk,
  "zh-cn": zhCn,
};

function t(text: string): string {
  return getTranslations()[text as TranslationKey] ?? text;
}

function getTranslations(): Translations {
  const adminWindow = window as AdapterWindow;
  const language = normalizeLanguage(adminWindow.systemLang || "en");

  return TRANSLATIONS[language] ?? en;
}

function normalizeLanguage(language: string): string {
  const lower = language.toLowerCase();

  if (lower === "zh-cn" || lower === "zh") {
    return "zh-cn";
  }

  return lower.split("-")[0] || "en";
}

function normalizeConfig(settings: Partial<NativeConfig>): NativeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...settings,
    ipAddr: String(settings.ipAddr ?? ""),
    discoverySubnet: String(settings.discoverySubnet ?? ""),
    pollCycle: Number(settings.pollCycle ?? DEFAULT_CONFIG.pollCycle),
    timeoutMs: Number(settings.timeoutMs ?? DEFAULT_CONFIG.timeoutMs),
    retries: Number(settings.retries ?? DEFAULT_CONFIG.retries),
    pollExtended: settings.pollExtended === true,
    pollSimccid: settings.pollSimccid === true,
    pollExtendedMeter: settings.pollExtendedMeter === true,
    pollFlashInfo: settings.pollFlashInfo === true,
    pollBmsExtended: settings.pollBmsExtended === true,
    pollBmsDetail: settings.pollBmsDetail === true,
    pollCeiAutoTest: settings.pollCeiAutoTest === true,
    pollPowerLimit: settings.pollPowerLimit === true,
  };
}

function sendCommand(
  command: string,
  message: Record<string, unknown>,
): Promise<unknown> {
  const adminWindow = window as AdapterWindow;

  return new Promise((resolve) => {
    adminWindow.sendTo(
      `${adminWindow.adapter}.${adminWindow.instance}`,
      command,
      message,
      resolve,
    );
  });
}

function App(): React.JSX.Element {
  const [config, setConfig] = useState<NativeConfig>(currentConfig);
  const [activeTab, setActiveTab] = useState<"basic" | "advanced">("basic");
  const [busy, setBusy] = useState<"validate" | "discover" | null>(null);
  const [message, setMessage] = useState("");
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);

  useEffect(() => {
    currentConfig = config;
  }, [config]);

  const updateConfig = useCallback(
    <Key extends keyof NativeConfig>(key: Key, value: NativeConfig[Key]) => {
      setConfig((previous) => ({ ...previous, [key]: value }));
      notifyChange();
    },
    [],
  );

  const validateIp = useCallback(async () => {
    setBusy("validate");
    setMessage("");

    try {
      const response = (await sendCommand("validateIp", {
        ip: config.ipAddr,
        timeoutMs: 1000,
      })) as ValidateResponse;

      setMessage(
        response.valid && response.reachable
          ? t("Inverter reachable")
          : response.error || t("Inverter not reachable"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [config.ipAddr]);

  const discoverInverters = useCallback(async () => {
    setBusy("discover");
    setMessage("");
    setDiscovery(null);

    try {
      const response = (await sendCommand("discoverInverters", {
        ip: config.ipAddr,
        subnet: config.discoverySubnet,
        timeoutMs: 700,
        concurrency: 64,
      })) as DiscoveryResponse;

      setDiscovery(response);
      if (response.error) {
        setMessage(response.error);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }, [config.discoverySubnet, config.ipAddr]);

  const applyIp = useCallback(
    (ip: string) => {
      updateConfig("ipAddr", ip);
      setMessage(t("IP %s applied").replace("%s", ip));
    },
    [updateConfig],
  );

  const found = useMemo(() => discovery?.found ?? [], [discovery]);
  const searched = Number(discovery?.searched ?? 0);

  return (
    <main className="shell">
      <nav className="tabs" aria-label="GoodWe settings">
        <button
          className={activeTab === "basic" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("basic")}
        >
          {t("Basic settings")}
        </button>
        <button
          className={activeTab === "advanced" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("advanced")}
        >
          {t("Advanced settings")}
        </button>
      </nav>

      {activeTab === "basic" ? (
        <section className="panel">
          <div className="grid ip-row">
            <TextField
              help="Only the IPv4 address is saved here."
              label="Inverter IP"
              placeholder="192.168.1.42"
              value={config.ipAddr}
              onChange={(value) => updateConfig("ipAddr", value)}
            />
            <button
              className="button action-button"
              disabled={busy !== null}
              type="button"
              onClick={validateIp}
            >
              {busy === "validate"
                ? t("Checking...")
                : t("Validate inverter IP")}
            </button>
          </div>

          <div className="grid subnet-row">
            <TextField
              help="Optional /24 subnet. Empty uses configured IP and local interfaces."
              label="Discovery subnet"
              placeholder="192.168.1.0/24"
              value={config.discoverySubnet}
              onChange={(value) => updateConfig("discoverySubnet", value)}
            />
            <button
              className="button action-button"
              disabled={busy !== null}
              type="button"
              onClick={discoverInverters}
            >
              {busy === "discover"
                ? t("Searching...")
                : t("Discover inverters")}
            </button>
          </div>

          {message !== "" ? <div className="message">{message}</div> : null}

          {discovery ? (
            <DiscoveryResult
              found={found}
              searched={searched}
              onApplyIp={applyIp}
            />
          ) : null}

          <div className="grid timing-row">
            <NumberField
              help="Seconds, 10-3600"
              label="Poll cycle"
              max={3600}
              min={10}
              value={config.pollCycle}
              onChange={(value) => updateConfig("pollCycle", value)}
            />
            <NumberField
              help="Milliseconds, 1000-30000"
              label="Timeout"
              max={30000}
              min={1000}
              value={config.timeoutMs}
              onChange={(value) => updateConfig("timeoutMs", value)}
            />
            <NumberField
              help="0-5 per UDP request"
              label="Retries"
              max={5}
              min={0}
              value={config.retries}
              onChange={(value) => updateConfig("retries", value)}
            />
          </div>
        </section>
      ) : (
        <section className="panel checkbox-grid">
          {ADVANCED_FIELDS.map((field) => (
            <CheckboxField
              checked={config[field.key] === true}
              key={field.key}
              label={field.label}
              onChange={(checked) => updateConfig(field.key, checked)}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function TextField(props: {
  help: string;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{t(props.label)}</span>
      <input
        placeholder={props.placeholder}
        type="text"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <small>{t(props.help)}</small>
    </label>
  );
}

function NumberField(props: {
  help: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{t(props.label)}</span>
      <input
        max={props.max}
        min={props.min}
        type="number"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <small>{t(props.help)}</small>
    </label>
  );
}

function CheckboxField(props: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="checkbox">
      <input
        checked={props.checked}
        type="checkbox"
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{t(props.label)}</span>
    </label>
  );
}

function DiscoveryResult(props: {
  found: DiscoveryItem[];
  onApplyIp: (ip: string) => void;
  searched: number;
}): React.JSX.Element {
  if (props.found.length === 0) {
    return (
      <div className="empty">
        {t("No inverter found. Searched %s addresses.").replace(
          "%s",
          String(props.searched),
        )}
      </div>
    );
  }

  return (
    <div className="result">
      <div>
        {t("Found %s inverter(s). Searched %s addresses.")
          .replace("%s", String(props.found.length))
          .replace("%s", String(props.searched))}
      </div>
      <table>
        <thead>
          <tr>
            <th>IP</th>
            <th>Info</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {props.found.map((inverter) => (
            <tr key={inverter.ip}>
              <td>{inverter.ip}</td>
              <td>{formatInfo(inverter.idInfo)}</td>
              <td>
                <button
                  className="button small"
                  type="button"
                  onClick={() => props.onApplyIp(inverter.ip)}
                >
                  {t("Use")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatInfo(info: DiscoveryInfo | undefined): string {
  if (!info) {
    return "";
  }

  return [
    info.modelName,
    info.serialNumber ? `SN ${info.serialNumber}` : "",
    info.internalVersion,
  ]
    .filter((part) => part)
    .join(" | ");
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

const root = createRoot(container);
const adminWindow = window as AdapterWindow;

function render(settings: Partial<NativeConfig>): void {
  currentConfig = normalizeConfig(settings);
  root.render(<App />);
}

adminWindow.load = (settings, onChange) => {
  notifyChange = onChange;
  render(settings || {});
  onChange(false);
};

adminWindow.save = (callback) => {
  callback({
    ...currentConfig,
    ipAddr: currentConfig.ipAddr.trim(),
    discoverySubnet: currentConfig.discoverySubnet.trim(),
  });
};
