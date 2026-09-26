import type { AirPodsEvent, BluetoothDevice, BluetoothStatusEvent } from "../../protocol";
import type { AirPodsActions } from "./useAirPodsCommands";
import { deviceDisplayName } from "./device";
import { airPodsPauseSchema } from "../../protocolSchemas";

const listeningModes = [
  ["off", "Off"],
  ["transparency", "Transparency"],
  ["adaptive", "Adaptive"],
  ["anc", "Noise Cancellation"],
] as const;

function batteryText(airpods?: AirPodsEvent): string {
  if (!airpods) return "Reading battery…";

  const levels = [
    ["Left earbud", airpods.left],
    ["Right earbud", airpods.right],
    ["Case", airpods.case],
  ] as const;

  const available = levels.filter(([, level]) => level >= 0);

  if (available.length > 0)
    return available.map(([label, level]) => `${label} ${level}%`).join(" · ");

  if (airpods.status === "busy" || airpods.status === "failed") return airpods.reason;

  return "Reading battery…";
}

function wornText(airpods?: AirPodsEvent): string {
  if (!airpods || (airpods.ear.primary === "unknown" && airpods.ear.secondary === "unknown")) {
    return "These AirPods do not report whether they are being worn.";
  }

  if (airpods.in_ear === 2) return "Both buds are in.";

  if (airpods.in_ear === 1) return "One bud is in.";

  return "Neither bud is in.";
}

function AirPodsHeader({ device, name }: { device: BluetoothDevice; name?: string }) {
  return (
    <div className="detail-heading">
      <div>
        <span className="eyebrow">AirPods</span>
        <h2>{name || deviceDisplayName(device)}</h2>
        <p className="address">{device.address}</p>
      </div>
      <span className={`connection-pill ${device.connected ? "connected" : ""}`}>
        <span className={`row-dot ${device.connected ? "online" : ""}`} aria-hidden="true" />
        {device.connected ? "Connected" : device.paired ? "Paired" : "Nearby"}
      </span>
    </div>
  );
}

function AirPodsConnection({
  device,
  connecting,
  connectingThisDevice,
  onConnect,
}: {
  device: BluetoothDevice;
  connecting: boolean;
  connectingThisDevice: boolean;
  onConnect: (address: string, connect: boolean) => void;
}) {
  return (
    <div className="actions">
      <button
        className="secondary-button"
        type="button"
        disabled={connecting}
        onClick={() => onConnect(device.address, !device.connected)}
      >
        {connectingThisDevice
          ? "Working…"
          : connecting
            ? "AirPods busy"
            : device.connected
              ? "Disconnect"
              : "Connect"}
      </button>
    </div>
  );
}

function AirPodsManagement({
  managed,
  onChange,
}: {
  managed: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <section className="settings-group" aria-labelledby="airpods-management-title">
      <h3 id="airpods-management-title">Management</h3>
      <label className="setting-row" aria-label="Manage AirPods from Tether">
        <input
          type="checkbox"
          checked={managed}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <strong>Manage AirPods from Tether</strong>
          <small>Turn this off to let another AirPods program use the channel.</small>
        </span>
      </label>
    </section>
  );
}

function AirPodsListening({
  managed,
  mode,
  available,
  onChange,
}: {
  managed: boolean;
  mode?: AirPodsEvent["anc"];
  available: boolean;
  onChange: (mode: NonNullable<AirPodsEvent["anc"]>) => void;
}) {
  return (
    <section className="settings-group" aria-labelledby="airpods-mode-title">
      <h3 id="airpods-mode-title">Listening mode</h3>
      <div className="segmented-control" role="group" aria-labelledby="airpods-mode-title">
        {listeningModes.map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={mode === value}
            disabled={!available}
            onClick={() => onChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {!managed ? (
        <p className="muted-copy">
          Tether is not managing the AirPods, so another program can use them.
        </p>
      ) : !mode ? (
        <p className="muted-copy">These AirPods do not report a listening mode.</p>
      ) : null}
    </section>
  );
}

function AirPodsEar({
  managed,
  known,
  pause,
  airpods,
  onPause,
}: {
  managed: boolean;
  known: boolean;
  pause?: BluetoothStatusEvent["airpods_pause"];
  airpods?: AirPodsEvent;
  onPause: (pause: NonNullable<BluetoothStatusEvent["airpods_pause"]>) => void;
}) {
  return (
    <section className="settings-group" aria-labelledby="airpods-ear-title">
      <h3 id="airpods-ear-title">In-ear detection</h3>
      <p>{wornText(airpods)}</p>
      <label className="setting-row compact">
        <span>Pause playback when</span>
        <select
          value={pause || "never"}
          disabled={!managed || !known}
          onChange={(event) => {
            const parsed = airPodsPauseSchema.safeParse(event.target.value);

            if (parsed.success) onPause(parsed.data);
          }}
        >
          <option value="never">Never</option>
          <option value="one-removed">One bud is removed</option>
          <option value="both-removed">Both buds are removed</option>
        </select>
      </label>
    </section>
  );
}

function AirPodsCalls({
  available,
  handoff,
  appleDevice,
  onChange,
}: {
  available: boolean;
  handoff?: boolean;
  appleDevice?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <section className="settings-group" aria-labelledby="airpods-calls-title">
      <h3 id="airpods-calls-title">Calls</h3>
      <label className="setting-row" aria-label="Hand the AirPods to the iPhone during a call">
        <input
          type="checkbox"
          checked={handoff ?? false}
          disabled={!available}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <strong>Hand the AirPods to the iPhone during a call</strong>
          <small>Requires call control or Apple's native handoff.</small>
        </span>
      </label>
      <p className="muted-copy">
        {appleDevice
          ? "The buds are handed over with Apple's own handoff."
          : "The buds are handed over by disconnecting them."}
      </p>
    </section>
  );
}

export function AirPodsPane({
  device,
  airpods,
  bluetooth,
  connectingAddress,
  message,
  actions,
}: {
  device: BluetoothDevice;
  airpods?: AirPodsEvent;
  bluetooth?: BluetoothStatusEvent;
  connectingAddress?: string;
  message?: string;
  actions: AirPodsActions;
}) {
  const managed = bluetooth?.airpods_enabled ?? false;
  const connecting = Boolean(connectingAddress);
  const connectingThisDevice = connectingAddress === device.address;

  const earKnown = Boolean(
    airpods && (airpods.ear.primary !== "unknown" || airpods.ear.secondary !== "unknown"),
  );

  const handoffAvailable =
    managed && Boolean(bluetooth?.apple_device_id || bluetooth?.calls_enabled);

  const modeAvailable = managed && Boolean(airpods?.anc);

  return (
    <div className="device-pane-content airpods-pane">
      <AirPodsHeader device={device} name={airpods?.name} />
      <p className="airpods-battery" aria-live="polite">
        {managed ? batteryText(airpods) : "AirPods management is off."}
      </p>
      <AirPodsConnection
        device={device}
        connecting={connecting}
        connectingThisDevice={connectingThisDevice}
        onConnect={(address, connect) => actions.connect(address, connect)}
      />
      <AirPodsManagement managed={managed} onChange={(enabled) => actions.setManaged(enabled)} />
      <AirPodsListening
        managed={managed}
        mode={airpods?.anc}
        available={modeAvailable}
        onChange={(mode) => actions.setMode(mode)}
      />
      <AirPodsEar
        managed={managed}
        known={earKnown}
        pause={bluetooth?.airpods_pause}
        airpods={airpods}
        onPause={(mode) => actions.setPause(mode)}
      />
      <AirPodsCalls
        available={handoffAvailable}
        handoff={bluetooth?.airpods_handoff}
        appleDevice={bluetooth?.apple_device_id}
        onChange={(enabled) => actions.setHandoff(enabled)}
      />
      {message ? (
        <div className="diagnostic-note" role="status">
          <span aria-hidden="true">!</span>
          <p>{message}</p>
        </div>
      ) : null}
    </div>
  );
}
