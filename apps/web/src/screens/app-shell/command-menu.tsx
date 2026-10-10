"use client";

import { THEMES } from "@forwend/design-tokens";
import { formatTokenAmount, shortAddress, useTheme } from "@forwend/ui-web";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CornerDownLeft,
  type LucideIcon,
  Moon,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { BALANCES_COPY } from "@/features/balances/balances-copy";
import { type Profile, profileLabel } from "@/features/profiles/profile";
import { PROFILES_COPY } from "@/features/profiles/profiles-copy";
import { TRANSACTION_DIRECTIONS, transactionKey } from "@/features/transactions/transactions";
import { useGetTransactionsQuery } from "@/features/transactions/transactions-api";
import { TRANSACTIONS_COPY } from "@/features/transactions/transactions-copy";
import { APP_NAV } from "@/screens/app-shell/app-nav";
import { chainName } from "@/shared/chains/chains";
import { APP_ROUTES } from "@/shared/config/routes";

const COMMAND_COPY = {
  title: "Search",
  placeholder: "Search pages, profiles, transactions",
  pages: "Pages",
  actions: "Actions",
  profiles: "Profiles",
  noResults: "Nothing found.",
  switchTo: "Switch to",
  hint: "to open",
  darkOn: "Turn on dark mode",
  darkOff: "Turn off dark mode",
} as const;

interface Command {
  id: string;
  group: string;
  label: string;
  detail?: string;
  /** Matched by the search but not shown, such as the full transaction hash. */
  keywords?: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandMenu({
  open,
  onOpenChange,
  profiles,
  active,
  onSwitch,
  onReceive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: Profile[];
  active: Profile;
  onSwitch: (profileId: string) => void;
  onReceive: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const recent = useGetTransactionsQuery(
    { profileId: active.profileId, limit: 20 },
    { skip: !open },
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!ref.current?.open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setIndex(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => onOpenChange(false);
  const go = (href: string) => () => {
    close();
    router.push(href);
  };

  const commands: Command[] = [
    ...APP_NAV[active.kind].flatMap((group) =>
      group.items.flatMap(({ href, label, icon }) =>
        href ? [{ id: href, group: COMMAND_COPY.pages, label, icon, run: go(href) }] : [],
      ),
    ),
    {
      id: "receive",
      group: COMMAND_COPY.actions,
      label: BALANCES_COPY.receive,
      icon: ArrowDownLeft,
      run: () => {
        close();
        onReceive();
      },
    },
    {
      id: "new-profile",
      group: COMMAND_COPY.actions,
      label: PROFILES_COPY.newProfile,
      icon: Plus,
      run: go(APP_ROUTES.newProfile),
    },
    {
      id: "theme",
      group: COMMAND_COPY.actions,
      label: theme === THEMES.dark ? COMMAND_COPY.darkOff : COMMAND_COPY.darkOn,
      icon: Moon,
      run: () => {
        close();
        setTheme(theme === THEMES.dark ? THEMES.light : THEMES.dark);
      },
    },
    ...profiles
      .filter((p) => p.profileId !== active.profileId)
      .map((p) => ({
        id: p.profileId,
        group: COMMAND_COPY.profiles,
        label: `${COMMAND_COPY.switchTo} ${profileLabel(p)}`,
        icon: UserRound,
        run: () => {
          close();
          onSwitch(p.profileId);
        },
      })),
    ...(recent.data?.items ?? []).map((t) => {
      const amount = formatTokenAmount({ baseUnits: BigInt(t.amount), decimals: t.decimals });
      const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
      return {
        id: transactionKey(t),
        group: TRANSACTIONS_COPY.transactions,
        label: `${incoming ? TRANSACTIONS_COPY.received : TRANSACTIONS_COPY.sent} ${amount} ${t.symbol}`,
        detail: `${shortAddress(t.counterparty)} · ${chainName(t.chainId)} · ${shortAddress(t.txHash)}`,
        keywords: `${t.counterparty} ${t.txHash}`,
        icon: incoming ? ArrowDownLeft : ArrowUpRight,
        run: go(`${APP_ROUTES.transactions}?search=${t.txHash}`),
      };
    }),
  ];
  const words = query.trim().toLowerCase();
  const shown = commands.filter((c) =>
    `${c.label} ${c.detail ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(words),
  );
  const current = Math.min(index, shown.length - 1);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setIndex((current + step + shown.length) % Math.max(shown.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      shown[current]?.run();
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only catches the backdrop; Escape is the keyboard way out
    <dialog
      ref={ref}
      aria-label={COMMAND_COPY.title}
      onClose={close}
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
      className="mx-auto mt-[12dvh] w-[calc(100vw-2rem)] max-w-xl overflow-hidden rounded-lg border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-[color-mix(in_oklab,var(--fw-ink)_35%,transparent)] backdrop:backdrop-blur-glass motion-safe:open:animate-[fw-pop-in_var(--fw-duration-base)_var(--fw-ease-out)]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden className="size-[var(--fw-icon-md)] shrink-0 text-muted" />
        <input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={shown[current] ? `${listId}-${current}` : undefined}
          aria-label={COMMAND_COPY.placeholder}
          placeholder={COMMAND_COPY.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
        />
        <kbd className="rounded-sm border border-line bg-surface-2 px-1.5 font-mono text-2xs text-muted">
          Esc
        </kbd>
      </div>
      {shown.length === 0 ? (
        <p role="status" className="px-3 py-8 text-center text-sm text-muted">
          {COMMAND_COPY.noResults}
        </p>
      ) : null}
      <div
        id={listId}
        role="listbox"
        aria-label={COMMAND_COPY.title}
        className="max-h-[50dvh] overflow-y-auto p-2 empty:hidden"
      >
        {shown.map((c, i) => (
          <Fragment key={c.id}>
            {c.group !== shown[i - 1]?.group ? (
              <p aria-hidden className="px-3 pt-2 pb-1 text-xs font-medium text-subtle">
                {c.group}
              </p>
            ) : null}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the input owns the keyboard (arrow keys and Enter) */}
            <div
              id={`${listId}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === current}
              onClick={c.run}
              onPointerMove={() => setIndex(i)}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm aria-selected:bg-surface-2"
            >
              <c.icon aria-hidden className="size-[var(--fw-icon-sm)] shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.label}</span>
                {c.detail ? (
                  <span className="block truncate font-mono text-xs text-muted">{c.detail}</span>
                ) : null}
              </span>
              {i === current ? (
                <span className="flex items-center gap-1 text-xs text-subtle">
                  <CornerDownLeft aria-hidden className="size-[var(--fw-icon-sm)]" />
                  {COMMAND_COPY.hint}
                </span>
              ) : null}
            </div>
          </Fragment>
        ))}
      </div>
    </dialog>
  );
}
