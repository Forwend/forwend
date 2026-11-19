// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function api(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const text = await request.text();
  const body = text ? JSON.parse(text) : null;
  calls.push({ method: request.method, path, body });
  if (path === "/api/v1/me") return json({ onboardedAt: null, profiles: [PERSONAL_PROFILE] });
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

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const step = (name: string) => screen.findByRole("heading", { level: 1, name });
const tokensShown = () => screen.findByRole("checkbox", { name: "USDC on every network" });
const sent = (path: string) => calls.filter((c) => c.path.endsWith(path));
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
  await screen.findByRole("checkbox", { name: /Invoice clients/ });
  return onFinish;
}

beforeEach(() => {
  calls = [];
  failBillingOnce = false;
  link.mockClear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(api));
  // jsdom has no layout, and the country list scrolls its chosen option into view.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("first run", () => {
  it("names the freelancer profile, saves its details and tokens, then opens its first invoice", async () => {
    const onFinish = await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    click("Continue");
    await fillDetails("Mara Ilić Design");
    click("Continue");
    await tokensShown();
    expect(sent("/onboarding")).toEqual([]);

    click("Continue");
    await step("Sign in faster next time");
    expect(sent("/onboarding")[0]?.body).toEqual({
      choices: ["get_paid_by_clients"],
      names: { freelancer: "Mara Ilić Design" },
    });
    expect(sent(`/profiles/${FREELANCER}/billing-details`)[0]?.body).toEqual({
      name: "Mara Ilić Design",
      email: "mara@studio.example",
      country: "DE",
      address: "Hauptstr. 1\n10115 Berlin",
      taxId: null,
    });
    expect(
      calls.find((c) => c.method === "PUT" && c.path === `/api/v1/profiles/${FREELANCER}/tokens`)
        ?.body,
    ).toEqual({ off: [{ chainId: 42431, token: TOKENS[1]?.token }] });

    click(/Back/);
    click(/Back/);
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();
    click("Continue");
    click("Continue");
    await waitFor(() => expect(sent(`/profiles/${FREELANCER}/billing-details`)).toHaveLength(2));
    await step("Sign in faster next time");
    expect(sent("/onboarding")).toHaveLength(1);
    click("Not now");
    click(/Create your first invoice/);
    expect(onFinish).toHaveBeenCalledWith(
      expect.objectContaining({ profileId: FREELANCER }),
      "/app/invoices/new",
    );
    click("Go to overview");
    expect(onFinish).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: FREELANCER }),
      "/app",
    );
  });

  it("finishes a failed save on the next try without making the profiles again", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    click("Continue");
    await fillDetails("Mara Ilić Design");
    click("Continue");
    await tokensShown();
    failBillingOnce = true;
    click("Continue");
    await screen.findByText("We could not save that. Try again.");
    click("Continue");
    await step("Sign in faster next time");
    expect(sent("/onboarding")).toHaveLength(1);
    expect(sent("/billing-details")).toHaveLength(2);
  });

  it("adds the developer's website to the business's first store", async () => {
    await mount({ passkeyLinked: true });
    fireEvent.click(screen.getByRole("checkbox", { name: /Build with the API/ }));
    click("Continue");
    await fillDetails("North & Co.");
    for (const refused of [
      "https://shop.example/checkout",
      "http://[::1]:3000",
      "https://-shop.example",
      "https://shop_x.example",
      "http://shop.example",
    ]) {
      type(/^Website/, refused);
      click("Continue");
      expect(screen.getByText(/nothing after the domain/)).toBeTruthy();
    }
    type(/^Website/, "https://Shop.example:443/");
    click("Continue");
    await tokensShown();
    click("Continue");
    await step("Your business profile is ready");
    expect(
      calls.find((c) => c.method === "PUT" && c.path.endsWith(`/stores/${STORE}`))?.body,
    ).toMatchObject({ name: "North & Co.", allowedOrigins: ["https://shop.example"] });
  });

  it("skips setup with no profiles and returns to the page asked for", async () => {
    sessionStorage.setItem("forwend:onboarding:return", "/app/invoices?status=paid");
    const onFinish = await mount();
    click("Skip setup");
    await waitFor(() =>
      expect(onFinish).toHaveBeenCalledWith(
        expect.objectContaining({ profileId: PERSONAL }),
        "/app/invoices?status=paid",
      ),
    );
    expect(sent("/onboarding")[0]?.body).toEqual({ choices: [], names: {} });
  });

  it("skips the details and tokens: the profile is made unnamed, with no billing details and its own tokens", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Invoice clients/ }));
    click("Continue");
    type(/^Name on invoices/, "Half typed");
    click("Skip for now");
    click("Skip for now");
    await step("Sign in faster next time");
    expect(sent("/onboarding")[0]?.body).toEqual({
      choices: ["get_paid_by_clients"],
      names: {},
    });
    expect(sent("/billing-details")).toEqual([]);
    expect(calls.some((c) => c.method === "PUT" && c.path.endsWith("/tokens"))).toBe(false);

    click(/Back/);
    click(/Back/);
    await fillDetails("Mara Ilić Design");
    click("Continue");
    await tokensShown();
    click("Continue");
    await waitFor(() => expect(sent("/billing-details")).toHaveLength(1));
    expect(sent(`/profiles/${FREELANCER}/billing-details`)[0]?.body).toMatchObject({
      name: "Mara Ilić Design",
      country: "DE",
    });
    expect(sent("/onboarding")).toHaveLength(1);
  });
});
