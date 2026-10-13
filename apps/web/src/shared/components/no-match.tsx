import { Button, EmptyState } from "@forwend/ui-web";
import { SearchX } from "lucide-react";

const TITLE = "Nothing matches";
const CLEAR = "Clear filter and search";

/** A filtered list with no rows: says so in the list's place and offers the whole list again (R-75). */
export function NoMatch({ onClear, compact }: { onClear: () => void; compact?: boolean }) {
  return (
    <EmptyState
      icon={SearchX}
      title={TITLE}
      compact={compact}
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          {CLEAR}
        </Button>
      }
    />
  );
}
