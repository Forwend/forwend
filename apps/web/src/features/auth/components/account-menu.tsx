"use client";

import { THEMES } from "@forwend/design-tokens";
import {
  BUTTON_VARIANTS,
  Button,
  Dialog,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  RowButton,
  useTheme,
} from "@forwend/ui-web";
import { Bell, ChevronsUpDown, Coins, LogOut, MonitorX, Moon, Settings, Users } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef } from "react";
import { useSignOutEverywhereMutation } from "@/features/auth/api/auth-api";
import { AUTH_COPY, SIGN_OUT_EVERYWHERE_COPY } from "@/features/auth/constants/auth-copy";
import { APP_ROUTES } from "@/shared/config/routes";

export interface AccountMenuProps {
  email: string;
  onSignOut: () => void;
  /** The active profile's pages its role can open: the email setting, and a merchant's team (D-93). */
  links: { notifications: boolean; team: boolean };
  trigger?: ReactNode;
  side?: "top" | "bottom" | "right";
}

export function AccountMenu({ email, onSignOut, links, trigger, side = "top" }: AccountMenuProps) {
  const [theme, setTheme] = useTheme();
  const [signOutEverywhere, { isLoading, isError, reset }] = useSignOutEverywhereMutation();
  // The dialog opens once the menu has closed and given focus back, so it keeps focus (as on Delete client).
  const chosen = useRef(false);
  const confirm = async () => {
    try {
      await signOutEverywhere().unwrap();
      onSignOut();
    } catch {
      // The dialog shows the error.
    }
  };
  return (
    <Dialog
      triggerLabel={SIGN_OUT_EVERYWHERE_COPY.item}
      title={SIGN_OUT_EVERYWHERE_COPY.title}
      // A failed try's error is gone when the dialog opens again.
      onClose={reset}
      trigger={(open) => (
        <Menu>
          <MenuTrigger asChild>
            {trigger ?? (
              <RowButton size="md">
                <AccountInitial email={email} />
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{AUTH_COPY.account}: </span>
                  <span className="block truncate text-sm font-medium text-ink">{email}</span>{" "}
                  <span className="block text-xs text-muted">{AUTH_COPY.signedIn}</span>
                </span>
                <ChevronsUpDown
                  aria-hidden
                  className="size-[var(--fw-icon-md)] shrink-0 text-muted"
                />
              </RowButton>
            )}
          </MenuTrigger>
          <MenuContent
            side={side}
            className="w-64"
            onCloseAutoFocus={(event) => {
              if (!chosen.current) return;
              chosen.current = false;
              event.preventDefault();
              open();
            }}
          >
            <MenuLabel className="truncate">{email}</MenuLabel>
            <MenuCheckboxItem
              checked={theme === THEMES.dark}
              onCheckedChange={(dark) => setTheme(dark ? THEMES.dark : THEMES.light)}
            >
              <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
              {AUTH_COPY.darkMode}
            </MenuCheckboxItem>
            {links.notifications ? (
              <MenuItem asChild>
                <Link href={APP_ROUTES.notifications}>
                  <Bell aria-hidden className="size-[var(--fw-icon-md)]" />
                  {AUTH_COPY.notifications}
                </Link>
              </MenuItem>
            ) : null}
            <MenuItem asChild>
              <Link href={APP_ROUTES.networks}>
                <Coins aria-hidden className="size-[var(--fw-icon-md)]" />
                {AUTH_COPY.networks}
              </Link>
            </MenuItem>
            {links.team ? (
              <MenuItem asChild>
                <Link href={APP_ROUTES.team}>
                  <Users aria-hidden className="size-[var(--fw-icon-md)]" />
                  {AUTH_COPY.team}
                </Link>
              </MenuItem>
            ) : null}
            {/* Not built yet: shown as coming (the owner's choice), it does nothing. */}
            <MenuItem disabled>
              <Settings aria-hidden className="size-[var(--fw-icon-md)]" />
              {AUTH_COPY.settings}
              <span className="ml-auto text-xs">{AUTH_COPY.soon}</span>
            </MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={onSignOut}>
              <LogOut aria-hidden className="size-[var(--fw-icon-md)]" />
              {AUTH_COPY.signOut}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                chosen.current = true;
              }}
            >
              <MonitorX aria-hidden className="size-[var(--fw-icon-md)]" />
              {SIGN_OUT_EVERYWHERE_COPY.item}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    >
      <p>{SIGN_OUT_EVERYWHERE_COPY.body}</p>
      {isError ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {SIGN_OUT_EVERYWHERE_COPY.failed}
        </p>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        <Button type="submit" variant={BUTTON_VARIANTS.secondary}>
          {SIGN_OUT_EVERYWHERE_COPY.keep}
        </Button>
        <Button
          type="button"
          variant={BUTTON_VARIANTS.danger}
          loading={isLoading}
          onClick={() => void confirm()}
        >
          {SIGN_OUT_EVERYWHERE_COPY.confirm}
        </Button>
      </form>
    </Dialog>
  );
}

export interface AccountInitialProps {
  email: string;
}

export function AccountInitial({ email }: AccountInitialProps) {
  return (
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-sm font-semibold text-ink ring-1 ring-line"
    >
      {email.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
