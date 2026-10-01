// SPDX-License-Identifier: AGPL-3.0-only
// Shared print fixtures: a JPEG of any stated size, and a reader that turns
// an exported PDF back into pages of text and drawn images. Used by the
// print-pdf and ExportDialog tests. Change it only with both in view.

import {
  PDFArray,
  PDFDocument,
  PDFName,
  decodePDFRawStream,
  type PDFDict,
} from "pdf-lib";

import type { PDFNumber, PDFRawStream } from "pdf-lib";

// 1×1 white baseline JPEG. pdf-lib reads only the header of a JPEG (it embeds
// the bytes as DCTDecode), so `jpegOfSize` can restate the frame size and the
// PDF reports that size as the image's pixel dimensions.
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAB//2Q==";

/** A JPEG data URL whose SOF0 header says `width` × `height` pixels. */
export function jpegOfSize(width: number, height: number): string {
  const bytes = Uint8Array.from(atob(TINY_JPEG_B64), (c) => c.charCodeAt(0));
  for (let i = 0; i < bytes.length - 8; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0) {
      // FFC0, length (2), precision (1), height (2), width (2).
      bytes[i + 5] = height >> 8;
      bytes[i + 6] = height & 0xff;
      bytes[i + 7] = width >> 8;
      bytes[i + 8] = width & 0xff;
      let bin = "";
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      return `data:image/jpeg;base64,${btoa(bin)}`;
    }
  }
  throw new Error("fixture JPEG has no SOF0 marker");
}

// ---------------------------------------------------------------------------
// Reading a PDF back
// ---------------------------------------------------------------------------

export interface DrawnImage {
  pixelWidth: number;
  pixelHeight: number;
  /** Size on the page, in points. */
  width: number;
  height: number;
}

export interface ReadPage {
  width: number;
  height: number;
  texts: string[];
  images: DrawnImage[];
}

export interface ReadPdf {
  subject: string | undefined;
  pages: ReadPage[];
}

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** WinAnsi bytes to text. Only the non-Latin-1 glyph this module draws is mapped. */
function winAnsi(hex: string): string {
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    out += b === 0x85 ? "…" : String.fromCharCode(b);
  }
  return out;
}

export async function readPdf(blob: Blob): Promise<ReadPdf> {
  const doc = await PDFDocument.load(await blobBytes(blob));
  const pages = doc.getPages().map((page): ReadPage => {
    const contents = page.node.Contents();
    const streams: PDFRawStream[] =
      contents instanceof PDFArray
        ? contents
            .asArray()
            .map((ref) => doc.context.lookup(ref) as PDFRawStream)
        : [contents as unknown as PDFRawStream];
    const ops = streams
      .map((s) =>
        new TextDecoder("latin1").decode(decodePDFRawStream(s).decode()),
      )
      .join("\n");
    const texts = [...ops.matchAll(/<([0-9A-F]*)> Tj/g)].map((m) =>
      winAnsi(m[1]),
    );
    const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject")) as
      | PDFDict
      | undefined;
    // pdf-lib draws an image as: translate, rotate, `w 0 0 h 0 0 cm`, skew, Do.
    const images = [
      ...ops.matchAll(
        /([\d.]+) 0 0 ([\d.]+) 0 0 cm\n1 0 0 1 0 0 cm\n\/(\S+) Do/g,
      ),
    ].map((m): DrawnImage => {
      const stream = xobjects?.lookup(PDFName.of(m[3])) as PDFRawStream;
      const num = (k: string) =>
        (stream.dict.get(PDFName.of(k)) as PDFNumber).asNumber();
      return {
        width: Number(m[1]),
        height: Number(m[2]),
        pixelWidth: num("Width"),
        pixelHeight: num("Height"),
      };
    });
    return { width: page.getWidth(), height: page.getHeight(), texts, images };
  });
  return { subject: doc.getSubject(), pages };
}
