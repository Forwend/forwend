import { useState } from "react";

/** While "Show more" loads, the last answer under the same key (filter and search); never another key's answer. */
export function useShownData<T>(
  key: string,
  current: T | undefined,
  last: T | undefined,
): T | undefined {
  const [shownKey, setShownKey] = useState(key);
  if (current !== undefined && shownKey !== key) setShownKey(key);
  return current ?? (shownKey === key ? last : undefined);
}
