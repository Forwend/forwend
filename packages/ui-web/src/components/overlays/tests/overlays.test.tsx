import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../dialog";
import { Sheet } from "../sheet";

// jsdom lacks the modal methods; this is what the browser does that matters here.
const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
if (typeof proto.showModal !== "function") {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

afterEach(cleanup);

// React hands a <dialog>'s close event to every enclosing onClose, so a dialog opened from inside another, such as the
// two-step setup from the send Summary, would close the one under it too.
describe("a dialog opened inside another", () => {
  it("closes alone, leaving the sheet under it open", () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Summary">
        <Dialog triggerLabel="Set up" title="Set up two-step verification">
          <p>Scan this QR code</p>
        </Dialog>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set up" }));
    const inner = screen.getByRole("dialog", {
      name: "Set up two-step verification",
      hidden: true,
    });
    fireEvent.click(within(inner).getByRole("button", { name: "Close", hidden: true }));
    expect(inner.hasAttribute("open")).toBe(false);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes alone, leaving the dialog under it open", () => {
    const outerClosed = vi.fn();
    render(
      <Dialog triggerLabel="Export" title="Export this key?" onClose={outerClosed}>
        <Dialog triggerLabel="Set up" title="Set up two-step verification">
          <p>Scan this QR code</p>
        </Dialog>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Set up", hidden: true }));
    const inner = screen.getByRole("dialog", {
      name: "Set up two-step verification",
      hidden: true,
    });
    fireEvent.click(within(inner).getByRole("button", { name: "Close", hidden: true }));
    expect(inner.hasAttribute("open")).toBe(false);
    expect(outerClosed).not.toHaveBeenCalled();
  });
});
