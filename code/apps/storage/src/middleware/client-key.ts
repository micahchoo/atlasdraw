// The key the per-address limits count by.
//
// An IPv4 client is its address. An IPv6 client is its /64: one host is
// usually given a whole /64, so it can use a new address for every request.

import { isIPv6 } from "node:net";

/** The first four hextets of an IPv6 address, zero-filled, as `a:b:c:d::/64`. */
function prefix64(ip: string): string {
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // A trailing dotted quad (::ffff:1.2.3.4) fills two hextets.
  const width = (parts: string[]) =>
    parts.reduce((n, p) => n + (p.includes(".") ? 2 : 1), 0);
  const fill = ip.includes("::") ? 8 - width(left) - width(right) : 0;
  const hextets = [...left, ...Array<string>(fill).fill("0"), ...right];
  const net = hextets
    .slice(0, 4)
    .map((h) => (parseInt(h, 16) || 0).toString(16))
    .join(":");
  return `${net}::/64`;
}

export function clientKey(ip: string | undefined): string {
  if (!ip) {
    return "unknown";
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) {
    return mapped[1]!;
  }
  return isIPv6(ip) ? prefix64(ip) : ip;
}
