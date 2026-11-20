import { describe, expect, it } from "vitest";
import { allowsReturnLink } from "@/features/stores/lib/stores";

describe("allowsReturnLink", () => {
  const origins = [
    "https://shop.example.com",
    "https://dev.example.com:8443",
    "http://localhost:3000",
  ];

  it.each([
    ["https://shop.example.com/thanks?order=1", true],
    ["https://SHOP.example.com:443/thanks", true],
    ["https://dev.example.com:8443/", true],
    ["https://dev.example.com/", false],
    ["https://shop.example.com.evil.example/", false],
    ["https://evil.example/?next=https://shop.example.com", false],
    ["http://shop.example.com/thanks", false],
    ["shop.example.com/thanks", false],
    ["http://localhost:3000/thanks", false],
  ])("%s → %s", (link, allowed) => {
    expect(allowsReturnLink(origins, link)).toBe(allowed);
  });
});
