// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiSearch,
  SEARCH_DELAY_MS,
  SEARCH_MAX,
  useListFilters,
  withParam,
} from "@/shared/hooks/use-list-filters";

let url = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(url) }));

describe("useListFilters", () => {
  afterEach(() => vi.useRealTimers());

  it("follows Back to an earlier search after a link changed ?q, and never writes the later one again", () => {
    vi.useFakeTimers();
    const replace = vi.spyOn(window.history, "replaceState");
    const { result, rerender } = renderHook(() =>
      useListFilters("direction", ["all", "in", "out"] as const, "all"),
    );

    act(() => result.current.setSearch("abc"));
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    url = "?q=abc";
    rerender();

    url = "?q=0xhash"; // a link (⌘K) pushes another search
    rerender();
    expect(result.current.search).toBe("0xhash");

    url = "?q=abc"; // Back
    rerender();
    replace.mockClear();
    act(() => vi.advanceTimersByTime(SEARCH_DELAY_MS * 2));
    expect(result.current.search).toBe("abc");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("withParam", () => {
  it("sets, replaces and removes one parameter and keeps the others", () => {
    expect(withParam("", "q", "kettle & co")).toBe("?q=kettle+%26+co");
    expect(withParam("?status=paid&q=old", "q", "new")).toBe("?status=paid&q=new");
    expect(withParam("?status=paid&q=old", "q", "")).toBe("?status=paid");
    expect(withParam("?q=old", "q", "")).toBe("");
  });
});

describe("apiSearch", () => {
  it("trims, leaves out a blank search and cuts one the API would refuse", () => {
    expect(apiSearch("  INV-0042 ")).toBe("INV-0042");
    expect(apiSearch("   ")).toBeUndefined();
    expect(apiSearch("a".repeat(SEARCH_MAX + 5))).toHaveLength(SEARCH_MAX);
  });
});
