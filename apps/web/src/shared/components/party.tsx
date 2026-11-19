export interface PartyProps {
  lines: (string | null)[]; // name first; empty lines are left out
}

export function Party({ lines }: PartyProps) {
  const [first, ...rest] = lines.filter(Boolean);
  return (
    <div className="px-4 py-3 text-sm break-words whitespace-pre-line sm:px-5">
      <p className="font-medium text-ink">{first}</p>
      {rest.map((line) => (
        <p key={line} className="mt-0.5 text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}
