import type { ReactNode } from "react";
import "./AppShell.css";

export function AppShell({
  children,
  route,
  onNavigate,
  daemonConnected,
  bluetoothAvailable,
  wifiConnected,
  wifiAvailable,
  phoneConnected,
  version,
}: {
  children: ReactNode;
  route: "devices" | "messages";
  onNavigate: (route: "devices" | "messages") => void;
  daemonConnected: boolean;
  bluetoothAvailable: boolean;
  wifiConnected: boolean;
  wifiAvailable: boolean;
  phoneConnected: boolean;
  version?: string;
}) {
  return (
    <div className="app-shell">
      <AppHeader connected={phoneConnected || wifiConnected} route={route} onNavigate={onNavigate} />
      {children}
      <RouteStatusBar
        daemonConnected={daemonConnected}
        bluetoothAvailable={bluetoothAvailable}
        wifiConnected={wifiConnected}
        wifiAvailable={wifiAvailable}
        phoneConnected={phoneConnected}
        version={version}
      />
    </div>
  );
}

function AppHeader({ connected, route, onNavigate }: {
  connected: boolean;
  route: "devices" | "messages";
  onNavigate: (route: "devices" | "messages") => void;
}) {
  return (
    <header className="app-header">
      <div className="brand" aria-label="Tether">
        <span className="brand-mark" aria-hidden="true">T</span>
        <span>Tether</span>
      </div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <button type="button" className={`nav-item ${route === "devices" ? "active" : ""}`}
          aria-current={route === "devices" ? "page" : undefined} onClick={() => onNavigate("devices")}>Devices</button>
        <button type="button" className={`nav-item ${route === "messages" ? "active" : ""}`}
          aria-current={route === "messages" ? "page" : undefined} onClick={() => onNavigate("messages")}>Messages</button>
        <span className="nav-item future" title="Available in a future web release">Notifications</span>
        <span className="nav-item future" title="Available in a future web release">Calls</span>
        <span className="nav-item future" title="Available in a future web release">Contacts</span>
      </nav>
      <span
        className={`presence-dot ${connected ? "online" : ""}`}
        aria-label={connected ? "device connected" : "device disconnected"}
      />
    </header>
  );
}

function RouteStatusBar({
  daemonConnected,
  bluetoothAvailable,
  wifiConnected,
  wifiAvailable,
  phoneConnected,
  version,
}: {
  daemonConnected: boolean;
  bluetoothAvailable: boolean;
  wifiConnected: boolean;
  wifiAvailable: boolean;
  phoneConnected: boolean;
  version?: string;
}) {
  return (
    <footer className="route-status-bar">
      <RouteStatus icon="◉" label="tetherd" status={daemonConnected ? "connected" : "offline"} active={daemonConnected} />
      <RouteStatus
        icon="⌁"
        label="Wi-Fi"
        status={wifiConnected ? "device connected" : wifiAvailable ? "ready" : "mDNS unavailable"}
        active={wifiConnected}
      />
      <RouteStatus
        icon="ᛒ"
        label="Bluetooth"
        status={phoneConnected ? "iPhone connected" : bluetoothAvailable ? "ready" : "unavailable"}
        active={bluetoothAvailable}
      />
      <span className="version">{version ? `Tether ${version}` : "Tether web"}</span>
    </footer>
  );
}

function RouteStatus({ icon, label, status, active }: { icon: string; label: string; status: string; active: boolean }) {
  return <span className={`route-status ${active ? "active" : ""}`}><span aria-hidden="true">{icon}</span>{label}: {status}</span>;
}
