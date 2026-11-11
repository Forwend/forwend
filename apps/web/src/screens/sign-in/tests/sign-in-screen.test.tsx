// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInScreen } from "@/screens/sign-in/sign-in-screen";
import { APP_ROUTES } from "@/shared/config/routes";

const auth = vi.hoisted(() => ({ ready: true, authenticated: false }));
const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  searchParams: new URLSearchParams(),
}));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.searchParams,
}));
vi.mock("@/features/auth/components/sign-in-form", () => ({ SignInForm: () => null }));
vi.mock("@/shared/components/landscape-page/landscape-page", () => ({
  LandscapePage: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => {
  auth.ready = true;
  auth.authenticated = false;
  navigation.searchParams = new URLSearchParams();
  navigation.router.replace.mockReset();
});
afterEach(cleanup);

describe("sign-in navigation", () => {
  it("opens the app after Google's callback cleanup interrupts the first navigation", () => {
    navigation.searchParams = new URLSearchParams("privy_oauth_code=test");
    const { rerender } = render(<SignInScreen />);
    auth.authenticated = true;
    rerender(<SignInScreen />);
    expect(navigation.router.replace).toHaveBeenCalledWith(APP_ROUTES.home);

    // Privy's history.replaceState cancels a pending Next.js navigation and updates useSearchParams.
    navigation.router.replace.mockClear();
    navigation.searchParams = new URLSearchParams();
    rerender(<SignInScreen />);
    expect(navigation.router.replace).toHaveBeenCalledWith(APP_ROUTES.home);
  });

  it("opens the app after email sign-in without a callback URL", () => {
    const { rerender } = render(<SignInScreen />);
    expect(navigation.router.replace).not.toHaveBeenCalled();
    auth.authenticated = true;
    rerender(<SignInScreen />);
    expect(navigation.router.replace).toHaveBeenCalledWith(APP_ROUTES.home);
  });

  it("waits until Privy has restored an existing session", () => {
    auth.ready = false;
    auth.authenticated = true;
    const { rerender } = render(<SignInScreen />);
    expect(navigation.router.replace).not.toHaveBeenCalled();
    auth.ready = true;
    rerender(<SignInScreen />);
    expect(navigation.router.replace).toHaveBeenCalledWith(APP_ROUTES.home);
  });
});
