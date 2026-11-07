// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RollAfterRemoval } from "@/features/team/components/roll-after-removal";

// jsdom lacks the modal methods; this is what the browser does that matters here.
const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
if (typeof proto.showModal !== "function") {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(cleanup);

// D-93: after removing an Admin, the owner sees every key and webhook secret that still works for them.
it("lists what the removed member could still use and sends the owner to roll it", () => {
  const onClose = vi.fn();
  const toRoll = {
    keys: [{ keyId: "11111111-1111-4111-8111-111111111111", name: "Server", last4: "ab12" }],
    webhooks: [
      {
        endpointId: "22222222-2222-4222-8222-222222222222",
        url: "https://shop.example.com/hooks?t=x",
      },
    ],
  };
  render(<RollAfterRemoval roll={{ who: "bob@example.com", toRoll }} onClose={onClose} />);
  const dialog = screen.getByRole("dialog");
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.textContent).toContain("ab12");
  // The host alone: a webhook URL's path or query may hold the receiver's own token.
  expect(dialog.textContent).toContain("shop.example.com");
  expect(dialog.textContent).not.toContain("t=x");
});
