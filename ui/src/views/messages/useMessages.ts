import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { ContactSuggestion, DaemonEvent, MessageThread, TextMessage } from "../../protocol";

const sendTimeoutMs = 60_000;

export type MessagesState = {
  threads: MessageThread[];
  threadsKnown: boolean;
  selected: string;
  composing: boolean;
  recipient: string;
  contacts: ContactSuggestion[];
  search: string;
  messages: TextMessage[];
  loadedThread: string;
  drafts: Record<string, string>;
  mapOpen: boolean;
  connectionReason: string;
  permissionOffer: boolean;
  sending: boolean;
  error: string;
};

const initialState: MessagesState = {
  threads: [],
  threadsKnown: false,
  selected: "",
  composing: false,
  recipient: "",
  contacts: [],
  search: "",
  messages: [],
  loadedThread: "",
  drafts: {},
  mapOpen: false,
  connectionReason: "Messages are not connected.",
  permissionOffer: false,
  sending: false,
  error: "",
};

type PendingSend = { id: string; thread: string; body: string };

function recipientKey(input: string): string {
  const value = input.trim();

  if (!value) return "";

  // The daemon validates the actual address. This only selects its documented
  // tel:/email: command namespace, without duplicating recipient policy.
  return `${value.includes("@") ? "email" : "tel"}:${value}`;
}

export function useMessages(visible: boolean) {
  const [state, setState] = useState<MessagesState>(initialState);
  const current = useRef(state);
  const visibleRef = useRef(visible);

  useLayoutEffect(() => {
    current.current = state;
    visibleRef.current = visible;
  }, [state, visible]);
  const acceptingMessages = useRef(false);
  const pending = useRef<PendingSend | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const markedRead = useRef(new Set<string>());
  const pendingRead = useRef(new Set<string>());
  const contactHandoff = useRef<string | null>(null);

  const change = useCallback((update: (value: MessagesState) => MessagesState) => {
    setState((previous) => {
      const next = update(previous);
      current.current = next;

      return next;
    });
  }, []);

  const refresh = useCallback(() => {
    if (!acceptingMessages.current) return;

    void sendDaemonCommand({ command: "bt_list_threads" }).catch(() => {
      change((value) => ({ ...value, error: "Could not refresh conversations." }));
    });

    if (current.current.selected) {
      void sendDaemonCommand({
        command: "bt_list_messages",
        thread: current.current.selected,
      }).catch(() => {
        change((value) => ({ ...value, error: "Could not load this conversation." }));
      });
    }
  }, [change]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const handleConnectionChanged = useCallback(
    (event: Extract<DaemonEvent, { command: "bt_connection_changed" }>) => {
      const mapOpen = event.map_open === true;
      const wasOpen = current.current.mapOpen;
      acceptingMessages.current = mapOpen;

      if (!mapOpen) {
        markedRead.current.clear();
        pendingRead.current.clear();
        contactHandoff.current = null;
      }

      change((value) => {
        const base = mapOpen
          ? value
          : {
              ...value,
              threads: [],
              threadsKnown: false,
              messages: [],
              loadedThread: "",
              contacts: [],
            };

        return {
          ...base,
          mapOpen,
          permissionOffer: event.map_error === "forbidden" || event.map_error === "no_record",
          connectionReason:
            event.profile_reason || event.link_reason || "Messages are not connected.",
        };
      });

      if (mapOpen && !wasOpen) {
        if (visibleRef.current) refresh();
        else void sendDaemonCommand({ command: "bt_list_threads" }).catch(() => {});
      }
    },
    [change, refresh],
  );

  const handleMessageRead = useCallback(
    (event: Extract<DaemonEvent, { command: "bt_message_read" }>) => {
      const ownHandles = event.handles.filter((handle) => pendingRead.current.has(handle));

      ownHandles.forEach((handle) => pendingRead.current.delete(handle));

      if ((!event.success || event.message) && ownHandles.length) {
        ownHandles.forEach((handle) => markedRead.current.delete(handle));
        change((value) => ({
          ...value,
          error: event.message || "Could not mark messages as read.",
        }));
      }

      // A read by GTK or another browser must also update the app-wide badge.
      if (acceptingMessages.current && (visibleRef.current || event.success)) {
        void sendDaemonCommand({ command: "bt_list_threads" }).catch(() => {});
      }
    },
    [change],
  );

  const handleEvent = useCallback(
    (event: DaemonEvent) => {
      switch (event.command) {
        case "gateway_status":
          // GTK primes its tray count on subscribe even when Messages is hidden.
          if (event.daemon_connected && acceptingMessages.current && !visibleRef.current) {
            void sendDaemonCommand({ command: "bt_list_threads" }).catch(() => {});
          }

          break;
        case "bt_threads": {
          if (!acceptingMessages.current) break;

          const handoff = contactHandoff.current;
          const found = handoff !== null && event.threads.some((item) => item.thread === handoff);

          contactHandoff.current = null;
          change((value) => ({
            ...value,
            threads: event.threads,
            threadsKnown: true,
            composing: found && value.selected === handoff ? false : value.composing,
            recipient: found && value.selected === handoff ? "" : value.recipient,
          }));
          break;
        }

        case "bt_messages":
          if (!acceptingMessages.current || event.thread !== current.current.selected) break;
          change((value) => ({ ...value, messages: event.messages, loadedThread: event.thread }));
          break;
        case "bt_contacts":
          if (!acceptingMessages.current || event.query !== current.current.recipient) break;
          change((value) => ({ ...value, contacts: event.contacts }));
          break;
        case "bt_connection_changed":
          handleConnectionChanged(event);
          break;

        case "bt_message":
          if (!acceptingMessages.current) break;

          void sendDaemonCommand({ command: "bt_list_threads" }).catch(() => {});

          if (visibleRef.current && event.thread === current.current.selected) {
            void sendDaemonCommand({ command: "bt_list_messages", thread: event.thread }).catch(
              () => {},
            );
          }

          break;
        case "bt_message_read":
          handleMessageRead(event);
          break;

        case "bt_send_result": {
          const active = pending.current;

          if (!active || event.operation_id !== active.id || event.thread !== active.thread) break;
          pending.current = null;
          window.clearTimeout(timer.current);
          timer.current = undefined;
          change((value) => {
            const drafts = { ...value.drafts };

            const stillViewingSend =
              value.selected === active.thread ||
              (value.composing && recipientKey(value.recipient) === active.thread);

            if (event.success && drafts[active.thread] === active.body)
              delete drafts[active.thread];

            return {
              ...value,
              drafts,
              sending: false,
              composing: event.success && stillViewingSend ? false : value.composing,
              selected: event.success && stillViewingSend ? active.thread : value.selected,
              error: event.success ? "" : event.message || "The message was not sent.",
            };
          });

          if (event.success) refresh();
          break;
        }
      }
    },
    [change, refresh, handleConnectionChanged, handleMessageRead],
  );

  const handleDisconnect = useCallback(() => {
    acceptingMessages.current = false;
    markedRead.current.clear();
    pendingRead.current.clear();
    contactHandoff.current = null;

    if (pending.current) {
      pending.current = null;
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }

    change((value) => ({
      ...value,
      threads: [],
      threadsKnown: false,
      messages: [],
      loadedThread: "",
      contacts: [],
      mapOpen: false,
      permissionOffer: false,
      sending: false,
      error: value.sending
        ? "Connection lost; that message may still have been sent. " +
          "Check your phone before retrying."
        : value.error,
    }));
  }, [change]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (state.loadedThread !== state.selected || !state.mapOpen) return;

    const unread = state.messages.filter(
      (message) =>
        !message.outgoing &&
        !message.read &&
        message.handle &&
        !markedRead.current.has(message.handle),
    );

    if (!unread.length) return;
    const handles = unread.map((message) => message.handle);
    handles.forEach((handle) => {
      markedRead.current.add(handle);
      pendingRead.current.add(handle);
    });
    void sendDaemonCommand({ command: "bt_mark_read", handles, read: true }).catch(() => {
      const outstanding = handles.filter((handle) => pendingRead.current.has(handle));

      if (!outstanding.length) return;

      outstanding.forEach((handle) => {
        markedRead.current.delete(handle);
        pendingRead.current.delete(handle);
      });
      change((value) => ({ ...value, error: "Could not request read status." }));
    });
  }, [change, state.loadedThread, state.messages, state.mapOpen, state.selected]);

  const loadThread = (thread: string, composing: boolean, recipient: string) => {
    change((value) => ({
      ...value,
      selected: thread,
      composing,
      recipient,
      contacts: [],
      messages: [],
      loadedThread: "",
      error: "",
    }));

    if (thread)
      void sendDaemonCommand({ command: "bt_list_messages", thread }).catch(() => {
        change((value) => ({ ...value, error: "Could not load this conversation." }));
      });
  };

  const selectThread = (thread: string) => {
    contactHandoff.current = null;
    loadThread(thread, false, "");
  };

  const openThread = (thread: string, name: string) => {
    const existing = current.current.threads.some((item) => item.thread === thread);

    contactHandoff.current = current.current.threadsKnown ? null : thread;
    loadThread(thread, !existing, existing ? "" : name);

    if (!current.current.threadsKnown && acceptingMessages.current)
      void sendDaemonCommand({ command: "bt_list_threads" }).catch(() => {
        if (contactHandoff.current === thread) {
          contactHandoff.current = null;
          change((value) => ({ ...value, error: "Could not check existing conversations." }));
        }
      });
  };

  const setSearch = (search: string) => change((value) => ({ ...value, search }));

  const solicitPermissions = () => {
    void sendDaemonCommand({ command: "bt_solicit" }).catch(() => {
      change((value) => ({ ...value, error: "Could not ask the iPhone to show its permissions." }));
    });
  };

  const startCompose = () => {
    contactHandoff.current = null;
    change((value) => ({
      ...value,
      selected: "",
      composing: true,
      recipient: "",
      contacts: [],
      messages: [],
      loadedThread: "",
      error: "",
    }));
  };

  const setRecipient = (recipient: string) => {
    contactHandoff.current = null;
    change((value) => ({
      ...value,
      recipient,
      contacts: [],
      selected: "",
      messages: [],
      loadedThread: "",
    }));

    if (recipient.trim()) {
      void sendDaemonCommand({ command: "bt_list_contacts", query: recipient, limit: 20 }).catch(
        () => {},
      );
    }
  };

  const chooseRecipient = (thread: string, label: string) => {
    contactHandoff.current = null;
    change((value) => ({
      ...value,
      recipient: label,
      contacts: [],
      selected: thread,
      messages: [],
      loadedThread: "",
    }));
    void sendDaemonCommand({ command: "bt_list_messages", thread }).catch(() => {});
  };

  const setDraft = (body: string) => {
    const thread =
      current.current.selected ||
      (current.current.composing ? recipientKey(current.current.recipient) : "");

    if (!thread) return;
    change((value) => ({ ...value, drafts: { ...value.drafts, [thread]: body }, error: "" }));
  };

  const send = () => {
    const value = current.current;
    const thread = value.selected || (value.composing ? recipientKey(value.recipient) : "");
    const body = value.drafts[thread] || "";

    if (!value.mapOpen || !thread || !body.trim() || pending.current) return;
    const selected = value.threads.find((item) => item.thread === thread);

    if (selected?.repliable === false) return;

    const id = crypto.randomUUID();
    pending.current = { id, thread, body };
    change((previous) => ({ ...previous, sending: true, error: "" }));
    timer.current = window.setTimeout(() => {
      if (pending.current?.id !== id) return;
      pending.current = null;
      change((previous) => ({
        ...previous,
        sending: false,
        error:
          "No answer about that message; it may still have been sent. " +
          "Check your phone before retrying.",
      }));
    }, sendTimeoutMs);
    void sendDaemonCommand({ command: "bt_send_message", thread, body, operation_id: id }).catch(
      () => {
        // HTTP only confirms a socket write, not delivery. A failed or timed-out
        // write can have reached tetherd, so preserve the draft and await the ID.
        if (pending.current?.id === id)
          change((previous) => ({
            ...previous,
            error:
              "Could not confirm the send request. Wait for a result or " +
              "check your phone before retrying.",
          }));
      },
    );
  };

  const selectedThread = state.selected || (state.composing ? recipientKey(state.recipient) : "");
  const draft = state.drafts[selectedThread] || "";
  const selected = state.threads.find((thread) => thread.thread === selectedThread);

  const canSend =
    state.mapOpen && Boolean(selectedThread) && selected?.repliable !== false && !state.sending;

  return {
    state,
    selectedThread,
    draft,
    canSend,
    selectThread,
    openThread,
    setSearch,
    startCompose,
    setRecipient,
    chooseRecipient,
    setDraft,
    send,
    solicitPermissions,
    handleEvent,
    handleDisconnect,
    refresh,
  };
}
