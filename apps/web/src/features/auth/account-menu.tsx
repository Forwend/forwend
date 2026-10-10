"use client";

import { THEMES } from "@forwend/design-tokens";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  useTheme,
} from "@forwend/ui-web";
import { ChevronsUpDown, LogOut, Moon, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { AUTH_COPY } from "@/features/auth/auth-copy";

// The signed-in account: the app's one theme control, settings (not built yet) and sign out.
export function AccountMenu({
  email,
  onSignOut,
  trigger,
  side = "top",
}: {
  email: string;
  onSignOut: () => void;
  trigger?: ReactNode;
  side?: "top" | "bottom" | "right";
}) {
  const [theme, setTheme] = useTheme();
  return (
    <Menu>
      <MenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`${AUTH_COPY.account}: ${email}`}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-md p-1.5 text-left outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-surface-2"
          >
            <AccountInitial email={email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{email}</span>
              <span className="block text-xs text-muted">{AUTH_COPY.signedIn}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
          </button>
        )}
      </MenuTrigger>
      <MenuContent side={side} className="w-64">
        <MenuLabel className="truncate">{email}</MenuLabel>
        <MenuCheckboxItem
          checked={theme === THEMES.dark}
          onCheckedChange={(dark) => setTheme(dark ? THEMES.dark : THEMES.light)}
        >
          <Moon aria-hidden className="size-[var(--fw-icon-md)]" />
          {AUTH_COPY.darkMode}
        </MenuCheckboxItem>
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
      </MenuContent>
    </Menu>
  );
}

/** The account's round initial, also the phone top bar's account button. */
export function AccountInitial({ email }: { email: string }) {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-sm font-semibold text-ink ring-1 ring-line">
      {email.charAt(0).toUpperCase() || "?"}
    </span>
  );
}
