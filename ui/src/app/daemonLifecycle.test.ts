import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DaemonEvent } from "../protocol";
import { useDaemonLifecycle } from "./daemonLifecycle";
import type { AppAction } from "./appState";

function setup() {
  const order: string[] = [];

  const feature = (name: string) => ({
    handleEvent: vi.fn<(event: DaemonEvent) => void>((_event) => {
      order.push(`${name}:event`);
    }),
    handleDisconnect: vi.fn<() => void>(() => {
      order.push(`${name}:disconnect`);
    }),
  });

  const features = {
    fileTransfer: feature("files"),
    messages: feature("messages"),
    contacts: feature("contacts"),
    settings: feature("settings"),
    browserNotifications: feature("browserAlerts"),
    notifications: feature("notifications"),
    calls: feature("calls"),
  };

  const dispatch = vi.fn<(action: AppAction) => void>((action) => {
    order.push(`app:${action.type}`);
  });

  const onResetCapabilities = vi.fn<() => void>(() => {
    order.push("capabilities:reset");
  });

  const onProtocolInfo = vi.fn<() => void>(() => {
    order.push("protocol:known");
  });

  const onBluetoothStatus = vi.fn<(enabled: boolean) => void>();

  const { result } = renderHook(() =>
    useDaemonLifecycle({
      features,
      dispatch,
      onResetCapabilities,
      onProtocolInfo,
      onBluetoothStatus,
    }),
  );

  return { result, order, features, dispatch, onResetCapabilities, onBluetoothStatus };
}

describe("daemon lifecycle", () => {
  it("delivers live events to every feature before reducing app state", () => {
    const { result, order } = setup();
    act(() => result.current.onEvent({ command: "protocol_info", version: 1, capabilities: [] }));
    expect(order).toEqual([
      "protocol:known",
      "files:event",
      "messages:event",
      "contacts:event",
      "settings:event",
      "browserAlerts:event",
      "notifications:event",
      "calls:event",
      "app:daemon-event",
    ]);
  });

  it("runs all disconnect cleanup once for either offline signal, including file staging", () => {
    const { result, features, dispatch, onResetCapabilities, order } = setup();
    act(() => result.current.onEvent({ command: "gateway_status", daemon_connected: true }));
    order.length = 0;
    act(() => result.current.onEvent({ command: "gateway_status", daemon_connected: false }));
    expect(features.fileTransfer.handleDisconnect).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "capabilities:reset",
      "files:disconnect",
      "messages:disconnect",
      "contacts:disconnect",
      "settings:disconnect",
      "browserAlerts:disconnect",
      "notifications:disconnect",
      "calls:disconnect",
      "app:daemon-event",
    ]);
    act(() => result.current.onConnectionChange(false));
    expect(features.fileTransfer.handleDisconnect).toHaveBeenCalledTimes(1);
    expect(onResetCapabilities).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenLastCalledWith({ type: "daemon-connected", connected: false });
  });

  it("also cleans up a stream error and permits the next session to disconnect", () => {
    const { result, features } = setup();
    act(() => result.current.onEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => result.current.onConnectionChange(false));
    expect(features.fileTransfer.handleDisconnect).toHaveBeenCalledTimes(1);
    act(() => result.current.onEvent({ command: "gateway_status", daemon_connected: true }));
    act(() => result.current.onEvent({ command: "gateway_status", daemon_connected: false }));
    expect(features.fileTransfer.handleDisconnect).toHaveBeenCalledTimes(2);
  });

  it("refreshes the call capability when the host status changes", () => {
    const { result, onBluetoothStatus } = setup();
    act(() =>
      result.current.onEvent({ command: "bt_status", available: true, calls_enabled: true }),
    );
    expect(onBluetoothStatus).toHaveBeenCalledWith(true);
  });
});
