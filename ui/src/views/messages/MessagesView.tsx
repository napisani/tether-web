import { Fragment, useEffect, useRef } from "react";
import type { TextMessage } from "../../protocol";
import type { useMessages } from "./useMessages";
import { dayHeading, MessageText, sameLocalDay } from "./messageFormat";
import "./MessagesView.css";

type Messages = ReturnType<typeof useMessages>;

function messageTime(timestamp: number): string {
  return timestamp > 0 ? new Date(timestamp * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

function threadTime(timestamp?: number): string {
  if (!timestamp || timestamp <= 0) return "";
  const date = new Date(timestamp * 1000);
  const today = new Date();

  return date.toDateString() === today.toDateString()
    ? messageTime(timestamp)
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function MessageBubble({ message, showTime }: { message: TextMessage; showTime: boolean }) {
  return (
    <li className={`message-row ${message.outgoing ? "outgoing" : "incoming"}`}>
      <div className="message-bubble" aria-label={`${message.outgoing ? "Sent" : "Received"}: ${message.body}`}>
        <MessageText body={message.body} />
        {showTime && <time dateTime={message.timestamp > 0 ? new Date(message.timestamp * 1000).toISOString() : undefined}>
          {messageTime(message.timestamp)}
        </time>}
      </div>
    </li>
  );
}

function ThreadSidebar({ messages, daemonConnected }: { messages: Messages; daemonConnected: boolean }) {
  const { state } = messages;
  const search = state.search.trim().toLocaleLowerCase();

  const threads = state.threads.filter((thread) =>
    `${thread.name || ""} ${thread.address || ""} ${thread.preview || ""}`.toLocaleLowerCase().includes(search));

  return (
    <aside className="messages-sidebar" aria-label="Conversations">
      <div className="messages-sidebar-heading">
        <h1>Messages</h1>
        <button type="button" onClick={messages.startCompose} disabled={!daemonConnected}>New message</button>
      </div>
      <label className="messages-search">
        <span className="sr-only">Search conversations</span>
        <input type="search" placeholder="Search conversations" value={state.search}
          onChange={(event) => messages.setSearch(event.target.value)} />
      </label>
      {!daemonConnected && <p className="messages-empty">Reconnect to tetherd to see conversations.</p>}
      {daemonConnected && !state.mapOpen && !state.selected && !state.composing && (
        <div className="messages-sidebar-guidance">
          <p>{state.connectionReason}</p>
          {state.permissionOffer && <button type="button" onClick={messages.solicitPermissions}>Show iPhone Permissions</button>}
        </div>
      )}
      {daemonConnected && !state.threadsKnown && <p className="messages-empty">Loading conversations…</p>}
      {daemonConnected && state.threadsKnown && threads.length === 0 && (
        <p className="messages-empty">{search ? "No conversations match your search." : "No conversations yet."}</p>
      )}
      <ul className="messages-threads">
        {threads.map((thread) => (
          <li key={thread.thread}>
            <button type="button" className={state.selected === thread.thread && !state.composing ? "selected" : ""}
              aria-current={state.selected === thread.thread && !state.composing ? "true" : undefined}
              onClick={() => messages.selectThread(thread.thread)}>
              <span className="messages-thread-main">
                <strong>{thread.name || thread.address || thread.thread}</strong>
                <small>{thread.preview || "No messages"}</small>
              </span>
              <span className="messages-thread-meta">
                <time>{threadTime(thread.timestamp)}</time>
                {(thread.unread ?? 0) > 0 && <span className="messages-unread" aria-label={`${thread.unread} unread messages`}>{thread.unread}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function RecipientPicker({ messages }: { messages: Messages }) {
  const { state } = messages;

  if (!state.composing) return null;

  return (
    <div className="messages-recipient">
      <label htmlFor="message-to">To</label>
      <input id="message-to" type="text" autoComplete="off" placeholder="Phone number or email"
        value={state.recipient} onChange={(event) => messages.setRecipient(event.target.value)} />
      {state.contacts.length > 0 && !state.selected && (
        <ul aria-label="Contact suggestions">
          {state.contacts.flatMap((contact) => contact.addresses.map((address) => (
            <li key={`${contact.name}:${address}`}>
              <button type="button" onClick={() => messages.chooseRecipient(address, contact.name)}>
                {contact.name} <small>{address}</small>
              </button>
            </li>
          )))}
        </ul>
      )}
    </div>
  );
}

function MessageComposer({ messages }: { messages: Messages }) {
  return (
    <div className="messages-composer">
      <label htmlFor="message-body" className="sr-only">Message</label>
      <textarea id="message-body" value={messages.draft} disabled={!messages.canSend}
        onChange={(event) => messages.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            messages.send();
          }
        }} placeholder="Message" rows={2} />
      <button type="button" className="messages-send" disabled={!messages.canSend || !messages.draft.trim()}
        onClick={messages.send}>{messages.state.sending ? "Sending…" : "Send"}</button>
    </div>
  );
}

function ConversationHeading({ messages }: { messages: Messages }) {
  const { state } = messages;
  const selected = state.threads.find((thread) => thread.thread === messages.selectedThread);

  const title = state.composing
    ? selected?.name || state.recipient || "New message"
    : selected?.name || selected?.address || messages.selectedThread;

  return <header className="messages-conversation-header">
    <button type="button" className="messages-back" onClick={() => messages.selectThread("")} aria-label="Back to conversations">←</button>
    <h2>{title}</h2>
  </header>;
}

function Conversation({ messages, daemonConnected }: { messages: Messages; daemonConnected: boolean }) {
  const { state } = messages;
  const selected = state.threads.find((thread) => thread.thread === messages.selectedThread);
  const open = Boolean(messages.selectedThread || state.composing);
  const conversation = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const previousThread = useRef("");

  useEffect(() => {
    const changed = previousThread.current !== messages.selectedThread;
    previousThread.current = messages.selectedThread;

    if (conversation.current && (changed || pinned.current)) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [state.messages, messages.selectedThread]);

  if (!open) return <section className="messages-conversation" aria-label="Conversation">
    <div className="messages-placeholder">Select a conversation or start a new message.</div>
  </section>;

  return (
    <section className="messages-conversation" aria-label="Conversation">
      <ConversationHeading messages={messages} />
      <RecipientPicker messages={messages} />
      {!state.mapOpen && (
        <div className="messages-banner" role="status">
          <span>{!daemonConnected ? "The Tether daemon is not running." : state.connectionReason}</span>
          {daemonConnected && state.permissionOffer && <button type="button" onClick={messages.solicitPermissions}>Show iPhone Permissions</button>}
        </div>
      )}
      <ol className="messages-history" ref={conversation} onScroll={(event) => {
        const target = event.currentTarget;
        pinned.current = target.scrollHeight - target.scrollTop - target.clientHeight < 48;
      }} aria-label="Messages in conversation">
        {state.loadedThread === messages.selectedThread && state.messages.map((message, index) => {
          const previous = state.messages[index - 1];
          const newDay = message.timestamp > 0 && (!previous || !sameLocalDay(previous.timestamp, message.timestamp));
          const showTime = !previous || newDay || previous.outgoing !== message.outgoing || message.timestamp - previous.timestamp >= 300;

          return <Fragment key={message.handle || `${message.timestamp}:${index}`}>
            {newDay && <li className="messages-day">{dayHeading(message.timestamp)}</li>}
            <MessageBubble message={message} showTime={showTime} />
          </Fragment>;
        })}
      </ol>
      {state.error && <div className="messages-error" role="alert">{state.error}</div>}
      {!state.mapOpen && <p className="messages-composer-notice">Connect Messages on your iPhone before sending.</p>}
      {selected?.repliable === false && <p className="messages-composer-notice">{selected.reply_reason || "Replying to this conversation is not available."}</p>}
      <MessageComposer messages={messages} />
    </section>
  );
}

export function MessagesView({ messages, daemonConnected, available }: {
  messages: Messages;
  daemonConnected: boolean;
  available: boolean;
}) {
  if (!available) {
    return <main className="messages-view messages-unavailable"><h1>Messages</h1><p>This version of tetherd does not advertise Messages support.</p></main>;
  }

  return (
    <main className={`messages-view ${messages.selectedThread || messages.state.composing ? "conversation-open" : ""}`}>
      <ThreadSidebar messages={messages} daemonConnected={daemonConnected} />
      <Conversation messages={messages} daemonConnected={daemonConnected} />
    </main>
  );
}
