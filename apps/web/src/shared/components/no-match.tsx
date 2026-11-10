import { Button, EmptyState } from "@forwend/ui-web";
import { SearchX } from "lucide-react";

const TITLE = "Nothing matches";
const CLEAR = "Clear filter and search";

export interface NoMatchProps {
  onClear: () => void;
  compact?: boolean;
  /** The page's only content: centered in the workspace, under the toolbar that keeps the filter. */
  page?: boolean;
  /** The button's words on a list with search alone. */
  clearLabel?: string;
  /** Names the list: "No transactions match". */
  title?: string;
  /** What was searched and filtered, so the reader sees why nothing shows. */
  description?: string;
}

/** A filtered list with no rows (R-75). */
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
