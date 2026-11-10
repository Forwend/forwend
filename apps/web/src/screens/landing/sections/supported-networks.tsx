import { BrandIcon, type BrandIconName } from "@forwend/ui-web";
import { CHAINS, TOKEN_ICONS } from "@/shared/constants/chains";
import styles from "./supported-networks.module.css";

// USDT has artwork but no enabled payments, so it stays out (docs: reference/networks).
const TOKENS = ["USDC", "OUSD"] as const;

// Each network once, by its mainnet's name: a mainnet's chain id is lower than its testnet's, so CHAINS lists it first.
const NETWORKS = new Map<BrandIconName, string>();
for (const chain of Object.values(CHAINS)) {
  if (chain.icon && !NETWORKS.has(chain.icon)) NETWORKS.set(chain.icon, chain.name);
}

const ITEMS: readonly { name: string; icon: BrandIconName }[] = [
  ...TOKENS.flatMap((symbol) => {
    const icon = TOKEN_ICONS[symbol];
    return icon ? [{ name: symbol, icon }] : [];
  }),
  ...Array.from(NETWORKS, ([icon, name]) => ({ name, icon })),
  // Customers can also pay from other chains through it (D-123).
  { name: "NEAR Intents", icon: "near" },
];

function Row({ copy }: { copy?: boolean }) {
  return (
    <ul className={styles.row} aria-hidden={copy || undefined} data-copy={copy || undefined}>
      {ITEMS.map((item) => (
        <li key={item.name}>
          <BrandIcon name={item.icon} className={styles.icon} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}

export function SupportedNetworks() {
  return (
    <section className={styles.networks} aria-label="Tokens and networks">
      <div className={styles.marquee}>
        {/* Four copies keep the loop wider than any screen; it moves by two, so the seam never shows. */}
        <div
          className={`${styles.track} motion-safe:animate-[fw-marquee_calc(var(--fw-duration-marquee)*1.5)_linear_infinite]`}
        >
          <Row />
          <Row copy />
          <Row copy />
          <Row copy />
        </div>
      </div>
    </section>
  );
}
