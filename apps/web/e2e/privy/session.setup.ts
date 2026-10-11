import { expect, test as setup } from "@playwright/test";
import { session, signIn } from "./session";

setup(
  "the Privy test account signs in once for the tests that share its session",
  async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/sign-in");
    await signIn(page);
    await expect(page).toHaveURL("/app", { timeout: 30_000 });
    await context.storageState({ path: session });
    await context.close();
  },
);
