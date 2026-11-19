import { Button, EmptyState } from "@forwend/ui-web";
import { SearchX } from "lucide-react";

const TITLE = "Nothing matches";
const CLEAR = "Clear filter and search";

export interface NoMatchProps {
  onClear: () => void;
  compact?: boolean;
  page?: boolean;
  clearLabel?: string;
  title?: string;
  description?: string;
}

/** A filtered list with no rows. */
export function NoMatch({
  onClear,
  compact,
  page,
  clearLabel = CLEAR,
  title = TITLE,
  description,
}: NoMatchProps) {
  return (
    <EmptyState
      icon={SearchX}
      title={title}
      description={description}
      compact={compact}
      page={page}
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          {clearLabel}
        </Button>
      }
    />
  );
}
