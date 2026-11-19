import type { ReactNode } from "react";

export interface InitialsAvatarProps {
  name: string | null;
  small?: boolean;
  fallback?: ReactNode; // shown without a name
  children?: ReactNode;
}

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

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.match(/\p{L}/u)?.[0] ?? "")
    .join("")
    .toUpperCase();
}
