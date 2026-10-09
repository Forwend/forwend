"use client";

import { THEMES } from "@forwend/design-tokens";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  useTheme,
} from "@forwend/ui-web";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { AUTH_COPY } from "@/features/auth/auth-copy";

// The signed-in account and the app-wide settings: theme and sign out. `trigger` lets the phone tab bar open it.
export function AccountMenu({
  email,
  onSignOut,
  trigger,
  side = "top",
}: {
  email: string;
  onSignOut: () => void;
  trigger?: ReactNode;
  side?: "top" | "bottom";
}) {
  const [theme, setTheme] = useTheme();
  const initial = email.charAt(0).toUpperCase() || "?";
  return (
    <Menu>
      <MenuTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`${AUTH_COPY.account}: ${email}`}
            className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors duration-[var(--fw-duration-fast)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus data-[state=open]:bg-surface-2"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-pill bg-primary text-sm font-medium text-on-primary">
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{email}</span>
              <span className="block text-xs text-muted">{AUTH_COPY.signedIn}</span>
            </span>
            <ChevronsUpDown aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
          </button>
        )}
      </MenuTrigger>
      <MenuContent side={side} className="w-64">
        <MenuLabel>{AUTH_COPY.theme}</MenuLabel>
        <MenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value === THEMES.dark ? THEMES.dark : THEMES.light)}
        >
          <MenuRadioItem value={THEMES.light}>{AUTH_COPY.light}</MenuRadioItem>
          <MenuRadioItem value={THEMES.dark}>{AUTH_COPY.dark}</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        {/* Not built yet: shown as coming (the owner's choice), it does nothing. */}
        <MenuItem disabled>
          <Settings aria-hidden className="size-[var(--fw-icon-md)]" />
          {AUTH_COPY.settings}
          <span className="ml-auto text-xs">{AUTH_COPY.soon}</span>
        </MenuItem>
        <MenuItem onSelect={onSignOut}>
          <LogOut aria-hidden className="size-[var(--fw-icon-md)]" />
          {AUTH_COPY.signOut}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
