import type { useBrowserNotifications } from "../../app/useBrowserNotifications";

type BrowserNotifications = ReturnType<typeof useBrowserNotifications>;

export function BrowserNotificationsSection({ alerts }: { alerts: BrowserNotifications }) {
  const { enabled, permission, error } = alerts.state;
  const unavailable = permission === "unsupported" || permission === "denied";

  return <section className="settings-group" aria-labelledby="settings-browser-notifications">
    <h2 id="settings-browser-notifications">Browser notifications</h2>
    <p>Optional alerts on this browser when Tether is hidden. No iPhone message, sender, or app text is shown in the system notification.</p>
    <label className="settings-row"><span><strong>Notify when a new iPhone alert arrives</strong>
      <small>This preference stays in this browser, not on the tetherd host.</small></span>
      <span className="settings-switch-hit"><input id="browser-alerts" type="checkbox" role="switch" aria-checked={enabled}
        checked={enabled} disabled={unavailable}
        onChange={(event) => { if (event.target.checked) void alerts.enable(); else alerts.disable(); }} /></span>
    </label>
    {permission === "unsupported" && <p className="settings-warning">Use a secure origin in a browser with Notification support.</p>}
    {permission === "denied" && <p className="settings-warning">Allow notifications for this origin in your browser settings.</p>}
    {error && <p className="settings-error" role="alert">{error}</p>}
  </section>;
}
