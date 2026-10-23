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

function show(request = false) {
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <ToastProvider>
        <EditInvoice
          profileId={PROFILE}
          invoiceId={ID}
          number="INV-0007"
          memo="Split in two"
          clientEmail="ap@bob.example"
          returnUrl="https://shop.example/done"
          request={request}
        />
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
      { memo: "Paid in two parts", clientEmail: "ap@bob.example", returnUrl: null },
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
      },
    ]);
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
