import { APP_ROUTES } from "./routes";

export function docsPath(slug = "", heading?: string): string {
  return `${APP_ROUTES.docs}${slug ? `/${slug}` : ""}${heading ? `#${heading}` : ""}`;
}
