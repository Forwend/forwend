import type { ReactNode } from "react";

export interface InitialsAvatarProps {
  name: string | null;
  small?: boolean;
  /** Shown without a name, such as a request's document icon. */
  fallback?: ReactNode;
  /** Rides on the corner, such as a network's logo. */
  children?: ReactNode;
}

/** A round avatar with up to two letters of a name: a client in Invoices and Clients. */
export function InitialsAvatar({ name, small = false, fallback, children }: InitialsAvatarProps) {
  const letters = name ? initials(name) : "";
  return (
    <span
      aria-hidden
      className={`relative grid shrink-0 place-items-center rounded-pill bg-surface-2 font-medium text-muted ${small ? "size-7 text-xs" : "size-9 text-sm"}`}
    >
      {letters || fallback}
      {children}
    </span>
  );
}

// Up to two letters of the name, one from each of its first words that has a letter.
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.match(/\p{L}/u)?.[0] ?? "")
    .join("")
    .toUpperCase();
}
