import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressBar } from "../../display/progress-bar";
import { DotLoader } from "../dot-loader";
import { Spinner } from "../spinner";
import { SuccessCheck } from "../success-check";

// Loaders must be announced to screen readers, not only animate.
describe("motion components", () => {
  afterEach(() => cleanup());

  it("exposes loaders with their accessible names and roles", () => {
    render(
      <>
        <Spinner label="Loading invoices" />
        <DotLoader />
        <ProgressBar label="Uploading" />
        <SuccessCheck label="Settled" />
      </>,
    );
    expect(screen.getByRole("status", { name: "Loading invoices" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Waiting for the network" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Uploading" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Settled" })).toBeTruthy();
  });
});
