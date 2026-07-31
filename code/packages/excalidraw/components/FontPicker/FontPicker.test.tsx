import { KEYS } from "@atlasdraw/common";

// `../../index`, not `../..` — FU-8. A bare `../..` resolves the package
// DIRECTORY, so Vite reads packages/excalidraw/package.json and follows
// `main` to ./dist/prod/index.js. With no dist/ that silently falls back to
// this same source file and everything passes; once `test:typecheck` has
// built dist/, the test loads the BUNDLE instead and dies on a null
// useTunnels. Naming the entry file removes the dependency on build state.
import { Excalidraw } from "../../index";
import { Keyboard } from "../../tests/helpers/ui";
import { act, render } from "../../tests/test-utils";

describe("FontPicker", () => {
  it("should be able to open font picker", async () => {
    (global as any).ResizeObserver =
      (global as any).ResizeObserver ||
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };

    const { queryByTestId } = await render(
      <Excalidraw handleKeyboardGlobally={true} />,
    );

    Keyboard.keyPress(KEYS.T);

    const fontPickerTrigger = queryByTestId("font-family-show-fonts");

    expect(fontPickerTrigger).not.toBeNull();

    act(() => {
      fontPickerTrigger!.click();
    });
  });
});
