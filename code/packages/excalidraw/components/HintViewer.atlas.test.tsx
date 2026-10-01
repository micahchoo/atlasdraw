import React from "react";

import { Excalidraw } from "../index";
import { API } from "../tests/helpers/api";
import { act, render, waitFor } from "../tests/test-utils";

// Atlasdraw (docs/architecture/adr/0015-world-coordinates-gate.md): flowchart
// creation steps new nodes by a fixed 100 scene units, under a pixel at map
// zoom, so the editor does not offer it. A selected container hints at text
// only.
describe("hints for a selected shape", () => {
  it("offer text, not a flowchart", async () => {
    const { container } = await render(<Excalidraw />);
    const rect = API.createElement({ type: "rectangle", x: 0, y: 0 });
    act(() => {
      API.setElements([rect]);
      API.setAppState({ selectedElementIds: { [rect.id]: true } });
    });
    await waitFor(() =>
      expect(container.querySelector(".HintViewer")?.textContent).toContain(
        "to add text",
      ),
    );
    expect(container.querySelector(".HintViewer")?.textContent).not.toMatch(
      /flowchart/i,
    );
  });
});
