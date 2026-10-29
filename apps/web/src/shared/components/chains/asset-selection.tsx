"use client";

import {
  BrandIcon,
  Button,
  Checkbox,
  IconButton,
  SearchField,
  SegmentedControl,
  shortAddress,
} from "@forwend/ui-web";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { NoMatch } from "@/shared/components/no-match";
import { CHAINS, TOKEN_ICONS } from "@/shared/constants/chains";
import { assetGroups, selectionSummary } from "@/shared/lib/asset-selection";
import { TOKEN_SEARCH_FROM } from "@/shared/lib/chains";
import type { AssetOption } from "@/shared/types/asset-selection";

// Bounded: thousands of tokens render a page of assets at a time, and a search narrows the rest.
const GROUPS_SHOWN = 30;
const NETWORKS_SHOWN = 12;

const COPY = {
  search: "Search assets",
  placeholder: "Name, network or contract address",
  clear: "Clear search",
  all: "All",
  selected: "Selected",
  view: "Show",
  networks: (on: number, all: number) => `${on} of ${all} networks`,
  allNetworks: (symbol: string) => `${symbol} on every network`,
  networksOf: (symbol: string) => `${symbol} networks`,
  moreGroups: (n: number) => `Show ${n} more assets`,
  moreNetworks: (n: number) => `Show ${n} more networks`,
  contract: (network: string, address: string) => `${network}, contract ${address}`,
} as const;

export const assetKey = (option: { chainId: number; token: string }) =>
  `${option.chainId}:${option.token}`;

export interface AssetSelectionProps {
  label: string;
  options: readonly AssetOption[];
  selected: ReadonlySet<string>;
  /** Several keys at once when a whole asset is turned on or off. */
  onChange: (keys: readonly string[], on: boolean) => void;
  disabled?: boolean;
  /** Why this option can't be turned off right now (the last one on), shown under it. */
  lockedReason?: (key: string) => string | null;
}

/** Which assets and networks are accepted: grouped by asset, each network its own exact contract, so USDC on Base
 * and USDC on Arbitrum read as one asset without ever becoming interchangeable. */
export function AssetSelection({
  label,
  options,
  selected,
  onChange,
  disabled,
  lockedReason,
}: AssetSelectionProps) {
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [groupsShown, setGroupsShown] = useState(GROUPS_SHOWN);
  const groups = assetGroups(options, query, onlySelected ? selected : null);
  const searching = query.trim() !== "";
  const summaryId = useId();
  return (
    <div className="fw-panel flex flex-col">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:px-5">
        <p id={summaryId} className="text-sm text-muted">
          {selectionSummary(options, selected)}
        </p>
        {options.length > TOKEN_SEARCH_FROM ? (
          <div className="flex flex-wrap items-center gap-2">
            <SearchField
              label={COPY.search}
              placeholder={COPY.placeholder}
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setGroupsShown(GROUPS_SHOWN);
              }}
              className="min-w-0 flex-[1_1_16rem]"
            />
            <SegmentedControl
              label={COPY.view}
              value={onlySelected ? "selected" : "all"}
              onValueChange={(value) => setOnlySelected(value === "selected")}
              options={[
                { value: "all", label: COPY.all },
                { value: "selected", label: COPY.selected },
              ]}
            />
          </div>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <NoMatch
          compact
          onClear={() => {
            setQuery("");
            setOnlySelected(false);
          }}
          clearLabel={COPY.clear}
        />
      ) : (
        <ul aria-label={label} aria-describedby={summaryId} className="divide-y divide-line">
          {groups.slice(0, groupsShown).map((group) => {
            const keys = group.options.map(assetKey);
            const on = keys.filter((key) => selected.has(key)).length;
            // A search shows the networks it matched; otherwise a group opens on demand, or when it has only one.
            const expanded = searching || open.has(group.symbol) || group.options.length === 1;
            const locked = keys.map((key) => (selected.has(key) ? lockedReason?.(key) : null));
            return (
              <li key={group.symbol}>
                <div className="flex min-h-14 items-center gap-3 px-4 sm:px-5">
                  <Checkbox
                    hideLabel
                    label={COPY.allNetworks(group.symbol)}
                    checked={on === keys.length}
                    mixed={on > 0 && on < keys.length}
                    disabled={disabled || (on === keys.length && locked.some(Boolean))}
                    // A partly chosen asset turns fully on, as a mixed checkbox does everywhere else.
                    onChange={() => onChange(keys, on !== keys.length)}
                    className="min-h-0"
                  />
                  <AssetIcon symbol={group.symbol} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">{group.symbol}</span>
                    <span className="block truncate text-xs text-muted">
                      {COPY.networks(on, keys.length)}
                    </span>
                  </span>
                  {group.options.length > 1 && !searching ? (
                    <IconButton
                      aria-expanded={expanded}
                      label={COPY.networksOf(group.symbol)}
                      onClick={() =>
                        setOpen((current) => {
                          const next = new Set(current);
                          if (next.has(group.symbol)) next.delete(group.symbol);
                          else next.add(group.symbol);
                          return next;
                        })
                      }
                    >
                      <ChevronDown
                        aria-hidden
                        className={`size-[var(--fw-icon-sm)] transition-transform duration-[var(--fw-duration-fast)] ${expanded ? "rotate-180" : ""}`}
                      />
                    </IconButton>
                  ) : null}
                </div>
                {expanded ? (
                  <NetworkRows
                    options={group.options}
                    selected={selected}
                    onChange={onChange}
                    disabled={disabled}
                    lockedReason={lockedReason}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {groups.length > groupsShown ? (
        <div className="border-t border-line px-4 py-2.5 sm:px-5">
          <Button size="sm" variant="ghost" onClick={() => setGroupsShown((n) => n + GROUPS_SHOWN)}>
            {COPY.moreGroups(Math.min(GROUPS_SHOWN, groups.length - groupsShown))}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NetworkRows({
  options,
  selected,
  onChange,
  disabled,
  lockedReason,
}: Pick<AssetSelectionProps, "selected" | "onChange" | "disabled" | "lockedReason"> & {
  options: readonly AssetOption[];
}) {
  const [shown, setShown] = useState(NETWORKS_SHOWN);
  return (
    <ul className="border-t border-line bg-sunken/40 py-1">
      {options.slice(0, shown).map((option) => {
        const key = assetKey(option);
        const network = CHAINS[option.chainId]?.name ?? `Chain ${option.chainId}`;
        const reason = selected.has(key) ? (lockedReason?.(key) ?? null) : null;
        return (
          <li key={key} className="flex flex-col pr-4 pl-11 sm:pr-5 sm:pl-12">
            <div className="flex min-h-11 items-center gap-3 text-sm">
              <Checkbox
                id={key}
                hideLabel
                label={`${option.symbol} on ${COPY.contract(network, option.token)}`}
                checked={selected.has(key)}
                disabled={disabled || Boolean(reason)}
                onChange={(event) => onChange([key], event.target.checked)}
                className="min-h-0"
              />
              {/* The row's text opens the same box, as a label would. */}
              <label
                htmlFor={key}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
              >
                <NetworkIcon chainId={option.chainId} />
                <span className="min-w-0 flex-1 truncate text-ink">{network}</span>
                {/* The exact contract: the same symbol on another network is another token. */}
                <span className="shrink-0 font-mono text-xs text-muted" title={option.token}>
                  {shortAddress(option.token)}
                </span>
              </label>
            </div>
            {reason ? <p className="-mt-1 pb-2 pl-7 text-xs text-muted">{reason}</p> : null}
          </li>
        );
      })}
      {options.length > shown ? (
        <li className="pl-11 sm:pl-12">
          <Button size="sm" variant="ghost" onClick={() => setShown(options.length)}>
            {COPY.moreNetworks(options.length - shown)}
          </Button>
        </li>
      ) : null}
    </ul>
  );
}

function AssetIcon({ symbol }: { symbol: string }) {
  const icon = TOKEN_ICONS[symbol];
  return icon ? (
    <BrandIcon name={icon} className="size-8 shrink-0" />
  ) : (
    // No logo of our own for this token: its initials, never a made-up mark.
    <span
      aria-hidden
      className="grid size-8 shrink-0 place-items-center rounded-pill bg-surface-2 text-xs font-semibold text-muted"
    >
      {symbol.slice(0, 2)}
    </span>
  );
}

function NetworkIcon({ chainId }: { chainId: number }) {
  const icon = CHAINS[chainId]?.icon;
  return icon ? (
    <BrandIcon name={icon} className="size-5 shrink-0" />
  ) : (
    <span aria-hidden className="size-5 shrink-0 rounded-pill bg-surface-2" />
  );
}
