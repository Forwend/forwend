/** The query string with name set to value, or removed when value is empty: "?a=1&q=x", or "" when none is left. */
export function withParam(query: string, name: string, value: string): string {
  const params = new URLSearchParams(query);
  if (value) params.set(name, value);
  else params.delete(name);
  const next = params.toString();
  return next ? `?${next}` : "";
}

/** Sets or removes one URL parameter in place: Next keeps useSearchParams in step, and Back skips it. */
export function setParam(name: string, value: string) {
  const { pathname, search, hash } = window.location;
  window.history.replaceState(null, "", `${pathname}${withParam(search, name, value)}${hash}`);
}
