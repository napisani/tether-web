export function Welcome({
  onScan,
  scanning,
  pairingAvailable,
}: {
  onScan: () => void;
  scanning: boolean;
  pairingAvailable: boolean;
}) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true">
        <span>ᛒ</span>
      </div>
      <span className="eyebrow">Bluetooth pairing</span>
      <h2>Connect your iPhone</h2>
      <p>
        {pairingAvailable
          ? "Unlock your iPhone, open Settings → Bluetooth, then scan from Tether. " +
            "Your phone stays in control of the final confirmation."
          : "This version of tetherd does not advertise browser pairing controls."}
      </p>
      {pairingAvailable ? (
        <button className="primary-button" type="button" onClick={onScan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan for iPhone"}
        </button>
      ) : null}
    </div>
  );
}

export function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="notice warning">
      <span aria-hidden="true">!</span>
      <div>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
  );
}
