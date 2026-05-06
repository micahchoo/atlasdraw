// SPDX-License-Identifier: MPL-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock maplibre-gl BEFORE importing the module under test so the import-time
// reference to `addProtocol` resolves to our spy.
vi.mock("maplibre-gl", () => {
  return {
    default: {
      addProtocol: vi.fn(),
    },
  };
});

vi.mock("pmtiles", () => {
  return {
    Protocol: class {
      tile = vi.fn();
    },
  };
});

import maplibregl from "maplibre-gl";

import {
  __resetPmtilesProtocolForTests,
  registerPmtilesProtocol,
} from "../pmtiles-protocol";

describe("registerPmtilesProtocol", () => {
  beforeEach(() => {
    (maplibregl.addProtocol as ReturnType<typeof vi.fn>).mockClear();
    __resetPmtilesProtocolForTests();
  });

  it("registers the pmtiles scheme on first call", () => {
    registerPmtilesProtocol();
    expect(maplibregl.addProtocol).toHaveBeenCalledTimes(1);
    expect(
      (maplibregl.addProtocol as ReturnType<typeof vi.fn>).mock.calls[0][0],
    ).toBe("pmtiles");
  });

  it("is idempotent — second call does NOT re-register", () => {
    registerPmtilesProtocol();
    registerPmtilesProtocol();
    registerPmtilesProtocol();
    expect(maplibregl.addProtocol).toHaveBeenCalledTimes(1);
  });
});
