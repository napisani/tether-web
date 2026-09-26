import { useState, type ReactNode } from "react";
import type { ContactSuggestion } from "../../protocol";
import type { useContacts } from "./useContacts";
import "./ContactsView.css";

type Contacts = ReturnType<typeof useContacts>;

function displayAddress(key: string): string {
  return key.replace(/^(?:tel|email):/, "");
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function ContactCard({
  contact,
  onMessage,
  onCopy,
}: {
  contact: ContactSuggestion;
  onMessage: (address: string, name: string) => void;
  onCopy: (address: string) => void;
}) {
  const name = contact.name || displayAddress(contact.addresses[0] || "Unknown contact");

  return (
    <li>
      <details className="contact-card">
        <summary>
          <strong>{name}</strong>
          <span>
            {contact.addresses.length} {contact.addresses.length === 1 ? "address" : "addresses"}
          </span>
        </summary>
        <ul aria-label={`Addresses for ${name}`}>
          {contact.addresses.map((key) => {
            const address = displayAddress(key);

            return (
              <li key={key} className="contact-address">
                <span className="contact-address-type">
                  {key.startsWith("tel:") ? "Phone" : "Email"}
                </span>
                <span className="contact-address-value">{address}</span>
                <button
                  type="button"
                  onClick={() => onCopy(address)}
                  aria-label={`Copy ${address}`}
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => onMessage(key, name)}
                  aria-label={`Message ${address}`}
                >
                  Message
                </button>
              </li>
            );
          })}
        </ul>
      </details>
    </li>
  );
}

export function ContactsView({
  contacts,
  daemonConnected,
  available,
  onMessage,
  onOpenDevices,
}: {
  contacts: Contacts;
  daemonConnected: boolean;
  available: boolean;
  onMessage: (address: string, name: string) => void;
  onOpenDevices: () => void;
}) {
  const [search, setSearch] = useState("");
  const [copyError, setCopyError] = useState("");
  const { state } = contacts;
  const query = fold(search.trim());

  const results = state.contacts.filter((contact) =>
    fold(`${contact.name} ${contact.addresses.map(displayAddress).join(" ")}`).includes(query),
  );

  const copy = (address: string) => {
    const reportFailure = () =>
      setCopyError("Could not copy this address. Select the text instead.");

    try {
      if (!navigator.clipboard?.writeText) {
        reportFailure();

        return;
      }

      void navigator.clipboard
        .writeText(address)
        .then(() => setCopyError(""))
        .catch(reportFailure);
    } catch {
      reportFailure();
    }
  };

  let content: ReactNode;

  if (!daemonConnected) {
    content = (
      <p role="status" className="contacts-guidance">
        Reconnect to tetherd to load contacts.
      </p>
    );
  } else if (!available) {
    content = (
      <p role="status" className="contacts-guidance">
        This version of tetherd does not advertise Contacts support.
      </p>
    );
  } else if (!state.pbapOpen) {
    content = (
      <div className="contacts-guidance" role="status">
        <p>{state.reason}</p>
        <button type="button" onClick={onOpenDevices}>
          View device connection
        </button>
      </div>
    );
  } else {
    let list: ReactNode;

    if (!state.loaded) {
      list = (
        <p role="status" className="contacts-empty">
          {state.loading ? "Loading contacts…" : "Refresh to load contacts."}
        </p>
      );
    } else if (results.length === 0) {
      list = (
        <p role="status" className="contacts-empty">
          {query
            ? "No contacts match your search."
            : "No contacts yet. Check the Bluetooth link on the Devices page."}
        </p>
      );
    } else {
      list = (
        <ul className="contacts-list" aria-label="iPhone contacts">
          {results.map((contact, index) => (
            <ContactCard
              key={`${contact.name}:${contact.addresses.join("|")}:${index}`}
              contact={contact}
              onMessage={onMessage}
              onCopy={copy}
            />
          ))}
        </ul>
      );
    }

    content = (
      <>
        <label className="contacts-search">
          Search contacts
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, phone, or email"
          />
        </label>
        {state.error && (
          <p role="alert" className="contacts-error">
            {state.error}
          </p>
        )}
        {copyError && (
          <p role="alert" className="contacts-error">
            {copyError}
          </p>
        )}
        {list}
      </>
    );
  }

  return (
    <main className="contacts-view quiet-scrollbar">
      <div className="contacts-inner">
        <header className="contacts-header">
          <div>
            <h1>Contacts</h1>
            <p>Your iPhone address book</p>
          </div>
          <button
            type="button"
            onClick={contacts.refresh}
            disabled={!daemonConnected || !available || !state.pbapOpen || state.loading}
          >
            Refresh
          </button>
        </header>
        {content}
      </div>
    </main>
  );
}
