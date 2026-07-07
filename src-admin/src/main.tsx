import {
  GenericApp,
  I18n,
  Loader,
  Logo,
  type GenericAppProps,
  type GenericAppState,
} from "@iobroker/adapter-react-v5";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CssBaseline,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  Paper,
  Snackbar,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ThemeProvider,
  Typography,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import TuneIcon from "@mui/icons-material/Tune";
import Grid from "@mui/material/Grid2";
import React, { useCallback, useMemo, useState } from "react";
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

type SendCommand = (
  command: string,
  message: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

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

const ADVANCED_FIELDS: Array<{
  key: keyof NativeConfig;
  label: string;
  help: string;
}> = [
  {
    key: "pollExtended",
    label: "Poll extended registers",
    help: "Reads running data registers 35100-35220: PV, grid, load, battery, temperatures, modes, errors, energy and diagnostics.",
  },
  {
    key: "pollSimccid",
    label: "Poll SIMCCID",
    help: "Reads SIMCCID register 35050 from the GPRS module.",
  },
  {
    key: "pollExtendedMeter",
    label: "Poll extended meter",
    help: "Reads external meter registers 36000-36044: connection state, phase power, power factor, frequency and total energy.",
  },
  {
    key: "pollFlashInfo",
    label: "Poll flash info",
    help: "Reads flash registers 36900-36913: parameter versions, write counters, EEPROM version and Wi-Fi debug counters.",
  },
  {
    key: "pollBmsExtended",
    label: "Poll BMS extended",
    help: "Reads BMS registers 37000-37055: battery status, SOC/SOH, errors, warnings, cell min/max values and pass information.",
  },
  {
    key: "pollBmsDetail",
    label: "Poll BMS detail",
    help: "Reads detailed BMS registers 37100-37149: BMS mode, charge/discharge limits, relay status, module currents, SOC and serial numbers.",
  },
  {
    key: "pollCeiAutoTest",
    label: "Poll CEI auto test",
    help: "Reads CEI auto-test registers 38000-38067: test mode, result, phase voltage/frequency fault values and times.",
  },
  {
    key: "pollPowerLimit",
    label: "Poll power limit",
    help: "Reads power limit registers 38450-38463: feed-in limit, phase limits, power factor, PV meter power, grid charge and dispatch values.",
  },
];

const SEND_TIMEOUT_MS = 45000;
const README_URL =
  "https://github.com/typhosj/ioBroker.goodwe/blob/main/README.md";
const FOOTER_HEIGHT = { xs: 56, sm: 64 };

I18n.setTranslations({
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
});

function t(text: string, ...args: Array<string | number>): string {
  return I18n.t(text, ...args);
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, normalizeNumber(value, fallback)));
}

function normalizeString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function normalizeConfig(settings: Partial<NativeConfig>): NativeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...settings,
    ipAddr: String(settings.ipAddr ?? ""),
    discoverySubnet: String(settings.discoverySubnet ?? ""),
    pollCycle: clampNumber(
      settings.pollCycle,
      DEFAULT_CONFIG.pollCycle,
      10,
      3600,
    ),
    timeoutMs: clampNumber(
      settings.timeoutMs,
      DEFAULT_CONFIG.timeoutMs,
      1000,
      30000,
    ),
    retries: clampNumber(settings.retries, DEFAULT_CONFIG.retries, 0, 5),
    pollExtended: settings.pollExtended !== false,
    pollSimccid: settings.pollSimccid !== false,
    pollExtendedMeter: settings.pollExtendedMeter !== false,
    pollFlashInfo: settings.pollFlashInfo !== false,
    pollBmsExtended: settings.pollBmsExtended !== false,
    pollBmsDetail: settings.pollBmsDetail === true,
    pollCeiAutoTest: settings.pollCeiAutoTest !== false,
    pollPowerLimit: settings.pollPowerLimit === true,
  };
}

function GoodWeConfig(props: {
  common: Record<string, unknown>;
  config: NativeConfig;
  instance: number;
  onError: (text: string) => void;
  onLoadConfig: (config: Record<string, unknown>) => void;
  sendCommand: SendCommand;
  updateConfig: <Key extends keyof NativeConfig>(
    key: Key,
    value: NativeConfig[Key],
  ) => void;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState(0);
  const [busy, setBusy] = useState<"validate" | "discover" | null>(null);
  const [message, setMessage] = useState("");
  const [messageSeverity, setMessageSeverity] = useState<
    "success" | "info" | "error"
  >("info");
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);

  const showMessage = useCallback(
    (text: string, severity: "success" | "info" | "error" = "info") => {
      setMessage(text);
      setMessageSeverity(severity);
    },
    [],
  );

  const validateIp = useCallback(async () => {
    setBusy("validate");
    setMessage("");

    try {
      const response = (await props.sendCommand(
        "validateIp",
        {
          ip: props.config.ipAddr,
          timeoutMs: 1000,
        },
        5000,
      )) as ValidateResponse;

      if (response.valid && response.reachable) {
        showMessage(t("Inverter reachable"), "success");
      } else {
        showMessage(response.error || t("Inverter not reachable"), "error");
      }
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      setBusy(null);
    }
  }, [props, showMessage]);

  const discoverInverters = useCallback(async () => {
    setBusy("discover");
    setMessage("");
    setDiscovery(null);

    try {
      const response = (await props.sendCommand("discoverInverters", {
        ip: props.config.ipAddr,
        subnet: props.config.discoverySubnet,
        timeoutMs: 700,
        concurrency: 64,
      })) as DiscoveryResponse;

      setDiscovery(response);
      if (response.error) {
        showMessage(response.error, "error");
      }
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : String(error),
        "error",
      );
    } finally {
      setBusy(null);
    }
  }, [props, showMessage]);

  const applyIp = useCallback(
    (ip: string) => {
      props.updateConfig("ipAddr", ip);
      showMessage(t("IP %s applied", ip), "success");
    },
    [props, showMessage],
  );

  const found = useMemo(() => discovery?.found ?? [], [discovery]);
  const searched = Number(discovery?.searched ?? 0);
  const busyText = busy === "validate" ? t("Checking...") : t("Searching...");
  const snackbarMessage = busy ? busyText : message;

  return (
    <Box
      component="main"
      sx={{
        bgcolor: "background.default",
        color: "text.primary",
        height: {
          xs: `calc(100% - ${FOOTER_HEIGHT.xs}px)`,
          sm: `calc(100% - ${FOOTER_HEIGHT.sm}px)`,
        },
        overflowY: "auto",
      }}
    >
      <Box
        sx={{
          minHeight: 72,
          position: "relative",
          px: 1,
          py: 1,
        }}
      >
        <Logo
          common={props.common}
          instance={props.instance}
          native={props.config}
          onError={props.onError}
          onLoad={props.onLoadConfig}
        />
        <Typography
          component="h1"
          sx={{
            fontWeight: 700,
            left: 84,
            position: "absolute",
            top: 18,
          }}
          variant="h6"
        >
          GoodWe
        </Typography>
      </Box>

      <Tabs
        aria-label={t("GoodWe settings")}
        sx={{ borderBottom: 1, borderColor: "divider" }}
        value={activeTab}
        onChange={(_event, value: number) => setActiveTab(value)}
      >
        <Tab
          icon={<SettingsIcon />}
          iconPosition="start"
          label={t("Basic settings")}
        />
        <Tab
          icon={<TuneIcon />}
          iconPosition="start"
          label={t("Advanced settings")}
        />
      </Tabs>

      {activeTab === 0 ? (
        <Box sx={{ p: 1, py: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: "grow" }}>
              <TextField
                fullWidth
                helperText={t(
                  "IP address used for polling and connection checks.",
                )}
                label={t("Inverter IP")}
                placeholder="192.168.1.42"
                value={props.config.ipAddr}
                variant="standard"
                onChange={(event) =>
                  props.updateConfig("ipAddr", event.target.value)
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: "auto" }}>
              <Button
                disabled={busy !== null}
                fullWidth
                variant="contained"
                onClick={validateIp}
              >
                {t("Validate inverter IP")}
              </Button>
            </Grid>

            <Grid size={{ xs: 12, md: "grow" }}>
              <TextField
                fullWidth
                helperText={t(
                  "Limits discovery to this /24 network. Leave empty to search local IPv4 networks.",
                )}
                label={t("Discovery subnet")}
                placeholder="192.168.1.0/24"
                value={props.config.discoverySubnet}
                variant="standard"
                onChange={(event) =>
                  props.updateConfig("discoverySubnet", event.target.value)
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: "auto" }}>
              <Button
                disabled={busy !== null}
                fullWidth
                variant="contained"
                onClick={discoverInverters}
              >
                {t("Discover inverters")}
              </Button>
            </Grid>
          </Grid>

          {discovery ? (
            <DiscoveryResult
              found={found}
              searched={searched}
              onApplyIp={applyIp}
            />
          ) : null}

          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                helperText={t("Seconds, 10-3600")}
                label={t("Poll cycle")}
                slotProps={{ htmlInput: { min: 10, max: 3600 } }}
                type="number"
                value={props.config.pollCycle}
                variant="standard"
                onChange={(event) =>
                  props.updateConfig(
                    "pollCycle",
                    normalizeNumber(
                      event.target.value,
                      DEFAULT_CONFIG.pollCycle,
                    ),
                  )
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                helperText={t("Milliseconds, 1000-30000")}
                label={t("Timeout")}
                slotProps={{ htmlInput: { min: 1000, max: 30000 } }}
                type="number"
                value={props.config.timeoutMs}
                variant="standard"
                onChange={(event) =>
                  props.updateConfig(
                    "timeoutMs",
                    normalizeNumber(
                      event.target.value,
                      DEFAULT_CONFIG.timeoutMs,
                    ),
                  )
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                helperText={t("0-5 per UDP request")}
                label={t("Retries")}
                slotProps={{ htmlInput: { min: 0, max: 5 } }}
                type="number"
                value={props.config.retries}
                variant="standard"
                onChange={(event) =>
                  props.updateConfig(
                    "retries",
                    normalizeNumber(event.target.value, DEFAULT_CONFIG.retries),
                  )
                }
              />
            </Grid>
          </Grid>
        </Box>
      ) : (
        <FormGroup sx={{ p: 1, py: 2 }}>
          {ADVANCED_FIELDS.map((field) => (
            <Box key={field.key} sx={{ mb: 1 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={props.config[field.key] === true}
                    onChange={(event) =>
                      props.updateConfig(field.key, event.target.checked)
                    }
                  />
                }
                label={t(field.label)}
                sx={{ mb: 0 }}
              />
              <FormHelperText sx={{ ml: 4, mt: -0.5 }}>
                {t(field.help)}
              </FormHelperText>
            </Box>
          ))}
        </FormGroup>
      )}

      <Snackbar
        anchorOrigin={{ horizontal: "left", vertical: "bottom" }}
        autoHideDuration={busy ? null : 6000}
        open={snackbarMessage !== ""}
        sx={{
          bottom: {
            xs: `${FOOTER_HEIGHT.xs + 8}px`,
            sm: `${FOOTER_HEIGHT.sm + 8}px`,
          },
        }}
        onClose={() => {
          if (!busy) {
            setMessage("");
          }
        }}
      >
        <Alert
          severity={busy ? "info" : messageSeverity}
          variant="filled"
          onClose={() => {
            if (!busy) {
              setMessage("");
            }
          }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function DiscoveryResult(props: {
  found: DiscoveryItem[];
  onApplyIp: (ip: string) => void;
  searched: number;
}): React.JSX.Element {
  if (props.found.length === 0) {
    return (
      <Alert severity="info" sx={{ mt: 2, mb: 3 }}>
        {t("No inverter found. Searched %s addresses.", props.searched)}
      </Alert>
    );
  }

  return (
    <TableContainer component={Paper} sx={{ mt: 2, mb: 3 }}>
      <Box sx={{ p: 2 }}>
        <Typography variant="body2">
          {t(
            "Found %s inverter(s). Searched %s addresses.",
            props.found.length,
            props.searched,
          )}
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t("IP")}</TableCell>
            <TableCell>{t("Info")}</TableCell>
            <TableCell align="right">{t("Action")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {props.found.map((inverter) => (
            <TableRow key={inverter.ip}>
              <TableCell>{inverter.ip}</TableCell>
              <TableCell>{formatInfo(inverter.idInfo)}</TableCell>
              <TableCell align="right">
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => props.onApplyIp(inverter.ip)}
                >
                  {t("Use")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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

class GoodWeApp extends GenericApp<GenericAppProps, GenericAppState> {
  constructor(props: GenericAppProps) {
    super(props, {
      adapterName: "goodwe",
      bottomButtons: true,
      translations: {
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
      },
    });
  }

  onPrepareLoad(
    settings: Record<string, unknown>,
    encryptedNative?: string[],
  ): void {
    super.onPrepareLoad(settings, encryptedNative);
    Object.assign(settings, normalizeConfig(settings));
  }

  onPrepareSave(settings: Record<string, unknown>): boolean {
    Object.assign(
      settings,
      normalizeConfig({
        ...settings,
        ipAddr: normalizeString(settings.ipAddr).trim(),
        discoverySubnet: normalizeString(settings.discoverySubnet).trim(),
      }),
    );

    return super.onPrepareSave(settings);
  }

  private sendCommand: SendCommand = (
    command,
    message,
    timeoutMs = SEND_TIMEOUT_MS,
  ) => {
    const request = this.socket.sendTo(
      `${this.adapterName}.${this.instance}`,
      command,
      message,
    );
    const timeout = new Promise<never>((_resolve, reject) => {
      window.setTimeout(
        () => reject(new Error(t("Request timed out"))),
        timeoutMs,
      );
    });

    return Promise.race([request, timeout]).then((response) => {
      const typedResponse = response as { error?: string; result?: unknown };
      if (typedResponse?.error) {
        return { error: typedResponse.error };
      }

      return typedResponse?.result ?? response;
    });
  };

  private updateConfig = <Key extends keyof NativeConfig>(
    key: Key,
    value: NativeConfig[Key],
  ): void => {
    this.updateNativeValue(key, value);
  };

  private loadConfig = (config: Record<string, unknown>): void => {
    this.onLoadConfig(normalizeConfig(config));
  };

  private showConfigError = (text: string): void => {
    this.showError(text);
  };

  render(): React.JSX.Element {
    if (!this.state.loaded) {
      return <Loader themeType={this.state.themeType} />;
    }

    const config = normalizeConfig(this.state.native as Partial<NativeConfig>);

    return (
      <ThemeProvider theme={this.state.theme}>
        <CssBaseline />
        <GoodWeConfig
          common={
            (this.common as Record<string, unknown> | null) ?? {
              icon: "goodwe.png",
              name: "goodwe",
              readme: README_URL,
            }
          }
          config={config}
          instance={this.instance}
          onError={this.showConfigError}
          onLoadConfig={this.loadConfig}
          sendCommand={this.sendCommand}
          updateConfig={this.updateConfig}
        />
        {this.renderHelperDialogs()}
      </ThemeProvider>
    );
  }
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}

createRoot(container).render(<GoodWeApp />);
