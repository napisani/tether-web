import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessages } from "./useMessages";

const thread = "tel:+15550102";

const id = "11111111-1111-4111-8111-111111111111";

function commands() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(id);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Messages lifecycle", () => {
  it("does not accept retained thread data before MAP readiness", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.handleEvent({ command: "gateway_status", daemon_connected: true }));
    expect(commands()).not.toContainEqual({ command: "bt_list_threads" });
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [
      { thread, name: "Private previous phone", preview: "Private preview", unread: 2 },
    ] }));
    expect(result.current.state.threads).toEqual([]);
    expect(result.current.state.threadsKnown).toBe(false);
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    expect(commands()).toContainEqual({ command: "bt_list_threads" });
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, name: "Current phone" }] }));
    expect(result.current.state.threads[0].name).toBe("Current phone");
  });

  it("requests visible threads, loads the selected conversation and marks unread handles once", async () => {
    const { result } = renderHook(() => useMessages(true));
    expect(commands()).not.toContainEqual({ command: "bt_list_threads" });
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    expect(commands()).toContainEqual({ command: "bt_list_threads" });
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, name: "Ada", unread: 1 }] }));
    act(() => result.current.selectThread(thread));
    expect(commands()).toContainEqual({ command: "bt_list_messages", thread });
    const message = { handle: "message-1", thread, body: "Hi", timestamp: 1, outgoing: false, read: false };
    act(() => result.current.handleEvent({ command: "bt_messages", thread, messages: [message] }));
    await waitFor(() => expect(commands()).toContainEqual({ command: "bt_mark_read", handles: ["message-1"], read: true }));
    act(() => result.current.handleEvent({ command: "bt_messages", thread, messages: [message] }));
    expect(commands().filter((command) => command.command === "bt_mark_read")).toHaveLength(1);
    act(() => result.current.handleEvent({ command: "bt_message_read", handles: ["another-tab"], read: true, success: false }));
    expect(result.current.state.error).toBe("");
    act(() => result.current.handleEvent({ command: "bt_message_read", handles: ["message-1"], read: true,
      success: false, message: "MAP denied read" }));
    expect(result.current.state.error).toBe("MAP denied read");
    act(() => result.current.handleEvent({ command: "bt_messages", thread, messages: [message] }));
    await waitFor(() => expect(commands().filter((command) => command.command === "bt_mark_read")).toHaveLength(2));
    act(() => result.current.handleEvent({ command: "bt_message_read", handles: ["message-1"], read: true,
      success: true, message: "One of the reads failed" }));
    expect(result.current.state.error).toBe("One of the reads failed");
  });

  it("ignores stale conversations and preserves a draft across selections", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.selectThread(thread));
    act(() => result.current.setDraft("Not finished"));
    act(() => result.current.selectThread("email:other@example.com"));
    act(() => result.current.handleEvent({ command: "bt_messages", thread, messages: [{
      handle: "stale", thread, body: "Old", timestamp: 1, outgoing: false, read: true,
    }] }));
    expect(result.current.state.messages).toHaveLength(0);
    act(() => result.current.selectThread(thread));
    expect(result.current.draft).toBe("Not finished");
  });

  it("resolves an existing contact thread when Messages has never been opened", () => {
    const { result } = renderHook(() => useMessages(false));

    act(() => result.current.openThread(thread, "Ada"));
    expect(commands()).not.toContainEqual({ command: "bt_list_threads" });
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, name: "Previous phone" }] }));
    expect(result.current.state).toMatchObject({ selected: thread, composing: true });
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    expect(commands()).toContainEqual({ command: "bt_list_threads" });
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, name: "Ada" }] }));
    expect(result.current.state).toMatchObject({ selected: thread, composing: false });
    expect(result.current.state.recipient).toBe("");
  });

  it("opens existing and new contact addresses without losing namespaced thread keys", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, name: "Ada" }] }));
    act(() => result.current.openThread(thread, "Ada"));
    expect(result.current.state).toMatchObject({ selected: thread, composing: false });
    act(() => result.current.openThread("email:grace@example.com", "Grace"));
    expect(result.current.state).toMatchObject({ selected: "email:grace@example.com", recipient: "Grace", composing: true });
    expect(commands()).toContainEqual({ command: "bt_list_messages", thread: "email:grace@example.com" });
  });

  it("only an owned result clears its draft, and a failure keeps text for retry", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    act(() => result.current.selectThread(thread));
    act(() => result.current.setDraft("On my way"));
    act(() => result.current.send());
    expect(commands()).toContainEqual({ command: "bt_send_message", thread, body: "On my way", operation_id: id });
    act(() => result.current.handleEvent({ command: "bt_send_result", thread, operation_id: "another-tab", success: true }));
    expect(result.current.state.sending).toBe(true);
    act(() => result.current.handleEvent({ command: "bt_send_result", thread, operation_id: id, success: false, message: "Not connected" }));
    expect(result.current).toMatchObject({ draft: "On my way", state: { sending: false, error: "Not connected" } });
    act(() => result.current.send());
    act(() => result.current.handleEvent({ command: "bt_send_result", thread, operation_id: id, success: true }));
    expect(result.current.draft).toBe("");
  });

  it("does not jump back to an earlier conversation when its send finishes", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    act(() => result.current.selectThread(thread));
    act(() => result.current.setDraft("Earlier message"));
    act(() => result.current.send());
    act(() => result.current.selectThread("email:other@example.com"));
    act(() => result.current.setDraft("Current draft"));
    act(() => result.current.handleEvent({ command: "bt_send_result", thread, operation_id: id, success: true }));

    expect(result.current.state.selected).toBe("email:other@example.com");
    expect(result.current.draft).toBe("Current draft");
    expect(result.current.state.drafts[thread]).toBeUndefined();
  });

  it("clears host conversation content on disconnect without losing a browser draft", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, name: "Ada", preview: "private", unread: 1 }] }));
    act(() => result.current.selectThread(thread));
    act(() => result.current.handleEvent({ command: "bt_messages", thread, messages: [
      { handle: "msg-1", thread, body: "private", timestamp: 1, outgoing: false, read: true },
    ] }));
    act(() => result.current.setDraft("Still editing"));
    act(() => result.current.handleDisconnect());
    expect(result.current.state).toMatchObject({ threads: [], threadsKnown: false, messages: [], loadedThread: "", mapOpen: false });
    expect(result.current.draft).toBe("Still editing");
  });

  it("drops the previous phone's messages when MAP closes", () => {
    const { result } = renderHook(() => useMessages(false));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, preview: "private" }] }));
    act(() => result.current.selectThread(thread));
    act(() => result.current.handleEvent({ command: "bt_messages", thread, messages: [
      { handle: "msg-1", thread, body: "private", timestamp: 1, outgoing: false, read: true },
    ] }));
    act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: false, profile_reason: "Disconnected" }));
    expect(result.current.state).toMatchObject({ threads: [], threadsKnown: false, messages: [], loadedThread: "", mapOpen: false });
    expect(result.current.state.connectionReason).toBe("Disconnected");
    act(() => result.current.handleEvent({ command: "bt_threads", threads: [{ thread, preview: "late reply" }] }));
    expect(result.current.state.threads).toEqual([]);
  });

  it("keeps an uncertain draft after timeout and after disconnect", () => {
    vi.useFakeTimers();

    try {
      const { result } = renderHook(() => useMessages(false));
      act(() => result.current.handleEvent({ command: "bt_connection_changed", map_open: true }));
      act(() => result.current.selectThread(thread));
      act(() => result.current.setDraft("Do not lose this"));
      act(() => result.current.send());
      act(() => vi.advanceTimersByTime(60_000));
      expect(result.current).toMatchObject({ draft: "Do not lose this", state: { sending: false } });
      expect(result.current.state.error).toContain("may still have been sent");
      act(() => result.current.send());
      act(() => result.current.handleDisconnect());
      expect(result.current).toMatchObject({ draft: "Do not lose this", state: { mapOpen: false, sending: false } });
      act(() => result.current.handleEvent({ command: "bt_send_result", thread, operation_id: id, success: true }));
      expect(result.current.draft).toBe("Do not lose this");
    } finally {
      vi.useRealTimers();
    }
  });
});
