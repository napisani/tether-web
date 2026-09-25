import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactsView } from "./ContactsView";
import type { useContacts } from "./useContacts";

type Contacts = ReturnType<typeof useContacts>;

function model(partial: Partial<Contacts["state"]> = {}): Contacts {
  return { state: {
    contacts: [{ name: "Áda", addresses: ["tel:+15550102", "email:ada@example.com"] },
      { name: "Grace", addresses: ["tel:+15550103"] }],
    loaded: true, loading: false, pbapOpen: true, reason: "", error: "", ...partial,
  }, refresh: vi.fn(), handleEvent: vi.fn(), handleDisconnect: vi.fn() };
}

describe("Contacts view", () => {
  it("filters accents, shows grouped addresses and hands daemon keys to Messages", () => {
    const onMessage = vi.fn();
    render(<ContactsView contacts={model()} daemonConnected available onMessage={onMessage} onOpenDevices={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search contacts" }), { target: { value: "ada@example" } });
    expect(screen.getByText("Áda")).toBeInTheDocument();
    expect(screen.queryByText("Grace")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Áda"));
    expect(screen.getByText("+15550102")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Message +15550102" }));
    expect(onMessage).toHaveBeenCalledWith("tel:+15550102", "Áda");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search contacts" }), { target: { value: "no match" } });
    expect(screen.getByText("No contacts match your search.")).toBeInTheDocument();
  });

  it("copies display text rather than a namespaced key, and reports clipboard failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ContactsView contacts={model()} daemonConnected available onMessage={vi.fn()} onOpenDevices={vi.fn()} />);
    fireEvent.click(screen.getByText("Áda"));
    fireEvent.click(screen.getByRole("button", { name: "Copy +15550102" }));
    expect(writeText).toHaveBeenCalledWith("+15550102");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not copy"));
  });

  it("reports when the Clipboard API is missing instead of throwing", () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });

    try {
      render(<ContactsView contacts={model()} daemonConnected available onMessage={vi.fn()} onOpenDevices={vi.fn()} />);
      fireEvent.click(screen.getByText("Áda"));
      fireEvent.click(screen.getByRole("button", { name: "Copy +15550102" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Could not copy this address");
    } finally {
      if (previous) Object.defineProperty(navigator, "clipboard", previous);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("distinguishes unavailable, disconnected, missing PBAP and empty results", () => {
    const onOpenDevices = vi.fn();

    const { rerender } = render(<ContactsView contacts={model()} daemonConnected={false} available
      onMessage={vi.fn()} onOpenDevices={onOpenDevices} />);

    expect(screen.getByText("Reconnect to tetherd to load contacts.")).toBeInTheDocument();

    rerender(<ContactsView contacts={model()} daemonConnected available={false} onMessage={vi.fn()} onOpenDevices={onOpenDevices} />);
    expect(screen.getByText(/does not advertise Contacts/)).toBeInTheDocument();
    rerender(<ContactsView contacts={model({ pbapOpen: false, reason: "The iPhone denied access." })}
      daemonConnected available onMessage={vi.fn()} onOpenDevices={onOpenDevices} />);
    expect(screen.getByText("The iPhone denied access.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View device connection" }));
    expect(onOpenDevices).toHaveBeenCalled();
    rerender(<ContactsView contacts={model({ contacts: [] })} daemonConnected available onMessage={vi.fn()} onOpenDevices={onOpenDevices} />);
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument();
  });
});
