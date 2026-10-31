// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditInvoice } from "@/features/invoices/components/edit-invoice";
import { makeStore } from "@/store/store";

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);

const PROFILE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const ID = `0x${"7".repeat(64)}`;

function serve(status: number, json: object) {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      bodies.push(await request.json());
      return Response.json(json, { status });
    }),
  );
  return bodies;
}

const PROPS = {
  profileId: PROFILE,
  invoiceId: ID,
  number: "INV-0007",
  memo: "Split in two",
  clientEmail: "ap@bob.example",
  returnUrl: "https://shop.example/done",
  reference: "PO-9",
  note: "Thanks",
  dueDate: "2026-11-30",
  beforePayment: true,
  closesOn: "2027-01-29",
  today: "2026-10-24",
  request: false,
};

function show(request = false, beforePayment = true) {
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <EditInvoice {...PROPS} beforePayment={beforePayment} request={request} />
      </ToastProvider>
    </Provider>,
  );
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));

afterEach(cleanup);

// R-127.
describe("Edit", () => {
  it("sends the whole set, a cleared field as null", async () => {
    const bodies = serve(500, {});
    show();
    fireEvent.change(screen.getByLabelText("Memo"), { target: { value: "  Paid in two parts " } });
    fireEvent.change(screen.getByLabelText("Return link"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(bodies).toEqual([
      {
        memo: "Paid in two parts",
        clientEmail: "ap@bob.example",
        returnUrl: null,
        reference: "PO-9",
        note: "Thanks",
        dueDate: "2026-11-30",
      },
    ]);
  });

  it("keeps a request's client email, which it doesn't show", async () => {
    const bodies = serve(500, {});
    show(true);
    expect(screen.queryByLabelText("Client email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(bodies).toEqual([
      {
        memo: "Split in two",
        clientEmail: "ap@bob.example",
        returnUrl: "https://shop.example/done",
        reference: "PO-9",
        note: "Thanks",
        dueDate: "2026-11-30",
      },
    ]);
  });

  // R-128: after money the locked fields don't show, and they go back as they are.
  it("leaves out the reference, note and due date once they are locked, and sends them as saved", async () => {
    const bodies = serve(500, {});
    show(false, false);
    expect(screen.queryByText("Before payment")).toBeNull();
    expect(screen.queryByLabelText("Reference")).toBeNull();
    expect(screen.queryByLabelText("Note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(bodies).toEqual([
      expect.objectContaining({ reference: "PO-9", note: "Thanks", dueDate: "2026-11-30" }),
    ]);
  });

  // A save closes the dialog before the new values arrive: the next edit still starts from them.
  it("starts the next edit from the due date just saved", async () => {
    const bodies = serve(500, {});
    const edit = (dueDate: string | null) => (
      <Provider store={store}>
        <ToastProvider>
          <dialog open>
            <EditInvoice {...PROPS} dueDate={dueDate} />
          </dialog>
        </ToastProvider>
      </Provider>
    );
    const store = makeStore({ getAccessToken: async () => "token" });
    const { rerender, container } = render(edit("2026-11-30"));
    fireEvent.click(screen.getByRole("button", { name: "Clear the due date" }));
    act(() => {
      container.querySelector("dialog")?.dispatchEvent(new Event("close"));
    });
    rerender(edit(null));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(bodies).toEqual([expect.objectContaining({ dueDate: null })]);
  });

  it("puts a refused value's message on its field", async () => {
    serve(422, {
      error: {
        code: "invalid_value",
        message: "invalid invoice request: client.email must be an email address",
      },
    });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await settle();
    expect(screen.getByLabelText("Client email").getAttribute("aria-invalid")).toBe("true");
  });
});
