import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BluetoothStatusEvent } from "../../protocol";
import { SettingsView } from "./SettingsView";
import type { useSettings } from "./useSettings";

const status: BluetoothStatusEvent = {
  command: "bt_status",
  available: true,
  enabled: true,
  device_address: "AA:BB",
  ancs_enabled: true,
  ancs_content_enabled: true,
  calls_enabled: false,
  retention: "encrypted",
  retention_ready: true,
};

type Settings = ReturnType<typeof useSettings>;

function model(partial: Partial<Settings["state"]> = {}): Settings {
  return {
    state: { status, pending: null, error: "", ...partial },
    refresh: vi.fn<Settings["refresh"]>(),
    handleEvent: vi.fn<Settings["handleEvent"]>(),
    handleDisconnect: vi.fn<Settings["handleDisconnect"]>(),
    toggle: vi.fn<Settings["toggle"]>(),
    setRetention: vi.fn<Settings["setRetention"]>(),
    resolveUncertain: vi.fn<Settings["resolveUncertain"]>(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Settings view", () => {
  it("sends host controls without confusing host and browser features", () => {
    const settings = model();

    render(<SettingsView settings={settings} daemonConnected onOpenDevices={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: /Mirror iPhone notifications/ }));
    expect(settings.toggle).toHaveBeenCalledWith("ancs_enabled", false);
    fireEvent.click(screen.getByRole("switch", { name: /Call control over Bluetooth/ }));
    expect(settings.toggle).toHaveBeenCalledWith("calls_enabled", true);
    expect(screen.getByText(/have no browser equivalent/)).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /desktop popups/i })).not.toBeInTheDocument();
  });

  it("confirms irreversible deletion and warns about plaintext before requesting retention", () => {
    const settings = model();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);

    render(<SettingsView settings={settings} daemonConnected onOpenDevices={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Keep message history" }), {
      target: { value: "none" },
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("permanently deletes"));
    expect(settings.setRetention).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Keep message history" }), {
      target: { value: "none" },
    });
    expect(settings.setRetention).toHaveBeenCalledWith("none");
    fireEvent.change(screen.getByRole("combobox", { name: "Keep message history" }), {
      target: { value: "plaintext" },
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("readable files"));
  });

  it("shows host keyring guidance and prevents ANCS-content toggles when mirroring is off", () => {
    const settings = model({ status: { ...status, retention_ready: false, ancs_enabled: false } });

    render(<SettingsView settings={settings} daemonConnected onOpenDevices={() => {}} />);
    expect(screen.getByText(/no desktop keyring key/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Include notification text/ })).toBeDisabled();
  });

  it("honors Settings capability negotiation and GTK's legacy enabled default", () => {
    const settings = model({ status: { ...status, enabled: undefined } });

    const { rerender } = render(
      <SettingsView
        settings={settings}
        daemonConnected
        available={false}
        onOpenDevices={() => {}}
      />,
    );

    expect(screen.getByText(/does not advertise Settings support/)).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /Mirror iPhone notifications/ }),
    ).not.toBeInTheDocument();
    rerender(
      <SettingsView
        settings={settings}
        daemonConnected
        available={false}
        checking
        onOpenDevices={() => {}}
      />,
    );
    expect(screen.getByText(/Checking tetherd Settings support/)).toBeInTheDocument();
    rerender(
      <SettingsView settings={settings} daemonConnected available onOpenDevices={() => {}} />,
    );
    expect(screen.getByRole("switch", { name: /Mirror iPhone notifications/ })).toBeEnabled();
  });

  it("gates host actions when offline or unbonded, with an explicit recovery path", () => {
    const onOpenDevices = vi.fn<() => void>();

    const { rerender } = render(
      <SettingsView
        settings={model({ status: null })}
        daemonConnected={false}
        onOpenDevices={onOpenDevices}
      />,
    );

    expect(screen.getByText("Reconnect to tetherd to change host settings.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /Mirror iPhone notifications/ })).toBeDisabled();
    rerender(
      <SettingsView
        settings={model({ status: { ...status, device_address: "" } })}
        daemonConnected
        onOpenDevices={onOpenDevices}
      />,
    );
    expect(screen.getByText(/No iPhone is bonded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View device connection" }));
    expect(onOpenDevices).toHaveBeenCalled();
    rerender(
      <SettingsView
        settings={model({
          pending: { setting: "retention", expected: "none", phase: "uncertain" },
          error: "Check host",
        })}
        daemonConnected
        onOpenDevices={onOpenDevices}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Check host");
    expect(screen.getByRole("combobox", { name: "Keep message history" })).toBeDisabled();
  });
});
