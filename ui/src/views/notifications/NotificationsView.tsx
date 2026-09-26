import type { PhoneNotification } from "../../protocol";
import type { useNotifications } from "./useNotifications";
import "./NotificationsView.css";

type Notifications = ReturnType<typeof useNotifications>;

function notificationTime(timestamp?: number) {
  if (!timestamp || timestamp <= 0) return "";
  const date = new Date(timestamp * 1000);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NotificationRow({
  notification,
  notifications,
}: {
  notification: PhoneNotification;
  notifications: Notifications;
}) {
  const app = notification.app_name || notification.app_id || "iPhone app";
  const primary = notification.title || notification.body || "New notification";

  const secondary = [
    notification.subtitle,
    notification.body !== primary ? notification.body : "",
  ].filter(Boolean);

  const pending = notifications.state.pending[notification.uid];
  const stamp = notificationTime(notification.timestamp);

  return (
    <li className="notification-row">
      <article aria-label={`${app}: ${primary}`}>
        <div className="notification-source">
          <span className="notification-source-mark" aria-hidden="true">
            {app.charAt(0).toUpperCase()}
          </span>
          <strong>{app}</strong>
          {stamp && (
            <time dateTime={new Date((notification.timestamp ?? 0) * 1000).toISOString()}>
              {stamp}
            </time>
          )}
        </div>
        <div className="notification-content">
          <div>
            <p className="notification-title">{primary}</p>
            {secondary.map((text, index) => (
              <p className="notification-secondary" key={`${index}:${text}`}>
                {text}
              </p>
            ))}
          </div>
          {notification.negative_action && (
            <button
              type="button"
              disabled={Boolean(pending) || !notifications.state.ready}
              aria-label={`Dismiss ${app} notification on iPhone`}
              onClick={() => notifications.dismiss(notification.uid)}
            >
              {pending === "waiting"
                ? "Dismissing…"
                : pending === "uncertain"
                  ? "Check iPhone"
                  : pending === "accepted"
                    ? "Request sent"
                    : "Dismiss"}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

export function NotificationsView({
  notifications,
  daemonConnected,
  available,
  onOpenDevices,
}: {
  notifications: Notifications;
  daemonConnected: boolean;
  available: boolean;
  onOpenDevices: () => void;
}) {
  const { state } = notifications;

  return (
    <main className="notifications-view quiet-scrollbar">
      <div className="notifications-inner">
        <header className="notifications-header">
          <div>
            <h1>Notifications</h1>
            <p>Mirrored from your iPhone</p>
          </div>
          {available && (
            <button type="button" onClick={notifications.refresh} disabled={!daemonConnected}>
              Refresh
            </button>
          )}
        </header>
        {!available ? (
          <p className="notifications-empty" role="status">
            This version of tetherd does not advertise Notifications support.
          </p>
        ) : (
          <>
            {!daemonConnected && (
              <p className="notifications-guidance" role="status">
                The Tether daemon is not running.
              </p>
            )}
            {daemonConnected && !state.ready && (
              <div className="notifications-guidance" role="status">
                <p>{state.reason}</p>
                <p>
                  If iPhone permission is missing, check its Bluetooth settings or{" "}
                  <button type="button" onClick={onOpenDevices}>
                    open Devices
                  </button>{" "}
                  to request the permission prompt.
                </p>
              </div>
            )}
            {state.error && (
              <p className="notifications-error" role="alert">
                {state.error}
              </p>
            )}
            {state.loaded && state.items.length > 0 ? (
              <ul className="notifications-list" aria-label="iPhone notifications">
                {state.items.map((item) => (
                  <NotificationRow
                    key={item.uid}
                    notification={item}
                    notifications={notifications}
                  />
                ))}
              </ul>
            ) : (
              <p className="notifications-empty" role="status">
                {!daemonConnected
                  ? "Reconnect to tetherd to load notifications."
                  : !state.loaded
                    ? state.error
                      ? "Unable to load notifications."
                      : "Loading notifications…"
                    : state.ready
                      ? "No notifications yet."
                      : "No notifications to show."}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
