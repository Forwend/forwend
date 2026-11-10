import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TIMELINE_STATES, Timeline } from "../timeline";

describe("Timeline", () => {
  it("fills a working step's ring with its share, and keeps a waiting step's ring still", () => {
    const { container } = render(
      <Timeline
        label="Progress"
        entries={[
          {
            id: "a",
            title: "Received",
            state: TIMELINE_STATES.done,
            aside: <a href="/tx">0xabc</a>,
            description: <span>1.23 USDC</span>,
          },
          {
            id: "b",
            title: "Confirming",
            state: TIMELINE_STATES.current,
            working: true,
            progress: 0.25,
          },
          { id: "c", title: "Waiting on you", state: TIMELINE_STATES.current },
        ]}
      />,
    );
    const [done, working, waiting] = container.querySelectorAll("li");
    expect(done?.textContent).toContain("Done: Received");
    expect(done?.querySelector("a")?.getAttribute("href")).toBe("/tx");
    const ring = working?.querySelector<HTMLElement>('[style*="--fw-share"]');
    expect(ring?.style.getPropertyValue("--fw-share")).toBe("0.25");
    expect(working?.querySelector('[class*="fw-spin"]')).toBeNull();
    expect(waiting?.querySelector('[style*="--fw-share"], [class*="fw-spin"]')).toBeNull();
  });

  it("turns a working step's ring while no share is known", () => {
    const { container } = render(
      <Timeline
        label="Progress"
        entries={[{ id: "a", title: "Converting", state: TIMELINE_STATES.current, working: true }]}
      />,
    );
    expect(container.querySelector('li [class*="fw-spin"]')).not.toBeNull();
  });
});
