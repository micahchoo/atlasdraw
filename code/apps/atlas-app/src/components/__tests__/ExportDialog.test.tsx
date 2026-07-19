// SPDX-License-Identifier: AGPL-3.0-only
// ExportDialog tests — ported from PrintDialog.test.tsx when the PDF pane
// was absorbed into the unified export surface (IA restructure).
//
// Don't exercise real pdf-lib here — print-pdf.test.ts already covers the
// generator. The PDF pane is tested with an injected `exportPDFImpl` mock so
// we can assert which PrintOptions the dialog forwards.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ExportDialog } from "../ExportDialog";

import type { LayerLegendEntry, PrintOptions } from "../../lib/print-pdf";

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement URL.createObjectURL / anchor.click side-effects;
// stub the two so submit can complete without runtime errors. We assign
// before spying because vi.spyOn requires the property to exist.
function stubUrlAndAnchorClick() {
  if (
    typeof (URL as unknown as { createObjectURL?: unknown }).createObjectURL !==
    "function"
  ) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL =
      () => "blob:mock";
  }
  if (
    typeof (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL !==
    "function"
  ) {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
      () => {};
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

type Overrides = Partial<React.ComponentProps<typeof ExportDialog>>;

function renderDialog(overrides: Overrides = {}) {
  const props = {
    onCloseRequest: vi.fn(),
    onExportPNG: vi.fn(),
    onExportGeoJSON: vi.fn(),
    onExportAtlasdraw: vi.fn(),
    getMapCanvas: () => makeCanvas(),
    layers: LAYERS,
    ...overrides,
  };
  render(<ExportDialog {...props} />);
  return props;
}

describe("ExportDialog", () => {
  it("defaults to the PNG card; export runs the PNG handler and closes", () => {
    const props = renderDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    expect(props.onExportPNG).toHaveBeenCalledTimes(1);
    expect(props.onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it("initialFormat preselects the format card", () => {
    renderDialog({ initialFormat: "pdf" });
    // The PDF pane's settings are visible without clicking the card.
    expect(screen.getByTestId("export-pdf-page-size")).toBeTruthy();
  });

  it("PDF pane renders form fields with correct defaults", () => {
    renderDialog({ initialFormat: "pdf" });
    expect(
      (screen.getByTestId("export-pdf-page-size") as HTMLSelectElement).value,
    ).toBe("letter");
    // Orientation defaults to landscape (more common for maps).
    expect(
      (screen.getByTestId("export-pdf-orientation") as HTMLSelectElement).value,
    ).toBe("landscape");
    expect(
      (screen.getByTestId("export-pdf-title-input") as HTMLInputElement).value,
    ).toBe("Untitled map");
    expect(screen.getByTestId("export-dialog-export")).toBeTruthy();
  });

  it("Escape closes the dialog", () => {
    const props = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it("Cancel button closes the dialog", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByTestId("export-dialog-cancel"));
    expect(props.onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it("PDF export calls exportPDFImpl with the chosen options and closes", async () => {
    const handles = stubUrlAndAnchorClick();
    const exportMock = vi
      .fn<(opts: PrintOptions) => Promise<Blob>>()
      .mockResolvedValue(
        new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
      );
    const canvas = makeCanvas();
    const props = renderDialog({
      initialFormat: "pdf",
      getMapCanvas: () => canvas,
      exportPDFImpl: exportMock,
    });

    // Change a few fields.
    fireEvent.change(screen.getByTestId("export-pdf-page-size"), {
      target: { value: "a4" },
    });
    fireEvent.change(screen.getByTestId("export-pdf-orientation"), {
      target: { value: "portrait" },
    });
    fireEvent.change(screen.getByTestId("export-pdf-title-input"), {
      target: { value: "Trail map" },
    });

    // Submit.
    fireEvent.click(screen.getByTestId("export-dialog-export"));
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
    expect(props.onCloseRequest).toHaveBeenCalled();

    handles.createUrl.mockRestore();
    handles.revokeUrl.mockRestore();
    handles.click.mockRestore();
  });

  it("surfaces an error when the map canvas isn't ready", async () => {
    const exportMock = vi.fn<(opts: PrintOptions) => Promise<Blob>>();
    const props = renderDialog({
      initialFormat: "pdf",
      getMapCanvas: () => null,
      exportPDFImpl: exportMock,
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await Promise.resolve();
    expect(exportMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("export-pdf-error").textContent).toMatch(
      /not ready/i,
    );
    // Errors keep the dialog open so the user can retry.
    expect(props.onCloseRequest).not.toHaveBeenCalled();
  });

  it("falls back to 'Untitled map' when title is whitespace", async () => {
    const handles = stubUrlAndAnchorClick();
    const exportMock = vi
      .fn<(opts: PrintOptions) => Promise<Blob>>()
      .mockResolvedValue(new Blob([], { type: "application/pdf" }));
    renderDialog({
      initialFormat: "pdf",
      layers: [],
      exportPDFImpl: exportMock,
    });
    fireEvent.change(screen.getByTestId("export-pdf-title-input"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await Promise.resolve();
    await Promise.resolve();

    expect(exportMock.mock.calls[0][0].title).toBe("Untitled map");

    handles.createUrl.mockRestore();
    handles.revokeUrl.mockRestore();
    handles.click.mockRestore();
  });
});
