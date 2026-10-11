import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, ToastProvider, useToast } from "../toast";

function ShowButton() {
  const toast = useToast();
  const n = useRef(0);
  return (
    <button
      type="button"
      onClick={() => {
        n.current += 1;
        toast({ title: `Toast ${n.current}` });
      }}
    >
      Show
    </button>
  );
}

function setup() {
  render(
    <ToastProvider>
      <ShowButton />
    </ToastProvider>,
  );
  const show = () => fireEvent.click(screen.getByRole("button", { name: "Show" }));
  const region = screen.getByRole("region", { name: "Notifications" });
  return { show, region };
}

describe("ToastProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("announces toasts politely and keeps the newest three", () => {
    const { show, region } = setup();
    expect(region.querySelector("[aria-live='polite']")).toBeTruthy();
    for (let i = 0; i < 4; i++) show();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Toast 2",
      "Toast 3",
      "Toast 4",
    ]);
  });

  it("closes after TOAST_MS, but not while hovered or focused", () => {
    const { show } = setup();
    show();
    const item = screen.getByRole("listitem");
    fireEvent.pointerEnter(item);
    act(() => vi.advanceTimersByTime(TOAST_MS * 2));
    expect(screen.queryByRole("listitem")).toBeTruthy();
    fireEvent.pointerLeave(item);
    fireEvent.focus(screen.getByRole("button", { name: "Close notification" }));
    act(() => vi.advanceTimersByTime(TOAST_MS * 2));
    expect(screen.queryByRole("listitem")).toBeTruthy();
    fireEvent.blur(screen.getByRole("button", { name: "Close notification" }));
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("closes from its close button", () => {
    const { show } = setup();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
