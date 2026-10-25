/** Where an endpoint sends, as its rows name it: the host and path, without a query that may hold a token. */
export function endpointPlace(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}
