// @vitest-environment jsdom
import { ToastProvider } from "@forwend/ui-web";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingDetailsForm } from "@/features/profiles/components/billing-details-form";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
}));

const NodeRequest = globalThis.Request;
vi.stubGlobal(
  "Request",
  class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
    }
  },
);
vi.stubGlobal(
  "fetch",
  vi.fn(async () =>
    Response.json(
      {
        error: {
          code: "invalid_value",
          message: "invalid profile request: name can't name Forwend",
        },
      },
      { status: 422 },
    ),
  ),
);

afterEach(cleanup);

describe("billing details form", () => {
  it("names the field the API refused and says how to fix it", async () => {
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <ToastProvider>
          <BillingDetailsForm
            profileId="6f9619ff-8b86-4011-b42d-00c04fc964ff"
            saved={{
              name: "Forwend Studio",
              address: "Main St 1\n10115 Berlin",
              country: "DE",
              taxId: null,
              email: "studio@example.com",
              updatedAt: "2026-10-10T10:00:00Z",
            }}
          />
        </ToastProvider>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));

    const name = screen.getByLabelText("Name or business name");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.body.textContent).toMatch(/can't be Forwend/);
  });
});
