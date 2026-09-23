import { describe, expect, it } from "vitest";
import type { DaemonEvent } from "../../protocol";
import { initialDevicesState, reduceDevicesEvent, reduceDevicesState } from "./devicesState";

function apply(events: DaemonEvent[]) {
  return events.reduce(reduceDevicesEvent, initialDevicesState);
}

describe("reduceDevicesEvent", () => {
  it("retains discovered phones after BlueZ removes the transient object", () => {
    const state = apply([
      {
        command: "bt_devices",
        devices: [
          {
            address: "40:F6:64:3D:7A:F1",
            name: "40-F6-64-3D-7A-F1",
            apple_nearby: true,
            iphone: false,
            bonded: false,
          },
        ],
      },
      {
        command: "bt_scan_result",
        success: true,
        message: "Bluetooth scan finished.",
      },
      { command: "bt_devices", devices: [] },
    ]);

    expect(state.devices).toHaveLength(1);
    expect(state.scanMessage).toBe("Bluetooth scan finished.");
  });

  it("ignores pairing messages for another browser operation", () => {
    const pairingState = {
      ...initialDevicesState,
      pairing: {
        operationId: "web-current",
        phase: "pairing" as const,
        detail: "Starting pairing.",
      },
    };

    const next = reduceDevicesEvent(pairingState, {
      command: "bt_pair_result",
      operation_id: "web-stale",
      success: false,
      status: "error",
      message: "Stale failure",
    });

    expect(next.pairing.detail).toBe("Starting pairing.");
  });

  it("clears in-flight work when the daemon disconnects", () => {
    const disconnected = reduceDevicesState(
      {
        ...initialDevicesState,
        scanning: true,
        pairing: {
          phase: "confirming",
          operationId: "web-current",
          code: "042731",
        },
      },
      { type: "daemon-disconnected" },
    );

    expect(disconnected.scanning).toBe(false);
    expect(disconnected.scanMessage).toBe("Bluetooth scan stopped while Tether reconnects.");
    expect(disconnected.pairing).toMatchObject({
      phase: "error",
      operationId: "web-current",
      message: "Connection to tetherd was lost. Try again after it reconnects.",
    });
    expect(disconnected.pairing.code).toBeUndefined();
  });

  it("keeps completed pairing state when the daemon disconnects", () => {
    const disconnected = reduceDevicesState(
      {
        ...initialDevicesState,
        pairing: { phase: "complete", operationId: "web-current", message: "Paired." },
      },
      { type: "daemon-disconnected" },
    );

    expect(disconnected.pairing).toMatchObject({ phase: "complete", message: "Paired." });
  });

  it("keeps the pairing result when the transient candidate disappears", () => {
    const pairedState = reduceDevicesEvent(
      {
        ...initialDevicesState,
        pairing: {
          operationId: "web-current",
          phase: "pairing" as const,
          detail: "Starting pairing.",
        },
      },
      {
        command: "bt_pair_result",
        operation_id: "web-current",
        success: true,
        status: "paired",
        message: "Paired with someone’s iPhone.",
      },
    );

    const withoutCandidate = reduceDevicesEvent(pairedState, {
      command: "bt_devices",
      devices: [],
    });

    expect(withoutCandidate.pairing.phase).toBe("complete");
    expect(withoutCandidate.pairing.message).toBe("Paired with someone’s iPhone.");
  });
});
