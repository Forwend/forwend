// One "@", something on both sides, a dot in the domain, no spaces. Enough for a sign-up form.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}
