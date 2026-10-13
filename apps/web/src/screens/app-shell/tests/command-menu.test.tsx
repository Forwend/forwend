// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/features/profiles/types/profile";
import { CommandMenu } from "@/screens/app-shell/command-menu";
import { makeStore } from "@/store/store";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
}));

const profile = { profileId: "p1", kind: "personal", name: null } as unknown as Profile;

afterEach(cleanup);

describe("CommandMenu", () => {
  it("ignores a keydown with no key, as browser autofill sends, and still opens on Ctrl+K", () => {
    const onOpenChange = vi.fn();
    render(
      <Provider store={makeStore({ getAccessToken: async () => "token" })}>
        <CommandMenu
          open={false}
          onOpenChange={onOpenChange}
          profiles={[profile]}
          active={profile}
          onSwitch={vi.fn()}
          onReceive={vi.fn()}
          onRequest={vi.fn()}
        />
      </Provider>,
    );
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);
    window.dispatchEvent(new Event("keydown"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "K", ctrlKey: true }));
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
