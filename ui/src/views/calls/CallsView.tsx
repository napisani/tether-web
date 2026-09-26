import type { PhoneCall } from "../../protocol";
import type { useCalls } from "./useCalls";
import "./CallsView.css";

type Calls = ReturnType<typeof useCalls>;

const callStates = new Map([
  ["incoming", "Incoming"],
  ["waiting", "Call waiting"],
  ["dialing", "Dialing"],
  ["alerting", "Ringing"],
  ["active", "On call"],
  ["held", "On hold"],
  ["disconnected", "Ended"],
]);

function callStateLabel(state: string) {
  return callStates.get(state) || state;
}

function networkStatus(status: Calls["state"]["status"]) {
  if (!status?.indicators) return null;
  const parts = [status.operator || ""];

  if (!status.service) parts.push("No service");
  else parts.push(`Signal ${Math.max(0, Math.min(5, Math.round(status.signal ?? 0)))} of 5`);

  if (status.roaming) parts.push("roaming");

  if (status.battery && status.battery > 0)
    parts.push(`iPhone battery ${Math.min(5, status.battery) * 20}%`);

  return parts.filter(Boolean).join(" · ");
}

function CallRow({ call, calls }: { call: PhoneCall; calls: Calls }) {
  const label = call.withheld ? "Withheld number" : call.name || call.number || "Unknown caller";
  const state = callStateLabel(call.state || "");

  const pendingCall = Object.values(calls.state.pending).some(
    (attempt) => attempt.path === call.path,
  );

  return (
    <li className="call-row">
      <article aria-label={`${label}${state ? `, ${state}` : ""}`}>
        <div className="call-identity">
          <span className="call-symbol" aria-hidden="true">
            {call.ringing ? "↙" : call.outgoing ? "↗" : "☎"}
          </span>
          <div>
            <strong>{label}</strong>
            <p>
              {state}
              {call.name && call.number && !call.withheld ? ` · ${call.number}` : ""}
            </p>
          </div>
        </div>
        <div className="call-actions">
          {call.ringing && call.path && (
            <button
              className="call-primary"
              type="button"
              disabled={pendingCall}
              onClick={() => calls.sendAction("answer", call.path)}
              aria-label={`Answer call from ${label}`}
            >
              Answer
            </button>
          )}
          {call.state !== "disconnected" && call.path && (
            <button
              className="call-danger"
              type="button"
              disabled={pendingCall}
              onClick={() => calls.sendAction("hangup", call.path)}
              aria-label={`${call.ringing ? "Decline" : "Hang up"} call with ${label}`}
            >
              {call.ringing ? "Decline" : "Hang up"}
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

function CallControls({ calls, ready }: { calls: Calls; ready: boolean }) {
  const { state } = calls;
  const network = networkStatus(state.status);
  const audio = state.status?.audio || "";
  const inCall = state.calls.some((call) => call.connected && call.state !== "disconnected");
  const dialPending = state.pending.dial;

  return (
    <>
      <form
        className="calls-dial"
        onSubmit={(event) => {
          event.preventDefault();
          calls.sendAction("dial");
        }}
      >
        <label htmlFor="call-number">Number to call</label>
        <div>
          <input
            id="call-number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={64}
            value={state.number}
            onChange={(event) => calls.setNumber(event.target.value)}
            disabled={!ready}
            placeholder="Number to call"
          />
          <button
            className="call-primary"
            type="submit"
            disabled={!ready || !state.number.trim() || Boolean(dialPending)}
          >
            {dialPending ? "Check iPhone" : "Call"}
          </button>
        </div>
      </form>
      {network && (
        <p className="calls-network" aria-label={`iPhone cellular status: ${network}`}>
          {network}
        </p>
      )}
      {inCall && audio && (
        <div className="calls-audio">
          <p>Audio plays on the iPhone or the tetherd host, not in this browser.</p>
          {audio === "active" ? (
            <button
              type="button"
              disabled={Boolean(state.pending.audio_phone)}
              onClick={() => calls.sendAction("audio_phone")}
            >
              Audio on iPhone
            </button>
          ) : (
            <button
              type="button"
              disabled={Boolean(state.pending.audio_here)}
              onClick={() => calls.sendAction("audio_here")}
            >
              Audio on tetherd host
            </button>
          )}
        </div>
      )}
    </>
  );
}

export function CallsView({
  calls,
  daemonConnected,
  available,
  enabled,
  capabilityError,
  onRetryCapability,
}: {
  calls: Calls;
  daemonConnected: boolean;
  available: boolean;
  enabled?: boolean;
  capabilityError: boolean;
  onRetryCapability: () => void;
}) {
  const { state } = calls;
  const ready = daemonConnected && available && state.status?.available === true;

  return (
    <main className="calls-view quiet-scrollbar">
      <div className="calls-inner">
        <header className="calls-header">
          <div>
            <h1>Calls</h1>
            <p>Control calls on your iPhone</p>
          </div>
          {available && (
            <button type="button" onClick={calls.refresh} disabled={!daemonConnected}>
              Refresh
            </button>
          )}
        </header>
        {daemonConnected && capabilityError && (
          <div className="calls-error" role="alert">
            Could not refresh Calls availability.{" "}
            <button type="button" onClick={onRetryCapability}>
              Retry availability
            </button>
          </div>
        )}
        {!daemonConnected ? (
          <p className="calls-guidance" role="status">
            Reconnect to tetherd to load calls.
          </p>
        ) : !available ? (
          <p className="calls-guidance" role="status">
            {enabled === false
              ? "Call control is off. Enable it on the tetherd host " +
                "with tether --bt-calls-enable on."
              : enabled
                ? "Call control is enabled, but Bluetooth is unavailable on the tetherd host."
                : "This version of tetherd does not advertise Calls support."}
          </p>
        ) : (
          <>
            {!ready && (
              <p className="calls-guidance" role="status">
                {state.status?.reason || "Waiting for the iPhone's Hands-Free service."}
              </p>
            )}
            {state.error && (
              <p className="calls-error" role="alert">
                {state.error}
              </p>
            )}
            {Object.values(state.pending).some((attempt) => attempt.status === "uncertain") && (
              <button className="calls-retry" type="button" onClick={calls.resolveUncertain}>
                I checked my iPhone — enable retry
              </button>
            )}
            <CallControls calls={calls} ready={ready} />
            {state.loaded && state.calls.length > 0 ? (
              <ul className="calls-list" aria-label="iPhone calls">
                {state.calls.map((call) => (
                  <CallRow key={call.path} call={call} calls={calls} />
                ))}
              </ul>
            ) : (
              <p className="calls-empty" role="status">
                {!ready ? "No calls to show." : state.loaded ? "No calls." : "Loading calls…"}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
