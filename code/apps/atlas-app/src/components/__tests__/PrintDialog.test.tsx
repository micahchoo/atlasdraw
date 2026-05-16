// SPDX-License-Identifier: AGPL-3.0-only
// Phase 6 A10 — PrintDialog tests.
//
// Don't exercise real pdf-lib here — print-pdf.test.ts already covers the
// generator. The dialog is tested with an injected `exportPDFImpl` mock so we
// can assert which PrintOptions the dialog forwards.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { PrintDialog } from "../PrintDialog";
import type {
  LayerLegendEntry,
  PrintOptions,
} from "../../lib/print-pdf";

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement URL.createObjectURL / anchor.click side-effects;
// stub the two so submit can complete without runtime errors. We assign
// before spying because vi.spyOn requires the property to exist.
function stubUrlAndAnchorClick() {
  if (typeof (URL as unknown as { createObjectURL?: unknown }).createObjectURL !== "function") {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
  }
  if (typeof (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL !== "function") {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
  const createUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:mock");
  const revokeUrl = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => {});
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  return { createUrl, revokeUrl, click };
}

const LAYERS: LayerLegendEntry[] = [
  { id: "dl:a", name: "Trails", color: "#0aa" },
];

function makeCanvas(): HTMLCanvasElement {
  return {
    toDataURL: () => "data:image/jpeg;base64,/9j/4AAQ",
  } as unknown as HTMLCanvasElement;
}

describe("PrintDialog", () => {
  it("renders all form fields with correct defaults", () => {
    render(
      <PrintDialog
        getMapCanvas={() => makeCanvas()}
        layers={LAYERS}
        onCloseRequest={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Page size radios.
    expect(
      (screen.getByTestId("print-dialog-page-size-letter") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByTestId("print-dialog-page-size-a4") as HTMLInputElement)
        .checked,
    ).toBe(false);
    // Orientation toggle defaults to landscape (more common for maps).
    expect(
      (
        screen.getByTestId(
          "print-dialog-orientation-landscape",
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // Default title.
    const titleInput = screen.getByTestId(
      "print-dialog-title-input",
    ) as HTMLInputElement;
    expect(titleInput.value).toBe("Untitled map");
    // Submit button visible.
    expect(screen.getByTestId("print-dialog-submit")).toBeTruthy();
  });

  it("Escape closes the dialog", () => {
    const onClose = vi.fn();
    render(
      <PrintDialog
        getMapCanvas={() => makeCanvas()}
        layers={LAYERS}
        onCloseRequest={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel button closes the dialog", () => {
    const onClose = vi.fn();
    render(
      <PrintDialog
        getMapCanvas={() => makeCanvas()}
        layers={LAYERS}
        onCloseRequest={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("print-dialog-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submit calls exportPDFImpl with the chosen options and closes the dialog", async () => {
    const handles = stubUrlAndAnchorClick();
    const exportMock = vi
      .fn<(opts: PrintOptions) => Promise<Blob>>()
      .mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }));
    const onClose = vi.fn();
    const canvas = makeCanvas();
    render(
      <PrintDialog
        getMapCanvas={() => canvas}
        layers={LAYERS}
        onCloseRequest={onClose}
        exportPDFImpl={exportMock}
      />,
    );

    // Change a few fields.
    fireEvent.click(screen.getByTestId("print-dialog-page-size-a4"));
    fireEvent.click(screen.getByTestId("print-dialog-orientation-portrait"));
    const titleInput = screen.getByTestId(
      "print-dialog-title-input",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Trail map" } });

    // Submit.
    fireEvent.click(screen.getByTestId("print-dialog-submit"));
    // Wait one microtask flush for the promise to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(exportMock).toHaveBeenCalledTimes(1);
    const opts = exportMock.mock.calls[0][0];
    expect(opts.pageSize).toBe("a4");
    expect(opts.orientation).toBe("portrait");
    expect(opts.title).toBe("Trail map");
    expect(opts.mapCanvas).toBe(canvas);
    expect(opts.layers).toEqual(LAYERS);

    // Download path side-effects ran.
    expect(handles.createUrl).toHaveBeenCalled();
    expect(handles.click).toHaveBeenCalled();
    expect(handles.revokeUrl).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();

    handles.createUrl.mockRestore();
    handles.revokeUrl.mockRestore();
    handles.click.mockRestore();
  });

  it("surfaces an error when the map canvas isn't ready", async () => {
    const exportMock = vi.fn<(opts: PrintOptions) => Promise<Blob>>();
    render(
      <PrintDialog
        getMapCanvas={() => null}
        layers={LAYERS}
        onCloseRequest={() => {}}
        exportPDFImpl={exportMock}
      />,
    );
    fireEvent.click(screen.getByTestId("print-dialog-submit"));
    await Promise.resolve();
    expect(exportMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("print-dialog-error").textContent).toMatch(
      /not ready/i,
    );
  });

  it("falls back to 'Untitled map' when title is whitespace", async () => {
    const handles = stubUrlAndAnchorClick();
    const exportMock = vi
      .fn<(opts: PrintOptions) => Promise<Blob>>()
      .mockResolvedValue(new Blob([], { type: "application/pdf" }));
    render(
      <PrintDialog
        getMapCanvas={() => makeCanvas()}
        layers={[]}
        onCloseRequest={() => {}}
        exportPDFImpl={exportMock}
      />,
    );
    const titleInput = screen.getByTestId(
      "print-dialog-title-input",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("print-dialog-submit"));
    await Promise.resolve();
    await Promise.resolve();

    expect(exportMock.mock.calls[0][0].title).toBe("Untitled map");

    handles.createUrl.mockRestore();
    handles.revokeUrl.mockRestore();
    handles.click.mockRestore();
  });
});
