import { cx } from "../../../lib/cx";

export interface FullAddressProps {
  address: string;
  className?: string;
}

/** The whole address, for one someone checks before money moves. It reads in groups of four with the first and last
 * groups in ink: a look-alike made to match only the start and end then shows different middle characters. */
export function FullAddress({ address, className }: FullAddressProps) {
  const prefix = address.startsWith("0x") ? "0x" : "";
  const groups = address.slice(prefix.length).match(/.{1,4}/g) ?? [];
  return (
    <span className={cx("font-mono break-all", className)}>
      {/* Not selectable, or a copy would take the address twice. */}
      <span className="sr-only select-none">{address}</span>
      <span aria-hidden>
        {prefix}
        {groups.map((group, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: the groups are positions in a fixed string.
            key={i}
            className={cx(
              "not-last:mr-[0.35ch]",
              i === 0 || i === groups.length - 1 ? "font-medium text-ink" : "text-muted",
            )}
          >
            {group}
          </span>
        ))}
      </span>
    </span>
  );
}
