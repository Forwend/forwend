import {
  DURATIONS,
  EASINGS,
  RADII,
  SHADOWS,
  SPACING_STEPS,
  TYPE_ROLES,
  TYPE_SCALE,
} from "@/screens/kit/constants/kit-content";
import { KIT_ICONS } from "@/screens/kit/constants/kit-icons";

export function TypographySamples() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="text-sm text-muted">Display: Libre Caslon Display</p>
        <ul className="mt-4 flex flex-col gap-3">
          {TYPE_SCALE.slice(0, 5).map((t) => (
            <li
              key={t.token}
              className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <code className="w-28 shrink-0 font-mono text-xs text-subtle">
                {t.token} · {t.size}
              </code>
              <span className="font-display leading-none text-ink" style={{ fontSize: t.size }}>
                {t.sample}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm text-muted">Text: Hanken Grotesk</p>
        <ul className="mt-4 flex flex-col gap-3">
          {TYPE_SCALE.slice(4).map((t) => (
            <li
              key={t.token}
              className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <code className="w-28 shrink-0 font-mono text-xs text-subtle">
                {t.token} · {t.size}
              </code>
              <span className="text-ink" style={{ fontSize: t.size }}>
                {t.sample}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm text-muted">Role sizes: fluid, used across Forwend</p>
        <ul className="mt-4 flex flex-col gap-4">
          {TYPE_ROLES.map((r) => (
            <li
              key={r.token}
              className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <code className="w-28 shrink-0 font-mono text-xs text-subtle">{r.token}</code>
              <span className={`${r.className} text-ink`}>{r.sample}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-sm text-muted">Numbers and addresses: Geist Mono, tabular figures</p>
        <p className="mt-4 font-mono text-amount-lg tabular-nums text-ink">
          1,250.00 · 98,431.07 · 0x8f3a…c21d
        </p>
      </div>
    </div>
  );
}

export function SpacingScale() {
  return (
    <ul className="flex flex-col gap-3">
      {SPACING_STEPS.map((step) => (
        <li key={step} className="flex items-center gap-4">
          <code className="w-24 font-mono text-xs text-subtle">
            {step} · {step * 4}px
          </code>
          <span
            className="h-3 rounded-sm bg-accent"
            style={{ width: `calc(var(--spacing) * ${step})` }}
          />
        </li>
      ))}
    </ul>
  );
}

export function RadiusSamples() {
  return (
    <ul className="flex flex-wrap gap-6">
      {RADII.map((r) => (
        <li key={r} className="flex flex-col items-center gap-2">
          <span
            className="size-20 border border-line-strong bg-surface-2"
            style={{ borderRadius: `var(--fw-radius-${r})` }}
          />
          <code className="font-mono text-xs text-subtle">radius-{r}</code>
        </li>
      ))}
    </ul>
  );
}

export function ShadowSamples() {
  return (
    <ul className="flex flex-wrap gap-8">
      {SHADOWS.map((s) => (
        <li key={s} className="flex flex-col items-center gap-3">
          <span
            className="size-28 rounded-lg border border-line bg-surface"
            style={{ boxShadow: `var(--fw-shadow-${s})` }}
          />
          <code className="font-mono text-xs text-subtle">shadow-{s}</code>
        </li>
      ))}
    </ul>
  );
}

export function MotionSamples() {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <ul className="flex flex-col gap-4">
        {DURATIONS.map((d) => (
          <li key={d.token} className="group rounded-lg border border-line bg-surface p-4">
            <div className="flex items-baseline justify-between gap-4">
              <code className="font-mono text-xs text-ink">
                {d.token} · {d.ms}ms
              </code>
              <span className="text-xs text-muted">{d.use}</span>
            </div>
            <div className="mt-3 h-2 rounded-pill bg-surface-2">
              <span
                className="block h-2 w-1/4 rounded-pill bg-accent ease-out group-hover:w-full"
                style={{ transitionProperty: "width", transitionDuration: `var(${d.token})` }}
              />
            </div>
          </li>
        ))}
        <li className="text-xs text-subtle">Hover a row to run its duration.</li>
      </ul>
      <ul className="flex flex-col gap-4">
        {EASINGS.map((e) => (
          <li key={e.token} className="rounded-lg border border-line bg-surface p-4">
            <code className="block font-mono text-xs text-ink">{e.token}</code>
            <code className="mt-1 block font-mono text-xs text-subtle">{e.curve}</code>
            <p className="mt-2 text-sm text-muted">{e.use}</p>
          </li>
        ))}
        <li className="text-sm text-muted">
          Motion turns off under <code className="font-mono text-xs">prefers-reduced-motion</code>.
        </li>
      </ul>
    </div>
  );
}

export function IconSet() {
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6 lg:grid-cols-8">
      {KIT_ICONS.map(({ name, Icon }) => (
        <li
          key={name}
          className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface p-4 text-ink"
        >
          <Icon aria-hidden className="size-[var(--fw-icon-lg)]" strokeWidth={1.75} />
          <span className="text-center text-xs text-muted">{name}</span>
        </li>
      ))}
    </ul>
  );
}
