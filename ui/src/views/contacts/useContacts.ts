import { useCallback, useEffect, useRef, useState } from "react";
import { sendDaemonCommand } from "../../daemon/DaemonClient";
import type { ContactSuggestion, DaemonEvent } from "../../protocol";

const contactLimit = 5_000; // Match GTK's bounded address-book request.

const refreshTimeoutMs = 12_000;

export interface ContactsState {
  contacts: ContactSuggestion[];
  loaded: boolean;
  loading: boolean;
  pbapOpen: boolean;
  reason: string;
  error: string;
}

const initialState: ContactsState = {
  contacts: [], loaded: false, loading: false, pbapOpen: false,
  reason: "Connect your iPhone to load contacts.", error: "",
};

export function useContacts(visible: boolean) {
  const [state, setState] = useState<ContactsState>(initialState);
  const online = useRef(false);
  const pbapOpen = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const timer = useRef<number | undefined>(undefined);
  const refreshGeneration = useRef(0);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const refresh = useCallback(() => {
    if (!online.current || !pbapOpen.current) return;

    const generation = ++refreshGeneration.current;

    clearTimer();
    setState((value) => ({ ...value, loading: true, error: "" }));
    timer.current = window.setTimeout(() => {
      if (generation !== refreshGeneration.current) return;

      timer.current = undefined;
      setState((value) => ({ ...value, loading: false, error: "Contacts did not respond. Try refreshing." }));
    }, refreshTimeoutMs);
    void sendDaemonCommand({ command: "bt_list_contacts", query: "", limit: contactLimit }).catch(() => {
      // A failed HTTP request might still reach tetherd; a later list remains authoritative.
      if (generation !== refreshGeneration.current || !online.current || !pbapOpen.current) return;

      clearTimer();
      setState((value) => ({ ...value, loading: false, error: "Could not request contacts. Try refreshing." }));
    });
  }, [clearTimer]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const handleDisconnect = useCallback(() => {
    online.current = false;
    pbapOpen.current = false;
    refreshGeneration.current++;
    clearTimer();
    setState(initialState); // Never retain address-book contents after the daemon disconnects.
  }, [clearTimer]);

  const handleEvent = useCallback((event: DaemonEvent) => {
    switch (event.command) {
      case "gateway_status":
        if (!event.daemon_connected) handleDisconnect();
        else {
          const wasOnline = online.current;

          online.current = true;

          if (!wasOnline && visibleRef.current && pbapOpen.current) refresh();
        }

        break;
      case "bt_connection_changed": {
        const ready = event.pbap_open === true;
        const wasReady = pbapOpen.current;

        pbapOpen.current = ready;

        if (!ready) {
          refreshGeneration.current++;
          clearTimer();
          setState({ ...initialState, reason: event.pbap_error || event.profile_reason || event.link_reason || initialState.reason });
        } else {
          setState((value) => ({ ...value, pbapOpen: true, reason: "" }));

          if (!wasReady && online.current && visibleRef.current) refresh();
        }

        break;
      }

      case "bt_contacts":
        // Compose suggestions use the same event with a nonempty query. A stale
        // response must not repopulate contacts after a link loss.
        if (event.query !== "" || !online.current || !pbapOpen.current || !visibleRef.current) break;

        clearTimer();
        setState((value) => ({ ...value, contacts: event.contacts, loaded: true, loading: false, error: "" }));
        break;
    }
  }, [clearTimer, handleDisconnect, refresh]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { state, refresh, handleEvent, handleDisconnect };
}
