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
  RowButton,
  useTheme,
} from "@forwend/ui-web";
import { Bell, ChevronsUpDown, LogOut, Moon, Settings } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { APP_ROUTES } from "@/shared/config/routes";

export interface AccountMenuProps {
  email: string;
  onSignOut: () => void;
  trigger?: ReactNode;
  side?: "top" | "bottom" | "right";
}

export function AccountMenu({ email, onSignOut, trigger, side = "top" }: AccountMenuProps) {
  const [theme, setTheme] = useTheme();
  return (
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
            <ChevronsUpDown aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
          </RowButton>
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
        <MenuItem asChild>
          <Link href={APP_ROUTES.notifications}>
            <Bell aria-hidden className="size-[var(--fw-icon-md)]" />
            {AUTH_COPY.notifications}
          </Link>
        </MenuItem>
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
