import { COLOR_TOKENS } from "@forwend/design-tokens";

export function ColorSwatches() {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {COLOR_TOKENS.map((name) => (
        <li
          key={name}
          className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm"
        >
          <span
            className="block h-20 border-b border-line"
            style={{ background: `var(--fw-${name})` }}
          />
          <span className="block px-3 py-2">
            <span className="block text-sm font-medium">{name}</span>
            <code className="block font-mono text-xs text-subtle">--fw-{name}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}
