// SPDX-License-Identifier: AGPL-3.0-only
//
// Ask the user for one file with the browser's file picker.

/**
 * Show the file picker for the types in `accept`. Resolves with the picked
 * file, or null when the user cancels. The input is removed either way.
 *
 * A type missing from `accept` is hidden in the picker, even when a drop of
 * that file would work.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    const settle = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => settle(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => settle(null));
    document.body.appendChild(input);
    input.click();
  });
}
