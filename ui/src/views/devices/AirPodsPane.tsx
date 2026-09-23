import type { AirPodsEvent, BluetoothDevice, BluetoothStatusEvent } from "../../protocol";
import type { AirPodsActions } from "./useAirPodsCommands";
import { deviceDisplayName } from "./device";

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
  if (available.length > 0) return available.map(([label, level]) => `${label} ${level}%`).join(" · ");
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
  const earKnown = Boolean(airpods && (airpods.ear.primary !== "unknown" || airpods.ear.secondary !== "unknown"));
  const handoffAvailable = managed && Boolean(bluetooth?.apple_device_id || bluetooth?.calls_enabled);
  const modeAvailable = managed && Boolean(airpods?.anc);

  return (
    <div className="device-pane-content airpods-pane">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">AirPods</span>
          <h2>{airpods?.name || deviceDisplayName(device)}</h2>
          <p className="address">{device.address}</p>
        </div>
        <span className={`connection-pill ${device.connected ? "connected" : ""}`}>
          <span className={`row-dot ${device.connected ? "online" : ""}`} aria-hidden="true" />
          {device.connected ? "Connected" : device.paired ? "Paired" : "Nearby"}
        </span>
      </div>

      <p className="airpods-battery" aria-live="polite">{managed ? batteryText(airpods) : "AirPods management is off."}</p>

      <div className="actions">
        <button
          className="secondary-button"
          type="button"
          disabled={connecting}
          onClick={() => actions.connect(device.address, !device.connected)}
        >
          {connectingThisDevice ? "Working…" : connecting ? "AirPods busy" : device.connected ? "Disconnect" : "Connect"}
        </button>
      </div>

      <section className="settings-group" aria-labelledby="airpods-management-title">
        <h3 id="airpods-management-title">Management</h3>
        <label className="setting-row">
          <input type="checkbox" checked={managed} onChange={(event) => actions.setManaged(event.target.checked)} />
          <span><strong>Manage AirPods from Tether</strong><small>Turn this off to let another AirPods program use the channel.</small></span>
        </label>
      </section>

      <section className="settings-group" aria-labelledby="airpods-mode-title">
        <h3 id="airpods-mode-title">Listening mode</h3>
        <div className="segmented-control" role="group" aria-labelledby="airpods-mode-title">
          {listeningModes.map(([mode, label]) => (
            <button
              type="button"
              key={mode}
              aria-pressed={airpods?.anc === mode}
              disabled={!modeAvailable}
              onClick={() => actions.setMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {!managed ? <p className="muted-copy">Tether is not managing the AirPods, so another program can use them.</p>
          : !airpods?.anc ? <p className="muted-copy">These AirPods do not report a listening mode.</p> : null}
      </section>

      <section className="settings-group" aria-labelledby="airpods-ear-title">
        <h3 id="airpods-ear-title">In-ear detection</h3>
        <p>{wornText(airpods)}</p>
        <label className="setting-row compact">
          <span>Pause playback when</span>
          <select
            value={bluetooth?.airpods_pause || "never"}
            disabled={!managed || !earKnown}
            onChange={(event) => actions.setPause(event.target.value as NonNullable<BluetoothStatusEvent["airpods_pause"]>)}
          >
            <option value="never">Never</option>
            <option value="one-removed">One bud is removed</option>
            <option value="both-removed">Both buds are removed</option>
          </select>
        </label>
      </section>

      <section className="settings-group" aria-labelledby="airpods-calls-title">
        <h3 id="airpods-calls-title">Calls</h3>
        <label className="setting-row">
          <input
            type="checkbox"
            checked={bluetooth?.airpods_handoff ?? false}
            disabled={!handoffAvailable}
            onChange={(event) => actions.setHandoff(event.target.checked)}
          />
          <span><strong>Hand the AirPods to the iPhone during a call</strong><small>Requires call control or Apple's native handoff.</small></span>
        </label>
        <p className="muted-copy">
          {bluetooth?.apple_device_id
            ? "The buds are handed over with Apple's own handoff."
            : "The buds are handed over by disconnecting them."}
        </p>
      </section>

      {message ? <div className="diagnostic-note" role="status"><span aria-hidden="true">!</span><p>{message}</p></div> : null}
    </div>
  );
}
