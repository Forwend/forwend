"use client";

import { Button, Dialog, SearchField } from "@forwend/ui-web";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./docs.module.css";
import { searchDocs } from "./lib/docs-search";
import type { DocsSearchEntry } from "./types/docs";

export interface DocsSearchProps {
  index: readonly DocsSearchEntry[];
}

export function DocsSearch({ index }: DocsSearchProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    function navigate(event: KeyboardEvent) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const links = Array.from(element?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
      if (!links.length) return;
      event.preventDefault();
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % links.length
          : (current - 1 + links.length) % links.length;
      links[next]?.focus();
    }
    element?.addEventListener("keydown", navigate);
    return () => element?.removeEventListener("keydown", navigate);
  }, []);
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchDocs(index, query), [index, query]);
  return (
    <Dialog
      title="Search documentation"
      triggerLabel="Search documentation"
      onClose={() => setQuery("")}
      trigger={(open) => (
        <Button
          variant="secondary"
          className={styles.searchTrigger}
          onClick={() => {
            open();
            container.current?.querySelector<HTMLInputElement>("input")?.focus();
          }}
        >
          <Search aria-hidden className="size-4" />
          <span>Search docs</span>
        </Button>
      )}
    >
      <div ref={container}>
        <SearchField
          label="Search documentation"
          placeholder="Search topics, fields, errors…"
          value={query}
          onValueChange={setQuery}
        />
        <p className={styles.searchHint} role="status">
          {query.trim()
            ? `${results.length} ${results.length === 1 ? "result" : "results"}`
            : "Try “webhook signature” or “amountUsd”. Use Tab or arrow keys to explore results."}
        </p>
        {query.trim() && !results.length ? (
          <p className={styles.emptyResults}>
            No matching topics. Try a shorter term, a field name or an error code.
          </p>
        ) : null}
        <ul className={styles.searchResults}>
          {results.map((result) => (
            <li key={result.href}>
              <Link
                href={result.href}
                onClick={(event) => event.currentTarget.closest("dialog")?.close()}
              >
                <strong>{result.title}</strong>
                <span>{result.section}</span>
                <p>{result.text}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
