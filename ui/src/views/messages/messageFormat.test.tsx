import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sameLocalDay } from "./messageDates";
import { MessageText } from "./messageFormat";

describe("message formatting", () => {
  it("links web addresses without treating message text as HTML", () => {
    render(
      <MessageText
        body={"Visit https://example.com/path, then <script>alert(1)</script> or www.example.org."}
      />,
    );
    expect(screen.getByRole("link", { name: "https://example.com/path" })).toHaveAttribute(
      "href",
      "https://example.com/path",
    );
    expect(screen.getByRole("link", { name: "www.example.org" })).toHaveAttribute(
      "href",
      "http://www.example.org",
    );
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("groups messages by local calendar day", () => {
    expect(sameLocalDay(1_700_000_000, 1_700_000_100)).toBe(true);
    expect(sameLocalDay(1_700_000_000, 1_700_172_800)).toBe(false);
  });
});
