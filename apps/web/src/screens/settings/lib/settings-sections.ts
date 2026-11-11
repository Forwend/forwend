import {
  Bell,
  Coins,
  FlaskConical,
  Landmark,
  type LucideIcon,
  ShieldCheck,
  Users,
  WalletMinimal,
} from "lucide-react";
import type { Profile } from "@/features/profiles/types/profile";
import { accountLinks, pageAllowed } from "@/screens/app-shell/lib/app-nav";
import { SETTINGS_COPY as COPY } from "@/screens/settings/constants/settings-copy";
import { APP_ROUTES } from "@/shared/config/routes";

export interface SettingsSection {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** The person's own settings, then the active profile's, each only where the role may open it (D-93). */
export function settingsSections(
  profile: Profile,
): { label: string; business: boolean; items: SettingsSection[] }[] {
  const links = accountLinks(profile);
  const account: SettingsSection[] = [
    { href: APP_ROUTES.account, label: COPY.account.title, icon: ShieldCheck },
    ...(links.notifications
      ? [{ href: APP_ROUTES.notifications, label: COPY.notifications.title, icon: Bell }]
      : []),
  ];
  const business: SettingsSection[] = [
    ...(pageAllowed(profile, APP_ROUTES.billingDetails)
      ? [{ href: APP_ROUTES.billingDetails, label: COPY.billing.title, icon: Landmark }]
      : []),
    ...(pageAllowed(profile, APP_ROUTES.networks)
      ? [{ href: APP_ROUTES.networks, label: COPY.networks.title, icon: Coins }]
      : []),
    ...(pageAllowed(profile, APP_ROUTES.developerMode)
      ? [{ href: APP_ROUTES.developerMode, label: COPY.developerMode.title, icon: FlaskConical }]
      : []),
    ...(links.team ? [{ href: APP_ROUTES.team, label: COPY.team.title, icon: Users }] : []),
    ...(pageAllowed(profile, APP_ROUTES.wallet)
      ? [{ href: APP_ROUTES.wallet, label: COPY.wallet.title, icon: WalletMinimal }]
      : []),
  ];
  return [
    { label: COPY.yourAccount, business: false, items: account },
    ...(business.length ? [{ label: COPY.thisProfile, business: true, items: business }] : []),
  ];
}
