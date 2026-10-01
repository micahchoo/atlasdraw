// SPDX-License-Identifier: AGPL-3.0-only
//
// A document through the gate, for tests of what takes only an admitted
// one (loadDocument, fromFile). A refusal fails the test that asked.

import { admit, type Admitted } from "../../documentGate";

/** The first bytes of a PNG: enough for the gate to call a file an image. */
export const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

export async function admittedOf(input: unknown): Promise<Admitted> {
  const result = await admit(input, "file");
  if (!result.ok) {
    throw new Error(`the gate refused a test document: ${result.reason}`);
  }
  return result;
}
