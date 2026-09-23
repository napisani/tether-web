import type { ReactNode } from "react";
import "./AppShell.css";

export function AppShell({
  children,
  daemonConnected,
  bluetoothAvailable,
  phoneConnected,
  version,
}: {
  children: ReactNode;
  daemonConnected: boolean;
  bluetoothAvailable: boolean;
  phoneConnected: boolean;
  version?: string;
}) {
  return (
    <div className="app-shell">
      <AppHeader connected={phoneConnected} />
      {children}
      <RouteStatusBar
        daemonConnected={daemonConnected}
        bluetoothAvailable={bluetoothAvailable}
        phoneConnected={phoneConnected}
        version={version}
      />
    </div>
  );
}

function AppHeader({ connected }: { connected: boolean }) {
  return (
    <header className="app-header">
      <div className="brand" aria-label="Tether">
        <span className="brand-mark" aria-hidden="true">T</span>
        <span>Tether</span>
      </div>
      <nav className="primary-nav" aria-label="Primary navigation">
        <span className="nav-item active">Devices</span>
        <span className="nav-item future" title="Available in a future web release">Messages</span>
        <span className="nav-item future" title="Available in a future web release">Notifications</span>
        <span className="nav-item future" title="Available in a future web release">Calls</span>
        <span className="nav-item future" title="Available in a future web release">Contacts</span>
      </nav>
      <span
        className={`presence-dot ${connected ? "online" : ""}`}
        aria-label={connected ? "iPhone connected" : "iPhone disconnected"}
      />
    </header>
  );
}

function RouteStatusBar({
  daemonConnected,
  bluetoothAvailable,
  phoneConnected,
  version,
}: {
  daemonConnected: boolean;
  bluetoothAvailable: boolean;
  phoneConnected: boolean;
  version?: string;
}) {
  return (
    <footer className="route-status-bar">
      <RouteStatus icon="◉" label="tetherd" status={daemonConnected ? "connected" : "offline"} active={daemonConnected} />
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
