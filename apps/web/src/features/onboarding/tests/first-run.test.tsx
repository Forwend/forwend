// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirstRun } from "@/features/onboarding/components/first-run";
import { useSignUpQuery } from "@/features/profiles/api/profiles-api";
import type { Profile } from "@/features/profiles/types/profile";
import { makeStore } from "@/store/store";

const link = vi.fn(async () => {});
vi.mock("@privy-io/react-auth", () => ({
  useLinkWithPasskey: () => ({ linkWithPasskey: link }),
  usePrivy: () => ({ user: null }),
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

const PERSONAL = "11111111-1111-4111-8111-111111111111";
const FREELANCER = "22222222-2222-4222-8222-222222222222";
const MERCHANT = "33333333-3333-4333-8333-333333333333";
const STORE = "44444444-4444-4444-8444-444444444444";
const profile = (profileId: string, kind: Profile["kind"], name: string | null): Profile => ({
  profileId,
  kind,
  name,
  walletAddress: `0x${"ab".repeat(20)}`,
  createdAt: "2026-11-05T10:00:00Z",
  role: "owner",
  permissions: [],
  livemode: false,
});
const PERSONAL_PROFILE = profile(PERSONAL, "personal", null);
const TOKENS = [
  {
    chainId: 84532,
    token: `0x${"01".repeat(20)}`,
    symbol: "USDC",
    decimals: 6,
    network: "Base Sepolia",
    on: true,
  },
  {
    chainId: 42431,
    token: `0x${"02".repeat(20)}`,
    symbol: "OUSD",
    decimals: 6,
    network: "Tempo Moderato",
    on: false,
  },
];

type Call = { method: string; path: string; body: unknown };
let calls: Call[];
let failBillingOnce: boolean;
// Whether a mainnet is on, so the personal profile, and the ones onboarding makes, start in live mode (D-120).
let live: boolean;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** The API as the first run uses it: onboarding makes the named profiles, the rest answer what they were sent. */
async function api(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const text = await request.text();
  const body = text ? JSON.parse(text) : null;
  calls.push({ method: request.method, path, body });
  if (path === "/api/v1/me")
    return json({ onboardedAt: null, profiles: [{ ...PERSONAL_PROFILE, livemode: live }] });
  if (path.endsWith("/tokens") && request.method === "GET") return json({ tokens: TOKENS });
  if (path.endsWith("/tokens")) {
    const off = (body as { off: { token: string }[] }).off;
    return json({
      tokens: TOKENS.map((t) => ({ ...t, on: !off.some((o) => o.token === t.token) })),
    });
  }
  if (path === "/api/v1/me/onboarding") {
    const { choices, names } = body as { choices: string[]; names: Record<string, string> };
    const made = [PERSONAL_PROFILE];
    if (choices.includes("get_paid_by_clients"))
      made.push(profile(FREELANCER, "freelancer", names.freelancer ?? null));
    if (choices.some((c) => c === "accept_business_payments" || c === "build_integration"))
      made.push(profile(MERCHANT, "merchant", names.merchant ?? null));
    return json({ onboardedAt: "2026-11-05T10:01:00Z", profiles: made }, 201);
  }
  if (path.endsWith("/billing-details")) {
    if (failBillingOnce) {
      failBillingOnce = false;
      return json({ error: { code: "unavailable", message: "try again" } }, 503);
    }
    return json({ ...(body as object), updatedAt: "2026-11-05T10:01:00Z" });
  }
  const store = {
    storeId: STORE,
    name: "North & Co.",
    defaultExpiresIn: 604800,
    allowedOrigins: [] as string[],
    brandColor: null,
    tokensOff: [],
    logoAt: null,
    updatedAt: "2026-11-05T10:01:00Z",
  };
  if (path.endsWith("/stores")) return json({ stores: [store] });
  if (path.endsWith(`/stores/${STORE}`))
    return json({ ...store, ...(body as object), brandColor: null });
  return json({ error: { code: "not_found", message: path } }, 404);
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const click = async (name: string | RegExp) => {
  fireEvent.click(screen.getByRole("button", { name }));
  await settle();
};
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function pickCountry(name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Country/ }));
  fireEvent.change(screen.getByRole("combobox", { name: /Search countries/ }), {
    target: { value: name },
  });
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
}
async function fillDetails(name: string) {
  type(/^(Name on invoices|Business name)/, name);
  type(/^Address/, "Hauptstr. 1\n10115 Berlin");
  await pickCountry("Germany");
}

/** Fed from the cached /v1/me as the app shell feeds it, which the onboarding call updates with the new profiles. */
function Live(props: {
  passkeyLinked: boolean;
  onFinish: (profile: Profile, href: string) => void;
}) {
  const me = useSignUpQuery();
  return me.currentData ? (
    <FirstRun
      profiles={me.currentData.profiles}
      email="mara@studio.example"
      passkeyLinked={props.passkeyLinked}
      onSignOut={() => {}}
      onFinish={props.onFinish}
    />
  ) : null;
}

async function mount(props: { passkeyLinked?: boolean } = {}) {
  const onFinish = vi.fn();
  render(
    <Provider store={makeStore({ getAccessToken: async () => "token" })}>
      <Live passkeyLinked={props.passkeyLinked ?? false} onFinish={onFinish} />
    </Provider>,
  );
  await settle();
  return onFinish;
}

beforeEach(() => {
  calls = [];
  failBillingOnce = false;
  live = false;
  link.mockClear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(api));
  // jsdom has no layout, and the country list scrolls its chosen option into view.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("first run (R-50)", () => {
  it("says the tokens are test money only in Developer mode (D-120)", async () => {
    live = true;
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    await click("Continue");
    await fillDetails("Mara Ilić Design");
    await click("Continue");
    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
    expect(screen.queryByText(/Test money only/)).toBeNull();
  });

  it("asks for at least one use, and counts the steps the uses need", async () => {
    await mount();
    expect(screen.getByText("Step 1 of 4")).toBeTruthy();
    await click("Continue");
    expect(screen.getByRole("alert").textContent).toBe("Pick at least one, or skip setup.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
  });

  it("names the freelancer profile, saves its details and tokens, then opens its first invoice", async () => {
    const onFinish = await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    await click("Continue");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "How should clients see you?",
    );
    expect((screen.getByLabelText(/^Contact email/) as HTMLInputElement).value).toBe(
      "mara@studio.example",
    );
    await click("Continue");
    expect(document.activeElement?.getAttribute("name")).toBe("name");
    await fillDetails("Mara Ilić Design");
    await click("Continue");
    expect(screen.getByText("Step 3 of 5")).toBeTruthy();
    expect(screen.getByText(/Test money only/)).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/onboarding"))).toBe(false);

    await click("Continue");
    expect(calls.find((c) => c.path.endsWith("/onboarding"))?.body).toEqual({
      choices: ["get_paid_by_clients"],
      names: { freelancer: "Mara Ilić Design" },
    });
    expect(
      calls.find((c) => c.path === `/api/v1/profiles/${FREELANCER}/billing-details`)?.body,
    ).toEqual({
      name: "Mara Ilić Design",
      email: "mara@studio.example",
      country: "DE",
      address: "Hauptstr. 1\n10115 Berlin",
      taxId: null,
    });
    // The new profile gets what the step showed, Tempo's OUSD off as the defaults had it.
    expect(
      calls.find((c) => c.method === "PUT" && c.path === `/api/v1/profiles/${FREELANCER}/tokens`)
        ?.body,
    ).toEqual({
      off: [{ chainId: 42431, token: TOKENS[1]?.token }],
    });

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in faster next time");
    // Back after the save reaches the saved details, and going on saves them again without making profiles.
    await click(/Back/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Where you get paid");
    await click(/Back/);
    // The uses made the profiles, so they can't change any more: no Back to them.
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    await click("Continue");
    await click("Continue");
    expect(calls.filter((c) => c.path.endsWith("/onboarding"))).toHaveLength(1);
    await click("Not now");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Your freelancer profile is ready",
    );
    await click(/Create your first invoice/);
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: FREELANCER }),
      "/app/invoices/new",
    );
    await click("Go to overview");
    expect(onFinish).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: FREELANCER }),
      "/app",
    );
  });

  it("finishes a failed save on the next try without making the profiles again", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    await click("Continue");
    await fillDetails("Mara Ilić Design");
    await click("Continue");
    failBillingOnce = true;
    await click("Continue");
    expect(screen.getByRole("alert").textContent).toBe("We could not save that. Try again.");
    await click("Continue");
    expect(calls.filter((c) => c.path.endsWith("/onboarding"))).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/billing-details"))).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in faster next time");
  });

  it("adds the developer's website to the business's first store", async () => {
    await mount({ passkeyLinked: true });
    fireEvent.click(screen.getByRole("checkbox", { name: /Build with the API/ }));
    await click("Continue");
    await fillDetails("North & Co.");
    // Each one the store API refuses, so the save after the profiles exist cannot fail on it.
    for (const refused of [
      "https://shop.example/checkout",
      "http://[::1]:3000",
      "https://-shop.example",
      "https://shop_x.example",
      "http://shop.example",
    ]) {
      type(/^Website/, refused);
      await click("Continue");
      expect(screen.getByText(/nothing after the domain/)).toBeTruthy();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "Tell customers who you are",
      );
    }
    type(/^Website/, "https://Shop.example:443/");
    await click("Continue");
    await click("Continue");
    expect(
      calls.find((c) => c.method === "PUT" && c.path.endsWith(`/stores/${STORE}`))?.body,
    ).toMatchObject({
      name: "North & Co.",
      allowedOrigins: ["https://shop.example"],
    });
    // A passkey already linked: no passkey step, straight to the end.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Your business profile is ready",
    );
    expect(screen.getByText("Step 4 of 4")).toBeTruthy();
  });

  it("skips setup with no profiles and returns to the page asked for", async () => {
    sessionStorage.setItem("forwend:onboarding:return", "/app/invoices?status=paid");
    const onFinish = await mount();
    await click("Skip setup");
    expect(calls.find((c) => c.path.endsWith("/onboarding"))?.body).toEqual({
      choices: [],
      names: {},
    });
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: PERSONAL }),
      "/app/invoices?status=paid",
    );
  });

  it("starts the business details from the freelancer's contact details", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Take payments for my business/ }));
    await click("Continue");
    type(/^Contact email/, "billing@mara.example");
    await fillDetails("Mara Ilić Design");
    await click("Continue");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Tell customers who you are",
    );
    expect((screen.getByLabelText(/^Contact email/) as HTMLInputElement).value).toBe(
      "billing@mara.example",
    );
    expect((screen.getByLabelText(/^Address/) as HTMLTextAreaElement).value).toBe(
      "Hauptstr. 1\n10115 Berlin",
    );
    expect((screen.getByLabelText(/^Business name/) as HTMLInputElement).value).toBe("");
  });

  it("skips the details and tokens: the profile is made unnamed, with no billing details and its own tokens", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    await click("Continue");
    type(/^Name on invoices/, "Half typed");
    await click("Skip for now");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Where you get paid");
    await click("Skip for now");
    expect(calls.find((c) => c.path.endsWith("/onboarding"))?.body).toEqual({
      choices: ["get_paid_by_clients"],
      names: {},
    });
    expect(calls.some((c) => c.path.endsWith("/billing-details"))).toBe(false);
    expect(calls.some((c) => c.method === "PUT" && c.path.endsWith("/tokens"))).toBe(false);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in faster next time");
    // Back to the skipped details after the save: they can still be filled in, and then they save.
    await click(/Back/);
    await click(/Back/);
    expect((screen.getByLabelText(/^Name on invoices/) as HTMLInputElement).disabled).toBe(false);
    await fillDetails("Mara Ilić Design");
    await click("Continue");
    await click("Continue");
    expect(
      calls.find((c) => c.path === `/api/v1/profiles/${FREELANCER}/billing-details`)?.body,
    ).toMatchObject({ name: "Mara Ilić Design", country: "DE" });
    expect(calls.filter((c) => c.path.endsWith("/onboarding"))).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Sign in faster next time");
  });

  it("keeps what was typed when going back", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    await click("Continue");
    type(/^Name on invoices/, "Mara");
    await click(/Back/);
    await click("Continue");
    expect((screen.getByLabelText(/^Name on invoices/) as HTMLInputElement).value).toBe("Mara");
  });
});
