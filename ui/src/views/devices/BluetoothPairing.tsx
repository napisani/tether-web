import type { PairingState } from "./devicesState";
import { ModalDialog } from "./ModalDialog";

export function PairingProgress({ pairing, onReset }: { pairing: PairingState; onReset: () => void }) {
  const busy = pairing.phase === "pairing" || pairing.phase === "confirming";
  return (
    <div className={`pairing-progress ${pairing.phase}`} aria-live="polite">
      <span className={busy ? "spinner" : "progress-symbol"} aria-hidden="true">
        {!busy && (pairing.phase === "complete" ? "✓" : "!")}
      </span>
      <div>
        <strong>{pairingTitle(pairing)}</strong>
        <p>{pairing.message || pairing.detail}</p>
      </div>
      {!busy ? <button type="button" className="text-button" onClick={onReset}>Dismiss</button> : null}
    </div>
  );
}

export function PairingCodeDialog({ code, onAnswer }: { code: string; onAnswer: (accept: boolean) => void }) {
  return (
    <ModalDialog labelledBy="pairing-dialog-title" onCancel={() => onAnswer(false)}>
      <span className="eyebrow">Security check</span>
      <h2 id="pairing-dialog-title">Does your iPhone show this code?</h2>
      <div className="code-display" aria-label={`Pairing code ${code}`}>
        {code.split("").map((digit, index) => <span key={`${index}-${digit}`}>{digit}</span>)}
      </div>
      <p>Only continue when every digit matches. A different code means this is not the same pairing request.</p>
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={() => onAnswer(false)}>Cancel pairing</button>
        <button className="primary-button" type="button" onClick={() => onAnswer(true)}>Codes match</button>
      </div>
    </ModalDialog>
  );
}

export function ConfirmForgetDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalDialog labelledBy="forget-dialog-title" onCancel={onCancel}>
      <span className="eyebrow">Remove Bluetooth bond</span>
      <h2 id="forget-dialog-title">Forget {name}?</h2>
      <p>Also remove this computer from the iPhone’s Bluetooth settings before pairing again. Otherwise the phone can keep the old bond.</p>
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={onCancel}>Keep iPhone</button>
        <button className="secondary-button danger" type="button" onClick={onConfirm}>Forget iPhone</button>
      </div>
    </ModalDialog>
  );
}

function pairingTitle(pairing: PairingState): string {
  if (pairing.kind === "unpair") {
    if (pairing.phase === "complete") return "iPhone forgotten";
    if (pairing.phase === "error") return "Could not forget iPhone";
    return "Removing pairing";
  }
  if (pairing.phase === "complete") return "Pairing complete";
  if (pairing.phase === "error") return "Pairing did not complete";
  if (pairing.phase === "confirming") return "Waiting for confirmation";
  return "Pairing in progress";
}
