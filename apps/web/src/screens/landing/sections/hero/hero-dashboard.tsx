import {
  ActionButton,
  BigAmount,
  BrandIcon,
  Button,
  Card,
  LogoMark,
  StatusPill,
} from "@forwend/ui-web";
import {
  ArrowDownLeft,
  Bell,
  ChevronsUpDown,
  FilePlus2,
  Link2,
  PanelLeftClose,
  QrCode,
  Search,
  Send,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { OWED_COPY } from "@/features/invoices/constants/invoices-copy";
import { PAYMENTS_COPY } from "@/features/payments/constants/payments-copy";
import { PROFILE_KINDS } from "@/features/profiles/constants/profile";
import { APP_NAV } from "@/screens/app-shell/constants/app-nav";
import { HERO_IMAGE } from "@/shared/assets/images";
import { TOKEN_ICONS } from "@/shared/constants/chains";
import { DASHBOARD } from "./constants/hero-dashboard";
import styles from "./hero-dashboard.module.css";

const ACTIONS = [
  { label: "New invoice", icon: FilePlus2, primary: true },
  { label: "Payment link", icon: Link2 },
  { label: "Checkout", icon: ShoppingCart },
  { label: "Receive", icon: ArrowDownLeft },
] as const;

/**
 * A still picture of the signed-in merchant overview, built from the app's own sidebar groups and cards. It is one
 * image to assistive technology, and inert, so nothing in it takes focus or clicks.
 */
export function HeroDashboard() {
  return (
    <div className={styles.stage}>
      <div
        className={styles.window}
        role="img"
        aria-label="Example Forwend overview: a 18,734.20 USD balance, pending payments, money received and assets held"
      >
        <div className={styles.app} inert>
          <aside className={styles.sidebar}>
            <div className={styles.profile}>
              <LogoMark className="size-5" />
              <span className={styles.slash}>/</span>
              <span className={styles.profileName}>{DASHBOARD.profile}</span>
              <ChevronsUpDown className="size-3.5 text-muted" />
            </div>
            {APP_NAV[PROFILE_KINDS.merchant].map((group, groupIndex) => (
              <div key={group.label} className={styles.group}>
                <span className={styles.groupLabel}>{group.label}</span>
                {group.items.map((item, index) => (
                  <span
                    key={item.label}
                    className={styles.navItem}
                    data-current={(groupIndex === 0 && index === 0) || undefined}
                    data-soon={!item.href || undefined}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </span>
                ))}
              </div>
            ))}
          </aside>
          <div className={styles.main}>
            <div className={styles.header}>
              <PanelLeftClose className="size-4 text-muted" />
              <span className={styles.crumbs}>
                <span>{DASHBOARD.profile}</span>
                <span className="text-subtle">/</span>
                <strong>Overview</strong>
              </span>
              <span className={styles.search}>
                <Search className="size-4" />
                Search or jump to
                <kbd>⌘K</kbd>
              </span>
              <span className={styles.bell}>
                <Bell className="size-4" />
              </span>
              <Button variant="soon" size="md" className={styles.headerButton}>
                <Send className="size-4" />
                Send
              </Button>
              <Button variant="primary" size="md" className={styles.headerButton}>
                <QrCode className="size-4" />
                Receive
              </Button>
            </div>
            <div className={styles.rows}>
              <div className={styles.row}>
                <Card className={styles.balance}>
                  <span
                    className={styles.balanceArt}
                    style={{ backgroundImage: `url(${HERO_IMAGE.src})` }}
                  />
                  <span className={styles.label}>Total balance</span>
                  <BigAmount
                    value={DASHBOARD.balance}
                    unit="USD"
                    className={styles.balanceFigure}
                  />
                  <span className={styles.change}>
                    <span className="inline-flex items-center gap-1 text-success">
                      <TrendingUp className="size-4" />
                      {DASHBOARD.change} USD
                    </span>
                    <span className="text-muted">past month</span>
                  </span>
                  <div className={styles.actions}>
                    {ACTIONS.map((action) => (
                      <ActionButton
                        key={action.label}
                        icon={action.icon}
                        label={action.label}
                        primary={"primary" in action}
                        tabIndex={-1}
                      />
                    ))}
                  </div>
                </Card>
                <Card title="Pending payments" className={styles.pending}>
                  <span className={styles.figure}>
                    {DASHBOARD.pending.total} <span className="text-sm text-muted">USD</span>
                  </span>
                  <span className={styles.bar}>
                    {DASHBOARD.pending.parts.map((part) => (
                      <span key={part.label} className={part.dot} style={{ flex: part.share }} />
                    ))}
                  </span>
                  <ul className={styles.parts}>
                    {DASHBOARD.pending.parts.map((part) => (
                      <li key={part.label}>
                        <span className={`${styles.dot} ${part.dot}`} />
                        <span className="flex-1">{part.label}</span>
                        <span className="tabular-nums">{part.amount}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div className={styles.row}>
                <Card
                  className={styles.received}
                  title="Received"
                  action={
                    <span className={styles.ranges}>
                      {DASHBOARD.ranges.map((range) => (
                        <span key={range} data-current={range === "1M" || undefined}>
                          {range}
                        </span>
                      ))}
                    </span>
                  }
                >
                  <span className={styles.figure}>
                    {DASHBOARD.received.total} <span className="text-sm text-muted">USD</span>
                  </span>
                  <span className={styles.sent}>Sent {DASHBOARD.received.sent} USD</span>
                  {/* Drawn as the app's balance chart draws: one ink line that writes in, a pulsing end point. */}
                  <svg className={styles.chart} viewBox="0 0 640 120" aria-hidden="true">
                    <path
                      d="M4 112 L 80 106 L 140 106 L 200 88 L 280 82 L 340 82 L 400 60 L 480 50 L 540 32 L 632 20"
                      pathLength={1}
                      fill="none"
                      stroke="var(--fw-ink)"
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeDasharray="1"
                      className="motion-safe:animate-[fw-draw-in_calc(var(--fw-duration-slower)*1.3)_var(--fw-ease-out)_1s_both]"
                    />
                    <circle
                      cx="632"
                      cy="20"
                      r="5"
                      fill="var(--fw-accent)"
                      style={{ transformOrigin: "632px 20px" }}
                      className="motion-safe:animate-[fw-halo_2.4s_var(--fw-ease-out)_2.2s_infinite]"
                    />
                    <circle cx="632" cy="20" r="5" fill="var(--fw-accent)" />
                  </svg>
                </Card>
                <Card title="My assets" className={styles.assets}>
                  <span className={styles.bar}>
                    {DASHBOARD.assets.map((asset) => (
                      <span
                        key={asset.symbol}
                        className={asset.dot}
                        style={{ flex: asset.share }}
                      />
                    ))}
                  </span>
                  <ul className={styles.parts}>
                    {DASHBOARD.assets.map((asset) => {
                      const icon = TOKEN_ICONS[asset.symbol];
                      return (
                        <li key={asset.symbol}>
                          {icon ? <BrandIcon name={icon} className="size-6" /> : null}
                          <span className="flex-1">
                            {asset.symbol}
                            <span className={styles.share}>{asset.share}%</span>
                          </span>
                          <span className="tabular-nums">{asset.amount}</span>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </div>
              <div className={styles.row}>
                <Card title={OWED_COPY.title} description={OWED_COPY.description}>
                  <ul className={styles.list}>
                    {DASHBOARD.unpaid.map((row) => (
                      <li key={row.client}>
                        <span className={styles.listText}>
                          <strong>{row.client}</strong>
                          <span>{row.detail}</span>
                        </span>
                        <span className={styles.listAmount}>
                          {row.amount} USD
                          <span>{OWED_COPY.left}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title={PAYMENTS_COPY.latest}>
                  <ul className={styles.list}>
                    {DASHBOARD.latest.map((row) => (
                      <li key={row.title}>
                        <span className={styles.listText}>
                          <strong>{row.title}</strong>
                          <span>{row.detail}</span>
                        </span>
                        <span className={styles.listAmount}>
                          {row.amount} USDC
                          <StatusPill status={row.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
