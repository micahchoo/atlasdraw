// SPDX-License-Identifier: AGPL-3.0-only
//
// downloadBlob — save a Blob as a file through the browser's download.
//
// The same <a download> on a blob URL that the PNG, PDF and GeoJSON exports
// and the .atlasdraw save fallback each write inline. New download paths use
// this one.

export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
