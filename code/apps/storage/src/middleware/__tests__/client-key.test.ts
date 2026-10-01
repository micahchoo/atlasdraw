import { describe, expect, it } from "vitest";

import { clientKey } from "../client-key";

describe("clientKey", () => {
  it("keeps an IPv4 address whole", () => {
    expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("reads an IPv4-mapped IPv6 address as IPv4", () => {
    expect(clientKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it.each([
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:ffff:eeee:dddd:cccc", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
  ])("keys %s by its /64", (ip, key) => {
    expect(clientKey(ip)).toBe(key);
  });

  it("gives every address in one /64 the same key", () => {
    expect(clientKey("2001:db8:1:2::1")).toBe(
      clientKey("2001:db8:1:2:a:b:c:d"),
    );
    expect(clientKey("2001:db8:1:2::1")).not.toBe(clientKey("2001:db8:1:3::1"));
  });
});
