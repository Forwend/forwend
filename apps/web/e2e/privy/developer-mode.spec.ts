import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { mockApi, OWNER } from "./sample-api";
import { session } from "./session";

// R-221, D-120: the API answers are mocked; the Go API tests cover the real ones.
const SHOP = "22222222-2222-2222-2222-222222222222";

test.use({ storageState: session });

async function mockMode(page: Page) {
  const state = { livemode: false, saved: [] as boolean[] };
  await mockApi(page);
  // Added after mockApi, so these answer first: /v1/me reads the mode the PUT saved.
  await page.route("/api/v1/me", (route) =>
    route.fulfill({
      json: {
        onboardedAt: "2026-09-02T00:00:00Z",
        profiles: [
          {
            profileId: SHOP,
            kind: "merchant",
            name: "Sample shop",
            walletAddress: `0x${"7a21".repeat(10)}`,
            createdAt: "2026-09-02T00:00:00Z",
            ...OWNER,
            livemode: state.livemode,
          },
        ],
      },
    }),
  );
  await page.route(`/api/v1/profiles/${SHOP}/mode`, async (route) => {
    state.livemode = route.request().postDataJSON().livemode;
    state.saved.push(state.livemode);
    await route.fulfill({ json: { livemode: state.livemode } });
  });
  return state;
}

test("the owner turns Developer mode off and on, and the strip under the header follows", async ({
  page,
}) => {
  const state = await mockMode(page);

  await page.goto("/app/developer-mode");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Developer mode" })).toBeVisible({
    timeout: 30_000,
  });
  const strip = page.getByText("Developer mode: test networks only. Tokens here have no value.");
  const toggle = main.getByRole("switch", { name: "Developer mode" });
  await expect(strip).toBeVisible();
  await expect(toggle).toBeChecked();
  expect(await blockingViolations(page)).toEqual([]);
  await page.screenshot({ path: "../../docs/runs/f438-developer-mode-on-1440.png" });

  await toggle.click();
  await expect(page.getByText("Developer mode off: live networks")).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(strip).toBeHidden();
  await expect(main).toContainText("Off: live networks.");
  await page.screenshot({ path: "../../docs/runs/f438-developer-mode-off-1440.png" });

  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(strip).toBeVisible();
  expect(state.saved).toEqual([true, false]);
});

test("an invoice link of the other mode offers to switch mode", async ({ page }) => {
  const state = await mockMode(page);
  const missing = `0x${"9".repeat(64)}`;
  await page.route(`/api/v1/profiles/${SHOP}/invoices/${missing}*`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "invoice_not_found", message: "not found" } },
    }),
  );
  await page.goto(`/app/invoices/${missing}`);
  const main = page.getByRole("main");
  await expect(main.getByText("No invoice has this link.")).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText("A live one shows only with Developer mode off.")).toBeVisible();
  await main.getByRole("button", { name: "Turn off Developer mode" }).click();
  await expect(main.getByRole("button", { name: "Turn on Developer mode" })).toBeVisible();
  expect(state.saved).toEqual([true]);
});
