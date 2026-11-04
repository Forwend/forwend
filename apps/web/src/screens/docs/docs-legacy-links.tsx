"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { docsPath } from "@/shared/config/docs-routes";
import { LEGACY_DOCS_ANCHORS } from "./constants/docs-content";

export function DocsLegacyLinks() {
  const router = useRouter();
  useEffect(() => {
    function redirect() {
      const target = LEGACY_DOCS_ANCHORS[window.location.hash.slice(1)];
      if (target) router.replace(docsPath(target.slug, target.heading));
    }
    redirect();
    window.addEventListener("hashchange", redirect);
    return () => window.removeEventListener("hashchange", redirect);
  }, [router]);
  return null;
}
