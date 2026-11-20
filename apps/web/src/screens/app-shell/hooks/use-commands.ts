import { THEMES } from "@forwend/design-tokens";
import { formatTokenAmount, shortAddress, useTheme } from "@forwend/ui-web";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  FilePlus2,
  HandCoins,
  Link2,
  Moon,
  Plus,
  QrCode,
  Send,
  Settings,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { AUTH_COPY } from "@/features/auth/constants/auth-copy";
import { BALANCES_COPY } from "@/features/balances/constants/balances-copy";
import { CLIENTS_COPY } from "@/features/clients/constants/clients-copy";
import { NEW_INVOICE_COPY, NEW_REQUEST_COPY } from "@/features/invoices/constants/invoices-copy";
import { LINKS_COPY } from "@/features/links/constants/links-copy";
import { PERMISSIONS, PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { PROFILES_COPY } from "@/features/profiles/constants/profiles-copy";
import { useAppSession } from "@/features/profiles/hooks/use-app-session";
import { can, profileLabel } from "@/features/profiles/lib/profile";
import { useGetTransactionsQuery } from "@/features/transactions/api/transactions-api";
import { TRANSACTION_DIRECTIONS } from "@/features/transactions/constants/transactions";
import { TRANSACTIONS_COPY } from "@/features/transactions/constants/transactions-copy";
import { transactionKey } from "@/features/transactions/lib/transactions";
import { COMMAND_COPY as COPY } from "@/screens/app-shell/constants/command-menu-copy";
import { navFor, pageAllowed } from "@/screens/app-shell/lib/app-nav";
import type { Command } from "@/screens/app-shell/types/command-menu";
import { APP_ROUTES } from "@/shared/config/routes";
import { SEARCH_PARAM } from "@/shared/constants/search";
import { chainName } from "@/shared/lib/chains";

type Entry = Omit<Command, "group">;

/** The command menu's entries; recent transactions are read only while it is open. */
export function useCommands(open: boolean, close: () => void) {
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const { profile, profiles, chooseProfile, openReceive, openSend, openTransfer, openRequest } =
    useAppSession();
  const money = can(profile, PERMISSIONS.moneyRead);
  const recent = useGetTransactionsQuery(
    { profileId: profile.profileId, limit: 20 },
    { skip: !open || !money },
  );
  const go = (href: string) => () => router.push(href);
  const business = profile.kind !== PROFILE_KINDS.personal;
  const billing = business && can(profile, PERMISSIONS.invoicesWrite);

  const pages: Entry[] = navFor(profile).flatMap((group) =>
    group.items.flatMap(({ href, label, icon }) =>
      href ? [{ id: href, label, icon, run: go(href) }] : [],
    ),
  );
  if (pageAllowed(profile, APP_ROUTES.settings)) {
    // Security is the first section: from large screens Settings opens there.
    pages.push({
      id: APP_ROUTES.settings,
      label: AUTH_COPY.settings,
      icon: Settings,
      run: go(APP_ROUTES.account),
    });
  }
  const creates = [
    { href: APP_ROUTES.newInvoice, label: NEW_INVOICE_COPY.title, icon: FilePlus2, shown: billing },
    { href: APP_ROUTES.newLink, label: LINKS_COPY.newTitle, icon: Link2, shown: billing },
    { href: APP_ROUTES.newClient, label: CLIENTS_COPY.newTitle, icon: UserPlus, shown: business },
  ].filter((page) => page.shown && pageAllowed(profile, page.href));
  const actions = [
    { id: "receive", label: BALANCES_COPY.receive, icon: QrCode, run: money ? openReceive : null },
    { id: "send", label: BALANCES_COPY.send, icon: Send, run: openSend },
    { id: "transfer", label: BALANCES_COPY.transfer, icon: ArrowLeftRight, run: openTransfer },
    ...creates.map(({ href, label, icon }) => ({ id: href, label, icon, run: go(href) })),
    {
      id: "request",
      label: NEW_REQUEST_COPY.title,
      icon: HandCoins,
      run: business ? null : openRequest,
    },
    {
      id: "new-profile",
      label: PROFILES_COPY.newProfile,
      icon: Plus,
      run: go(APP_ROUTES.newProfile),
    },
    {
      id: "theme",
      label: theme === THEMES.dark ? COPY.darkOff : COPY.darkOn,
      icon: Moon,
      run: () => setTheme(theme === THEMES.dark ? THEMES.light : THEMES.dark),
    },
  ].flatMap(({ run, ...action }): Entry[] => (run ? [{ ...action, run }] : []));
  const others: Entry[] = profiles
    .filter((p) => p.profileId !== profile.profileId)
    .map((p) => ({
      id: p.profileId,
      label: `${COPY.switchTo} ${profileLabel(p)}`,
      icon: UserRound,
      run: () => chooseProfile(p.profileId),
    }));
  const transactions: Entry[] = (recent.data?.items ?? []).map((t) => {
    const amount = formatTokenAmount({ baseUnits: BigInt(t.amount), decimals: t.decimals });
    const incoming = t.direction === TRANSACTION_DIRECTIONS.in;
    return {
      id: transactionKey(t),
      label: `${incoming ? TRANSACTIONS_COPY.received : TRANSACTIONS_COPY.sent} ${amount} ${t.symbol}`,
      detail: `${shortAddress(t.counterparty)} · ${chainName(t.chainId)} · ${shortAddress(t.txHash)}`,
      keywords: `${t.counterparty} ${t.txHash}`,
      icon: incoming ? ArrowDownLeft : ArrowUpRight,
      run: go(`${APP_ROUTES.transactions}?${SEARCH_PARAM}=${t.txHash}`),
    };
  });

  const grouped = (group: string, entries: readonly Entry[]): Command[] =>
    entries.map((entry) => ({
      ...entry,
      group,
      run: () => {
        close();
        entry.run();
      },
    }));
  return {
    commands: [
      ...grouped(COPY.pages, pages),
      ...grouped(COPY.actions, actions),
      ...grouped(COPY.profiles, others),
      ...grouped(TRANSACTIONS_COPY.transactions, transactions),
    ],
    searching: recent.isFetching,
  };
}
