import { useEffect, useRef, type ReactNode } from "react";
import "./AppShell.css";

export type AppRoute = "devices" | "messages" | "notifications" | "calls" | "contacts" | "settings";

export function AppShell({
  children,
  route,
  onNavigate,
  daemonConnected,
  bluetoothAvailable,
  wifiConnected,
  wifiAvailable,
  phoneConnected,
  unreadCount,
  showCalls,
  version,
}: {
  children: ReactNode;
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  daemonConnected: boolean;
  bluetoothAvailable: boolean;
  wifiConnected: boolean;
  wifiAvailable: boolean;
  phoneConnected: boolean;
  unreadCount: number;
  showCalls: boolean;
  version?: string;
}) {
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = shell.current;

    if (!root) return;

    const timers = new Map<HTMLElement, number>();

    const onScroll = (event: Event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement) || !target.classList.contains("quiet-scrollbar")) return;

      window.clearTimeout(timers.get(target));
      target.dataset.scrolling = "true";
      timers.set(target, window.setTimeout(() => {
        delete target.dataset.scrolling;
        timers.delete(target);
      }, 900));
    };

    // Scroll events do not bubble. Capture them once at the shell instead of
    // adding independent timers to every feature's scroll pane.
    root.addEventListener("scroll", onScroll, true);

    return () => {
      root.removeEventListener("scroll", onScroll, true);

      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={`app-shell ${route === "messages" ? "messages-route" : ""}`} ref={shell}>
      <AppHeader connected={phoneConnected || wifiConnected} route={route} onNavigate={onNavigate}
        unreadCount={unreadCount} showCalls={showCalls} />
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

function AppHeader({ connected, route, onNavigate, unreadCount, showCalls }: {
  connected: boolean;
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  unreadCount: number;
  showCalls: boolean;
}) {
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [route]);

  const connectionLabel = connected ? "Device connected" : "No device connected";

  return (
    <header className="app-header">
      <div className="brand" aria-label="Tether">
        <span className="brand-mark" aria-hidden="true">T</span>
        <span>Tether</span>
      </div>
      <nav className="primary-nav" aria-label="Primary navigation" ref={nav}>
        <button type="button" className={`nav-item ${route === "devices" ? "active" : ""}`}
          aria-current={route === "devices" ? "page" : undefined} onClick={() => onNavigate("devices")}>Devices</button>
        <button type="button" className={`nav-item ${route === "messages" ? "active" : ""}`}
          aria-current={route === "messages" ? "page" : undefined}
          aria-describedby={unreadCount > 0 ? "messages-nav-unread" : undefined}
          onClick={() => onNavigate("messages")}>Messages
          {unreadCount > 0 && <span className="nav-unread" aria-hidden="true">{unreadCount}</span>}
        </button>
        {unreadCount > 0 && <span id="messages-nav-unread" className="sr-only">{unreadCount} unread messages</span>}
        <button type="button" className={`nav-item ${route === "notifications" ? "active" : ""}`}
          aria-current={route === "notifications" ? "page" : undefined} onClick={() => onNavigate("notifications")}>Notifications</button>
        <button type="button" className={`nav-item ${route === "contacts" ? "active" : ""}`}
          aria-current={route === "contacts" ? "page" : undefined} onClick={() => onNavigate("contacts")}>Contacts</button>
        {showCalls && <button type="button" className={`nav-item ${route === "calls" ? "active" : ""}`}
          aria-current={route === "calls" ? "page" : undefined} onClick={() => onNavigate("calls")}>Calls</button>}
        <button type="button" className={`nav-item ${route === "settings" ? "active" : ""}`}
          aria-current={route === "settings" ? "page" : undefined} onClick={() => onNavigate("settings")}>Settings</button>
      </nav>
      <span
        className={`presence-dot ${connected ? "online" : ""}`}
        role="img"
        aria-label={connectionLabel}
        title={connectionLabel}
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
