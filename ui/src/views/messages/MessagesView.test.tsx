import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TetherApp } from "../../app/TetherApp";
import type { DaemonEvent } from "../../protocol";

class FakeEventSource {
  static current: FakeEventSource;
  onerror: (() => void) | null = null;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;

  constructor() { FakeEventSource.current = this; }
  close() {}
  emit(event: DaemonEvent) { this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>); }
}

const thread = "tel:+15550102";

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function connect() {
  act(() => {
    FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: true });
    FakeEventSource.current.emit({ command: "protocol_info", version: 1, capabilities: ["messages"] });
    FakeEventSource.current.emit({ command: "bt_connection_changed", map_open: true });
    FakeEventSource.current.emit({ command: "bt_threads", threads: [
      { thread, name: "Ada", preview: "See you soon", unread: 1, repliable: true },
      { thread: "group:friends", name: "Friends", preview: "Lunch?", repliable: false, reply_reason: "Group replies are unavailable." },
    ] });
  });
}

function commandNames() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

describe("Messages view", () => {
  it("navigates, searches, loads a conversation, and confirms only its own send", async () => {
    render(<TetherApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(commandNames()).toContainEqual({ command: "bt_list_threads" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search conversations" }), { target: { value: "Ada" } });
    expect(screen.queryByRole("button", { name: /Friends/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ada/ }));
    expect(commandNames()).toContainEqual({ command: "bt_list_messages", thread });
    act(() => FakeEventSource.current.emit({ command: "bt_messages", thread, messages: [
      { handle: "in-1", thread, body: "See you soon", timestamp: 1, outgoing: false, read: false },
    ] }));
    expect(screen.getByLabelText("Received: See you soon")).toBeInTheDocument();
    await waitFor(() => expect(commandNames()).toContainEqual({ command: "bt_mark_read", handles: ["in-1"], read: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "On my way" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(commandNames()).toContainEqual({ command: "bt_send_message", thread, body: "On my way", operation_id: "11111111-1111-4111-8111-111111111111" });
    act(() => FakeEventSource.current.emit({ command: "bt_send_result", thread, operation_id: "other-tab", success: true }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("On my way");
    act(() => FakeEventSource.current.emit({ command: "bt_send_result", thread, operation_id: "11111111-1111-4111-8111-111111111111", success: true }));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("");
  });

  it("uses daemon contact suggestions for a new message", async () => {
    render(<TetherApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    fireEvent.click(screen.getByRole("button", { name: "New message" }));
    fireEvent.change(screen.getByRole("textbox", { name: "To" }), { target: { value: "Ada" } });
    expect(commandNames()).toContainEqual({ command: "bt_list_contacts", query: "Ada", limit: 20 });
    act(() => FakeEventSource.current.emit({ command: "bt_contacts", query: "old", contacts: [] }));
    act(() => FakeEventSource.current.emit({ command: "bt_contacts", query: "Ada", contacts: [
      { name: "Ada", addresses: [thread] },
    ] }));
    fireEvent.click(screen.getByRole("button", { name: /Ada tel:\+15550102/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(commandNames()).toContainEqual({ command: "bt_send_message", thread, body: "Hello", operation_id: "11111111-1111-4111-8111-111111111111" });
    act(() => FakeEventSource.current.emit({ command: "bt_send_result", thread,
      operation_id: "11111111-1111-4111-8111-111111111111", success: true }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "To" })).not.toBeInTheDocument());
  });

  it("offers permission recovery only for a withheld Messages profile", () => {
    render(<TetherApp />);
    act(() => {
      FakeEventSource.current.emit({ command: "gateway_status", daemon_connected: true });
      FakeEventSource.current.emit({ command: "protocol_info", version: 1, capabilities: ["messages"] });
      FakeEventSource.current.emit({ command: "bt_connection_changed", map_open: false,
        map_error: "forbidden", profile_reason: "Enable Messages in iPhone Bluetooth settings." });
    });
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(screen.getByText("Enable Messages in iPhone Bluetooth settings.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show iPhone Permissions" }));
    expect(commandNames()).toContainEqual({ command: "bt_solicit" });
  });

  it("explains why the daemon forbids replying to a group", () => {
    render(<TetherApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    fireEvent.click(screen.getByRole("button", { name: /Friends/ }));
    expect(screen.getByText("Group replies are unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
