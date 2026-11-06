import { expect, type Page, test } from "@playwright/test";
import { blockingViolations } from "./axe";
import { freshCode, session } from "./session";

// R-217: a passkey added through Chrome's virtual authenticator, then removed, on the shared test account. A stale
// session confirms it's you in place first (Q-13), with Forwend's code from the suite's fake Resend.
async function confirmIfAsked(where: ReturnType<Page["getByRole"]>) {
  const confirm = where.getByRole("group", { name: "Confirm it's you" });
  const code = confirm.getByRole("textbox", { name: "Code" });
  if (
    await confirm.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await expect(confirm).toContainText("Didn't get it?", { timeout: 20_000 });
    await code.fill(await freshCode());
  }
}

test("a passkey is added in Account and security, listed with where it was made, and removed", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: session });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto("/app/settings");
  const methods = page.getByRole("region", { name: "Sign-in methods" });
  const remove = methods.getByRole("button", { name: /^Remove / });
  const add = methods.getByRole("button", { name: "Add a passkey" });
  // The account has loaded once Add shows: only then does the count of passkeys mean anything.
  await expect(add).toBeVisible({ timeout: 30_000 });
  const before = await remove.count();

  await add.click();
  await confirmIfAsked(page.getByRole("main"));
  await expect(page.getByText("Passkey added")).toBeVisible({ timeout: 30_000 });
  await expect(remove).toHaveCount(before + 1, { timeout: 30_000 });
  await expect(methods.getByText(/Added .* · Last used /).first()).toBeVisible();
  expect(await blockingViolations(page)).toEqual([]);

  // The newest is first; removing it asks in a dialog, and Keep it leaves it.
  await remove.first().click();
  const dialog = page.getByRole("dialog", { name: "Remove this passkey?" });
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  await expect(remove).toHaveCount(before + 1);
  await remove.first().click();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await confirmIfAsked(dialog);
  await expect(remove).toHaveCount(before, { timeout: 30_000 });
  await expect(page.getByText("Passkey removed")).toBeVisible();
  await context.close();
});
