import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = nav.current;

    if (!element) return;

    const updateEdges = () => {
      const left = element.scrollLeft > 2;
      const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
      setScrollEdges((previous) => previous.left === left && previous.right === right ? previous : { left, right });
    };

    const keepCurrentVisible = () => {
      element.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      updateEdges();
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keepCurrentVisible);
    observer?.observe(element);
    element.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", keepCurrentVisible);
    keepCurrentVisible();

    return () => {
      observer?.disconnect();
      element.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", keepCurrentVisible);
    };
  }, [route, showCalls]);

  const connectionLabel = connected ? "Device connected" : "No device connected";

  return (
    <header className="app-header">
      <div className="brand" aria-label="Tether">
        <span className="brand-mark" aria-hidden="true">T</span>
        <span>Tether</span>
      </div>
      <div className="nav-rail" data-scroll-left={scrollEdges.left} data-scroll-right={scrollEdges.right}>
        <button className="nav-scroll nav-scroll-left" type="button" aria-label="Scroll navigation left"
          hidden={!scrollEdges.left} onClick={() => nav.current?.scrollBy({ left: -220, behavior: "smooth" })}>
          <span aria-hidden="true">‹</span>
        </button>
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
        <button className="nav-scroll nav-scroll-right" type="button" aria-label="Scroll navigation right"
          hidden={!scrollEdges.right} onClick={() => nav.current?.scrollBy({ left: 220, behavior: "smooth" })}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
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
  const statuses = [
    { icon: "◉", label: "tetherd", status: daemonConnected ? "connected" : "offline", active: daemonConnected },
    { icon: "⌁", label: "Wi-Fi", status: wifiConnected ? "device connected" : wifiAvailable ? "ready" : "mDNS unavailable", active: wifiConnected },
    { icon: "ᛒ", label: "Bluetooth", status: phoneConnected ? "iPhone connected" : bluetoothAvailable ? "ready" : "unavailable", active: bluetoothAvailable },
  ];

  const summary = !daemonConnected ? "tetherd offline" : phoneConnected ? "iPhone connected"
    : wifiConnected ? "Wi-Fi device connected" : "No device connected";

  const versionLabel = version ? `Tether ${version}` : "Tether web";

  return (
    <footer className="route-status-bar">
      {statuses.map((status) => <RouteStatus key={status.label} {...status} />)}
      <span className="version">{versionLabel}</span>
      <details className="mobile-route-status">
        <summary><span className={`mobile-status-light ${daemonConnected && (phoneConnected || wifiConnected) ? "online" : ""}`} aria-hidden="true" />
          {summary}<span className="mobile-status-action">Details</span></summary>
        <div className="mobile-status-details">
          {statuses.map((status) => <RouteStatus key={status.label} {...status} />)}
          <span>{versionLabel}</span>
        </div>
      </details>
    </footer>
  );
}

function RouteStatus({ icon, label, status, active }: { icon: string; label: string; status: string; active: boolean }) {
  return <span className={`route-status ${active ? "active" : ""}`}><span aria-hidden="true">{icon}</span>{label}: {status}</span>;
}
