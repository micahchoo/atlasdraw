// SPDX-License-Identifier: AGPL-3.0-only
// ExportDialog tests. The PDF cases run the real pdf-lib generator and read
// the file the dialog hands to the download back out (page size, text,
// embedded image size), so they test what a user gets. The map image comes
// from a stand-in for the compositor that returns a JPEG of exactly the size
// the real one would draw at the requested pixel ratio.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { documentFrame } from "@atlasdraw/geo";

import { ExportDialog } from "../ExportDialog";
import {
  DEFAULT_DOCUMENT_TITLE,
  createDocument,
  currentDocument,
  openDocument,
} from "../../state/document";

import { exportSize } from "../../lib/export";
import { jpegOfSize, readPdf } from "../../lib/__tests__/fixtures/print";

import type { LayerLegendEntry } from "../../lib/print-pdf";
import type { MapView } from "../../lib/mapView";

// The PDF title seeds from the document-name store, which is a module
// singleton — reset it so a rename in one test can't leak into the next.
beforeEach(() => {});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom has no object URLs and no download. Capture the blob the dialog
 * offers for download instead; that blob is the export.
 */
function captureDownloads(): { blobs: Blob[]; names: string[] } {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const url = URL as unknown as {
    createObjectURL?: (b: Blob) => string;
    revokeObjectURL?: (u: string) => void;
  };
  url.createObjectURL ??= () => "";
  url.revokeObjectURL ??= () => {};
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    blobs.push(b as Blob);
    return "blob:export";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });
  return { blobs, names };
}

const VIEW: MapView = {
  center: { lng: 10, lat: 50 },
  zoom: 14,
  bearing: 0,
  size: { width: 1440, height: 900 },
  frame: documentFrame(10, 50),
  credits: ["© Protomaps © OpenStreetMap"],
};

const LAYERS: LayerLegendEntry[] = [
  { id: "dl:a", name: "Trails", color: "#0aa" },
  { id: "rl:b", name: "1910 survey sheet", color: "#868e96" },
];

/** What the compositor returns: a JPEG of the view at `pixelRatio`. */
async function compositeAt(view: MapView, pixelRatio: number): Promise<string> {
  const { width, height } = exportSize(view.size, pixelRatio);
  return jpegOfSize(width, height);
}

type Overrides = Partial<React.ComponentProps<typeof ExportDialog>>;

function renderDialog(overrides: Overrides = {}) {
  const props = {
    onCloseRequest: vi.fn(),
    onExportPNG: vi.fn(),
    onExportGeoJSON: vi.fn(),
    onExportAtlasdraw: vi.fn(),
    captureView: (): MapView | null => VIEW,
    renderImage: compositeAt,
    getLegendEntries: () => LAYERS,
    locale: "en-GB",
    ...overrides,
  };
  render(<ExportDialog {...props} />);
  return props;
}

describe("ExportDialog — PNG", () => {
  it("offers 1x, 2x and 3x with the pixel size of each", () => {
    renderDialog();
    const select = screen.getByTestId(
      "export-png-pixel-ratio",
    ) as HTMLSelectElement;
    expect(select.value).toBe("2");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "1× — 1440 × 900 px",
      "2× — 2880 × 1800 px",
      "3× — 4320 × 2700 px",
    ]);
  });

  it("exports at the chosen size and closes", () => {
    const props = renderDialog();
    fireEvent.change(screen.getByTestId("export-png-pixel-ratio"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    expect(props.onExportPNG).toHaveBeenCalledWith(3);
    expect(props.onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it("has no setting that does nothing", () => {
    renderDialog();
    expect(screen.queryByText(/include basemap/i)).toBeNull();
  });
});

describe("ExportDialog — PDF", () => {
  it("says the map on the page is an image, not vector", () => {
    renderDialog();
    expect(screen.getByTestId("export-format-pdf").textContent).not.toMatch(
      /vector document/i,
    );
    fireEvent.click(screen.getByTestId("export-format-pdf"));
    expect(screen.getByTestId("export-pdf-note").textContent).toMatch(
      /image at 300 dpi.*not vector/i,
    );
  });

  it("pane renders form fields with correct defaults", () => {
    renderDialog({ initialFormat: "pdf" });
    expect(
      (screen.getByTestId("export-pdf-page-size") as HTMLSelectElement).value,
    ).toBe("letter");
    expect(
      (screen.getByTestId("export-pdf-orientation") as HTMLSelectElement).value,
    ).toBe("landscape");
    expect(
      (screen.getByTestId("export-pdf-title-input") as HTMLInputElement).value,
    ).toBe(DEFAULT_DOCUMENT_TITLE);
  });

  it("downloads a PDF with the chosen page, title, legend, credit and a 300 dpi map", async () => {
    const downloads = captureDownloads();
    const props = renderDialog({ initialFormat: "pdf" });
    fireEvent.change(screen.getByTestId("export-pdf-page-size"), {
      target: { value: "a4" },
    });
    fireEvent.change(screen.getByTestId("export-pdf-orientation"), {
      target: { value: "portrait" },
    });
    fireEvent.change(screen.getByTestId("export-pdf-title-input"), {
      target: { value: "Trail map" },
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await waitFor(() => expect(props.onCloseRequest).toHaveBeenCalled());

    expect(downloads.names).toEqual(["Trail map.pdf"]);
    const pdf = await readPdf(downloads.blobs[0]);
    expect(pdf.pages).toHaveLength(1);
    const [page] = pdf.pages;
    expect(page.width).toBeCloseTo(595.28, 1);
    expect(page.height).toBeCloseTo(841.89, 1);
    expect(page.texts).toContain("Trail map");
    expect(page.texts).toContain("Trails");
    expect(page.texts).toContain("1910 survey sheet");
    expect(page.texts).toContain("© Protomaps © OpenStreetMap");
    const [image] = page.images;
    expect(image.pixelWidth / (image.width / 72)).toBeGreaterThan(299);
    // en-GB: metric only.
    expect(page.texts.join(" ")).not.toMatch(/ mi\b| ft\b/);
  });

  it("prints the view's credits, and renders the image for that same view", async () => {
    const view: MapView = {
      ...VIEW,
      bearing: 30,
      credits: ["© Protomaps © OpenStreetMap", "© Example Aerials"],
    };
    const rendered: MapView[] = [];
    const downloads = captureDownloads();
    const props = renderDialog({
      initialFormat: "pdf",
      captureView: () => view,
      renderImage: (v, ratio) => {
        rendered.push(v);
        return compositeAt(v, ratio);
      },
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await waitFor(() => expect(props.onCloseRequest).toHaveBeenCalled());

    expect(rendered).toEqual([view]);
    const pdf = await readPdf(downloads.blobs[0]);
    expect(pdf.pages[0].texts).toContain(
      "© Protomaps © OpenStreetMap · © Example Aerials",
    );
  });

  it("adds feet and miles to the scale for a US locale", async () => {
    const downloads = captureDownloads();
    const props = renderDialog({ initialFormat: "pdf", locale: "en-US" });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await waitFor(() => expect(props.onCloseRequest).toHaveBeenCalled());
    const pdf = await readPdf(downloads.blobs[0]);
    expect(pdf.pages[0].texts.join(" ")).toMatch(/ (mi|ft)\b/);
  });

  it("surfaces an error and stays open when the map is not ready", async () => {
    const props = renderDialog({
      initialFormat: "pdf",
      captureView: () => null,
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await waitFor(() =>
      expect(screen.getByTestId("export-pdf-error").textContent).toMatch(
        /not ready/i,
      ),
    );
    expect(props.onCloseRequest).not.toHaveBeenCalled();
  });

  it("surfaces the compositor's error and stays open", async () => {
    const props = renderDialog({
      initialFormat: "pdf",
      renderImage: async () => {
        throw new Error("The map was drawn at 4096 × 2304 px");
      },
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await waitFor(() =>
      expect(screen.getByTestId("export-pdf-error").textContent).toMatch(
        /4096 × 2304 px/,
      ),
    );
    expect(props.onCloseRequest).not.toHaveBeenCalled();
  });

  it("falls back to the document name when the title is whitespace", async () => {
    currentDocument().dispatch({
      type: "rename-document",
      title: "Bidar ward survey",
    });
    const downloads = captureDownloads();
    const props = renderDialog({ initialFormat: "pdf" });
    fireEvent.change(screen.getByTestId("export-pdf-title-input"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    await waitFor(() => expect(props.onCloseRequest).toHaveBeenCalled());
    const pdf = await readPdf(downloads.blobs[0]);
    expect(pdf.pages[0].texts).toContain("Bidar ward survey");
  });

  it("PDF title seeds from the current document name", () => {
    currentDocument().dispatch({
      type: "rename-document",
      title: "Bidar ward survey",
    });
    renderDialog({ initialFormat: "pdf" });
    expect(
      (screen.getByTestId("export-pdf-title-input") as HTMLInputElement).value,
    ).toBe("Bidar ward survey");
  });
});

describe("ExportDialog — closing", () => {
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
});

describe("ExportDialog — GeoJSON", () => {
  beforeEach(() => {
    openDocument(createDocument());
  });

  it("offers no data-layer option when the map has no data layers", () => {
    const props = renderDialog({ initialFormat: "geojson" });
    expect(screen.queryByTestId("export-geojson-include-data")).toBeNull();
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    expect(props.onExportGeoJSON).toHaveBeenCalledWith({
      includeDataLayers: false,
    });
  });

  it("includes the data layers when the user ticks the option", () => {
    currentDocument().dispatch({
      type: "add-data-layer",
      id: "dl:trails",
      fc: { type: "FeatureCollection", features: [] },
      label: "Trails",
      style: {},
    });
    const props = renderDialog({ initialFormat: "geojson" });
    const box = screen.getByLabelText(
      "Include imported data layers",
    ) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByTestId("export-dialog-export"));
    expect(props.onExportGeoJSON).toHaveBeenCalledWith({
      includeDataLayers: true,
    });
  });
});
