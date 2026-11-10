"use client";

import { Button, SelectMenu, type SelectMenuProps, Sheet } from "@forwend/ui-web";
import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

const COPY = {
  filters: "Filters",
  filtersOn: (n: number) => `Filters, ${n} on`,
  clearAll: "Clear all",
  done: "Done",
};

/** One filter of a list, as its menu takes it. Each group's first option is its default, such as All. */
export type FilterGroup = SelectMenuProps<string>;

/** A typed menu as a group: the sheet only hands back values from the group's own options. */
export function filterGroup<T extends string>(group: SelectMenuProps<T>): FilterGroup {
  return group as unknown as FilterGroup;
}

/**
 * A list's filter menus. From small screens up they sit in the toolbar; a phone gets one Filters button with a count,
 * whose bottom sheet holds each menu's choices as chips.
 */
export function ListFilters({ groups }: { groups: readonly FilterGroup[] }) {
  const [open, setOpen] = useState(false);
  const on = groups.filter((group) => group.value !== group.options[0]?.value).length;
  return (
    <>
      <span className="contents max-sm:hidden">
        {groups.map((group) => (
          <SelectMenu key={group.label} {...group} />
        ))}
      </span>
      <Button
        variant="secondary"
        className="sm:hidden"
        aria-label={on ? COPY.filtersOn(on) : COPY.filters}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden className="size-[var(--fw-icon-sm)]" />
        {COPY.filters}
        {on ? (
          <span className="grid h-4.5 min-w-4.5 place-items-center rounded-pill bg-accent px-1 text-2xs font-semibold text-on-accent">
            {on}
          </span>
        ) : null}
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title={COPY.filters}>
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <Chips key={group.label} group={group} />
          ))}
          <div className="flex gap-3">
            {/* Stays when nothing is left to clear, so the focus it had doesn't fall out of the sheet. */}
            <Button
              variant="secondary"
              size="lg"
              aria-disabled={on === 0}
              onClick={() => {
                if (on === 0) return;
                for (const group of groups) {
                  const first = group.options[0];
                  if (first) group.onValueChange(first.value);
                }
              }}
            >
              {COPY.clearAll}
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setOpen(false)}>
              {COPY.done}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** One group's choices as radio chips: a choice applies at once, so the list behind updates as the user taps. */
function Chips({ group }: { group: FilterGroup }) {
  const name = useId();
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm font-medium text-ink">{group.label}</legend>
      <div className="flex flex-wrap gap-2">
        {group.options.map((option) => (
          <label
            key={option.value}
            className="relative inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md px-3 text-sm text-ink shadow-[inset_0_0_0_1px_var(--fw-line)] has-checked:bg-surface-2 has-checked:font-medium has-checked:shadow-[inset_0_0_0_2px_var(--fw-accent)] has-focus-visible:outline-2 has-focus-visible:outline-focus"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === group.value}
              onChange={() => group.onValueChange(option.value)}
              className="absolute inset-0 m-0 size-full cursor-pointer opacity-0"
            />
            {option.icon ? <option.icon aria-hidden className="size-3.5 text-muted" /> : null}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
