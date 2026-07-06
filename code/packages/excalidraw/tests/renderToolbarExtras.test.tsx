import { Excalidraw } from "../index";

import { render } from "./test-utils";

// Atlasdraw addition (ADR-0010): the `renderToolbarExtras` prop injects
// app-provided content INSIDE the shapes toolbar Island, after the tool
// buttons. The atlas app uses it to place its geo-search control on the same
// toolbar as the drawing tools. This pins the vendored slot end-to-end — the
// one seam atlas-side unit tests mock away.

describe("renderToolbarExtras", () => {
  it("injects app content inside the .App-toolbar island", async () => {
    const { container } = await render(
      <Excalidraw
        renderToolbarExtras={() => (
          <div data-testid="toolbar-extra-probe">probe</div>
        )}
      />,
    );

    const toolbar = container.querySelector(".App-toolbar");
    expect(toolbar).not.toBeNull();
    expect(
      toolbar!.querySelector('[data-testid="toolbar-extra-probe"]'),
    ).not.toBeNull();
  });

  it("renders no extra node when the prop is omitted", async () => {
    const { container } = await render(<Excalidraw />);
    expect(
      container.querySelector('[data-testid="toolbar-extra-probe"]'),
    ).toBeNull();
  });
});
