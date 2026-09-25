import type { BluetoothStatusEvent } from "../../protocol";
import type { useBrowserNotifications } from "../../app/useBrowserNotifications";
import { BrowserNotificationsSection } from "./BrowserNotificationsSection";
import type { useSettings } from "./useSettings";
import "./SettingsView.css";

type Settings = ReturnType<typeof useSettings>;

type Retention = "encrypted" | "plaintext" | "none";

function SettingSwitch({ label, description, checked, disabled, onChange }: {
  label: string;
  description: string;
  checked?: boolean;
  disabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const id = label.replaceAll(" ", "-");

  return <div className="settings-row">
    <label htmlFor={id}><strong>{label}</strong><small>{description}</small></label>
    <input id={id} type="checkbox" role="switch" aria-checked={checked === true}
      checked={checked === true} disabled={disabled || checked === undefined}
      onChange={(event) => onChange(event.target.checked)} />
  </div>;
}

function retentionWarning(retention?: Retention, ready?: boolean): string | null {
  if (retention === "encrypted" && ready === false) {
    return "Encrypted storage is paused: tetherd has no desktop keyring key. Unlock the host keyring or select another mode.";
  }

  if (retention === "plaintext") return "Stored messages and contacts are readable on the tetherd host without encryption.";

  if (retention === "none") return "The host is not keeping message history or contacts across restarts.";

  return null;
}

function parseRetention(value: string): Retention | null {
  if (value === "encrypted" || value === "plaintext" || value === "none") return value;

  return null;
}

function confirmRetention(next: Retention): boolean {
  if (next === "none") {
    return window.confirm("Do not keep permanently deletes the host's retained message history and contacts. This cannot be undone. Continue?");
  }

  if (next === "plaintext") {
    return window.confirm("Unencrypted stores messages and contacts as readable files on the tetherd host. Continue?");
  }

  return true;
}

function ConnectionGuidance({ status, daemonConnected, onOpenDevices }: {
  status: BluetoothStatusEvent | null;
  daemonConnected: boolean;
  onOpenDevices: () => void;
}) {
  if (!daemonConnected) return <p className="settings-guidance" role="status">Reconnect to tetherd to change host settings.</p>;

  if (!status) return <p className="settings-guidance" role="status">Loading host settings…</p>;

  if (status.available && status.device_address) return null;

  return <div className="settings-guidance" role="status">
    <p>No iPhone is bonded on this Bluetooth host; iPhone settings are unavailable.</p>
    <button type="button" onClick={onOpenDevices}>View device connection</button>
  </div>;
}

function RetentionSettings({ settings, blocked, storageReady }: {
  settings: Settings;
  blocked: boolean;
  storageReady: boolean;
}) {
  const status = settings.state.status;
  const warning = retentionWarning(status?.retention, status?.retention_ready);

  const setRetention = (value: string) => {
    const next = parseRetention(value);

    if (!next || next === status?.retention || !confirmRetention(next)) return;

    settings.setRetention(next);
  };

  return <section className="settings-group" aria-labelledby="settings-storage"><h2 id="settings-storage">Message history and contacts</h2>
    <label className="settings-row"><span><strong>Keep message history</strong>
      <small>Changing this setting migrates host storage. Do not keep permanently deletes retained messages and contacts.</small></span>
      <select value={status?.retention || ""} disabled={blocked || !storageReady || !status?.retention}
        onChange={(event) => setRetention(event.target.value)} aria-label="Keep message history">
        {!status?.retention && <option value="">Unavailable</option>}
        <option value="encrypted">Encrypted</option><option value="plaintext">Unencrypted</option><option value="none">Do not keep</option>
      </select>
    </label>
    {warning && <p className="settings-warning" role="status">{warning}</p>}
  </section>;
}

function SettingsControls({ settings, daemonConnected, onOpenDevices }: {
  settings: Settings;
  daemonConnected: boolean;
  onOpenDevices: () => void;
}) {
  const { status, pending } = settings.state;
  const blocked = !daemonConnected || Boolean(pending);
  const bonded = Boolean(status?.available && status.enabled !== false && status.device_address);
  const storageReady = Boolean(daemonConnected && status?.available && status.device_address);

  return <>
    <section className="settings-group" aria-labelledby="settings-bluetooth"><h2 id="settings-bluetooth">Bluetooth</h2>
      <p>Pairing and Bluetooth supervision are managed from Devices.</p>
      <button type="button" onClick={onOpenDevices}>Open Devices</button>
    </section>

    <section className="settings-group" aria-labelledby="settings-iphone-alerts"><h2 id="settings-iphone-alerts">iPhone notifications</h2>
      <p>These controls change mirroring on the tetherd host, not browser notification permission.</p>
      <SettingSwitch label="Mirror iPhone notifications" description="Requires a bonded iPhone with Low Energy support."
        checked={status?.ancs_enabled} disabled={blocked || !bonded}
        onChange={(enabled) => settings.toggle("ancs_enabled", enabled)} />
      <SettingSwitch label="Include notification text" description="Shows title and message content; turning this off also disables group-reply correlation."
        checked={status?.ancs_content_enabled} disabled={blocked || !bonded || status?.ancs_enabled !== true}
        onChange={(enabled) => settings.toggle("ancs_content_enabled", enabled)} />
    </section>

    <RetentionSettings settings={settings} blocked={blocked} storageReady={storageReady} />

    <section className="settings-group" aria-labelledby="settings-calls"><h2 id="settings-calls">Experimental</h2>
      <SettingSwitch label="Call control over Bluetooth" description="Answer and place calls on the iPhone; audio does not play in this browser."
        checked={status?.calls_enabled} disabled={blocked || !bonded}
        onChange={(enabled) => settings.toggle("calls_enabled", enabled)} />
    </section>

    <section className="settings-group" aria-labelledby="settings-desktop"><h2 id="settings-desktop">Desktop-only settings</h2>
      <p>Closing to tray, tray icon style, host desktop popups, and locking the host desktop when the iPhone leaves have no browser equivalent. Browser notifications are separate from host desktop popups.</p>
    </section>
  </>;
}

export function SettingsView({ settings, daemonConnected, onOpenDevices, available = true, checking = false,
  browserNotifications }: {
  settings: Settings;
  daemonConnected: boolean;
  onOpenDevices: () => void;
  available?: boolean;
  checking?: boolean;
  browserNotifications?: ReturnType<typeof useBrowserNotifications>;
}) {
  const { state } = settings;

  if (daemonConnected && (!available || checking)) {
    return <main className="settings-view"><div className="settings-inner"><h1>Settings</h1>
      {browserNotifications && <BrowserNotificationsSection alerts={browserNotifications} />}
      <p className="settings-guidance" role="status">{checking ? "Checking tetherd Settings support…"
        : "This version of tetherd does not advertise Settings support."}</p>
    </div></main>;
  }

  return <main className="settings-view"><div className="settings-inner">
    <header className="settings-header"><div><h1>Settings</h1><p>Host settings affect every Tether client connected to this daemon.</p></div>
      <button type="button" onClick={settings.refresh} disabled={!daemonConnected}>Refresh</button>
    </header>
    {browserNotifications && <BrowserNotificationsSection alerts={browserNotifications} />}
    <ConnectionGuidance status={state.status} daemonConnected={daemonConnected} onOpenDevices={onOpenDevices} />
    {state.error && <p className="settings-error" role="alert">{state.error}</p>}
    {state.pending && <p className="settings-pending" role="status">{state.pending.phase === "waiting"
      ? "Waiting for the host to confirm this setting…"
      : "The result is uncertain. Check the host before trying another change."}</p>}
    {state.pending?.phase === "uncertain" && <button type="button" className="settings-resolve" onClick={settings.resolveUncertain}>
      I checked the host — allow another change
    </button>}
    <SettingsControls settings={settings} daemonConnected={daemonConnected} onOpenDevices={onOpenDevices} />
  </div></main>;
}
