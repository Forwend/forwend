import { Button } from "@forwend/ui-web";

const CLEAR = "Clear filter and search";

/** A filtered list with no rows: says so and offers to show the whole list again. */
export function NoMatch({
  text,
  onClear,
  className = "rounded-md border border-line bg-surface",
}: {
  text: string;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-4 px-5 py-8 text-sm text-muted ${className}`}>
      {text}
      <Button size="sm" variant="secondary" onClick={onClear}>
        {CLEAR}
      </Button>
    </div>
  );
}
