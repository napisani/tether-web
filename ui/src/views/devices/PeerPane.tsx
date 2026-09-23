import type { WifiPeer, WifiState } from "./devicesState";
import type { PeerActions } from "./usePeerCommands";

function routeDetail(peer: WifiPeer, wifi: WifiState): string {
  if (peer.connected && peer.paired) {
    return wifi.clipboardAvailable
      ? "Clipboard, files, and one-time codes are connected."
      : "Files and one-time codes are connected. Browser clipboard access is permission-based.";
  }
  if (!wifi.mdnsAvailable) return "avahi-daemon is not running, so other devices cannot find this computer.";
  if (wifi.firewallActive && peer.address) {
    return "A device is nearby, but a firewall may be blocking inbound TCP 5134.";
  }
  return "No paired device is connected. Put both devices on the same network.";
}

export function PeerPane({
  peer,
  wifi,
  actions,
  onForget,
}: {
  peer: WifiPeer;
  wifi: WifiState;
  actions: PeerActions;
  onForget: () => void;
}) {
  const location = peer.address ? `${peer.address}:${peer.port}` : "Address unavailable";
  return (
    <div className="device-pane-content peer-pane">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">Wi-Fi</span>
          <h2>{peer.name}</h2>
          <p className="address">{location}</p>
          <p className="peer-fingerprint"><span>Fingerprint</span><code>{peer.fingerprint}</code></p>
        </div>
        <span className={`connection-pill ${peer.connected ? "connected" : ""}`}>
          <span className={`row-dot ${peer.connected ? "online" : ""}`} aria-hidden="true" />
          {peer.connected ? "Connected" : peer.paired ? "Offline" : peer.pending ? "Approval needed" : "Nearby"}
        </span>
      </div>

      <section className="status-section" aria-labelledby="wifi-route-title">
        <div className="section-heading"><h3 id="wifi-route-title">Wi-Fi route</h3><span>Live from tetherd</span></div>
        <p className="route-detail">{routeDetail(peer, wifi)}</p>
      </section>

      <div className="actions">
        {peer.paired ? (
          <button className="secondary-button danger" type="button" onClick={onForget}>Forget device</button>
        ) : peer.pending ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => actions.accept(peer)}
            disabled={Boolean(wifi.pairingFingerprint)}
          >
            Approve and trust
          </button>
        ) : peer.address ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => actions.pair(peer)}
            disabled={Boolean(wifi.pairingFingerprint)}
          >
            {wifi.pairingFingerprint === peer.fingerprint ? "Waiting for approval…" : "Send pair request"}
          </button>
        ) : null}
        <p>
          {peer.paired
            ? peer.connected ? "This device can exchange clipboard data, files, and one-time codes." : "Open Tether on the other device to reconnect."
            : peer.pending ? "Confirm that you recognize this device before trusting it." : "Approval is required on the other device."}
        </p>
      </div>
      {wifi.message ? <div className="diagnostic-note" role="status"><span aria-hidden="true">i</span><p>{wifi.message}</p></div> : null}
    </div>
  );
}

export function ConfirmPeerForgetDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="pairing-dialog" role="dialog" aria-modal="true" aria-labelledby="forget-peer-title">
        <h2 id="forget-peer-title">Forget {name}?</h2>
        <p>Tether will stop trusting this device. Forget this computer on the other device too before pairing again.</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="button" onClick={onConfirm}>Forget device</button>
        </div>
      </div>
    </div>
  );
}
