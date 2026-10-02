import React from "react";
import { vi } from "vitest";

import { EXPORT_DATA_TYPES, MIME_TYPES } from "@atlasdraw/common";

import type { ExcalidrawTextElement } from "@atlasdraw/element/types";

import { getDefaultAppState } from "../appState";
import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { fireEvent, queryByTestId, render, waitFor } from "./test-utils";

const { h } = window;

describe("appState", () => {
  it("drag&drop of a scene file changes no appState and hands the file to the host", async () => {
    // Atlasdraw: upstream loaded the file's appState here.
    const exportBackground = !getDefaultAppState().exportBackground;
    const onSceneFileDrop = vi.fn();

    await render(
      <Excalidraw
        initialData={{
          appState: {
            exportBackground,
            viewBackgroundColor: "#F00",
          },
        }}
        onSceneFileDrop={onSceneFileDrop}
      />,
      {},
    );

    await waitFor(() => {
      expect(h.state.exportBackground).toBe(exportBackground);
      expect(h.state.viewBackgroundColor).toBe("#F00");
    });

    await API.drop([
      {
        kind: "file",
        file: new Blob(
          [
            JSON.stringify({
              type: EXPORT_DATA_TYPES.excalidraw,
              appState: {
                viewBackgroundColor: "#000",
              },
              elements: [API.createElement({ type: "rectangle", id: "A" })],
            }),
          ],
          { type: MIME_TYPES.json },
        ),
      },
    ]);

    await waitFor(() => expect(onSceneFileDrop).toHaveBeenCalledTimes(1));
    expect(h.elements).toEqual([]);
    expect(h.state.exportBackground).toBe(exportBackground);
    expect(h.state.viewBackgroundColor).toBe("#F00");
  });

  it("changing fontSize with text tool selected (no element created yet)", async () => {
    const { container } = await render(
      <Excalidraw
        initialData={{
          appState: {
            currentItemFontSize: 30,
          },
        }}
      />,
    );

    UI.clickTool("text");

    expect(h.state.currentItemFontSize).toBe(30);
    fireEvent.click(queryByTestId(container, "fontSize-small")!);
    expect(h.state.currentItemFontSize).toBe(16);

    const mouse = new Pointer("mouse");

    mouse.clickAt(100, 100);

    expect((h.elements[0] as ExcalidrawTextElement).fontSize).toBe(16);
  });
});
