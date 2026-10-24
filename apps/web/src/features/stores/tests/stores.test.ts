import { describe, expect, it } from "vitest";
import { allowsReturnLink } from "@/features/stores/lib/stores";

// R-134: the form refuses what the API would, so the owner sees it on the field.
describe("allowsReturnLink", () => {
  const origins = ["https://shop.example.com", "https://dev.example.com:8443"];

  it.each([
    ["https://shop.example.com/thanks?order=1", true],
    ["https://SHOP.example.com:443/thanks", true],
    ["https://dev.example.com:8443/", true],
    ["https://dev.example.com/", false],
    ["https://shop.example.com.evil.example/", false],
    ["https://evil.example/?next=https://shop.example.com", false],
    ["http://shop.example.com/thanks", false],
    ["shop.example.com/thanks", false],
  ])("%s → %s", (link, allowed) => {
    expect(allowsReturnLink(origins, link)).toBe(allowed);
  });
});
