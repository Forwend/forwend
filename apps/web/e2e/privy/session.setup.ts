import { expect, test as setup } from "@playwright/test";
import { session, signIn } from "./session";

setup(
  "the Privy test account signs in once for the tests that share its session",
  async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/sign-in");
    const me = page.waitForRequest((request) => request.url().endsWith("/api/v1/me"));
    await signIn(page);
    await expect(page).toHaveURL("/app", { timeout: 30_000 });
    // The tests pay on test networks, so every profile the account owns starts them in Developer mode.
    const { authorization = "" } = await (await me).allHeaders();
    expect(authorization).toMatch(/^Bearer /);
    const headers = { authorization };
    const { profiles } = (await (await page.request.get("/api/v1/me", { headers })).json()) as {
      profiles: { profileId: string; role: string; livemode: boolean }[];
    };
    for (const profile of profiles.filter((p) => p.role === "owner" && p.livemode)) {
      const saved = await page.request.put(`/api/v1/profiles/${profile.profileId}/mode`, {
        headers,
        data: { livemode: false },
      });
      expect(saved.ok()).toBe(true);
    }
    await context.storageState({ path: session });
    await context.close();
  },
);
