/**
 * Keyboard-only journeys. Focus order and where focus lands are the
 * browser's to decide, so they are measured here and not in jsdom.
 *
 * Every journey starts from a known focused element and uses only keys. The
 * drawing itself holds Tab (the fork's Tab handler, R3's to fix), so no
 * journey tabs through the canvas.
 */

import { test, expect, type Locator, type Page } from "@playwright/test";

import { openEditor } from "./helpers/atlas";

const MOD = "ControlOrMeta";
const MOD_LABEL = process.platform === "darwin" ? "⌘" : "Ctrl";

// Headless Chromium has the File System Access pickers, and a native picker
// waits for a person. Without them a save is a download and an open is a
// file input that Playwright sees, as in map-ownership.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
});

/** True when the focused element is inside `container`. */
async function focusIn(container: Locator): Promise<boolean> {
  return container.evaluate((el) => el.contains(document.activeElement));
}

/** The data-testid of the focused element, or its tag. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute("data-testid") ?? el?.tagName ?? "";
  });
}

/** Open a command from the palette, by keys only. */
async function runFromPalette(page: Page, words: string): Promise<void> {
  await page.keyboard.press(`${MOD}+k`);
  await expect(
    page.getByRole("combobox", { name: "Search commands" }),
  ).toBeFocused();
  await page.keyboard.type(words);
  await page.keyboard.press("Enter");
}

test.describe("the palette", () => {
  test("is a labelled combobox: arrows move the active option, Enter runs it, focus goes back", async ({
    page,
  }) => {
    await openEditor(page);
    const pin = page.getByTestId("pin-tool-button");
    await pin.focus();

    await page.keyboard.press(`${MOD}+k`);
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    const box = dialog.getByRole("combobox", { name: "Search commands" });
    await expect(box).toBeFocused();
    await expect(dialog.getByRole("listbox")).toBeVisible();

    const first = await box.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    await expect(page.locator(`[id="${first}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ArrowDown");
    const second = await box.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    await expect(page.locator(`[id="${second}"]`)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Tab stays in the palette; Escape closes it from anywhere in it.
    await page.keyboard.press("Tab");
    expect(await focusIn(dialog)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(pin).toBeFocused();

    // A command that opens a dialog: focus goes back to the first opener.
    await runFromPalette(page, "About");
    const about = page.getByRole("dialog", { name: "About Atlasdraw" });
    await expect(about).toBeVisible();
    expect(await focusIn(about)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(about).toHaveCount(0);
    await expect(pin).toBeFocused();
  });

  test("Ctrl+K closes it again", async ({ page }) => {
    await openEditor(page);
    await page.keyboard.press(`${MOD}+k`);
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
    await page.keyboard.press(`${MOD}+k`);
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toHaveCount(0);
  });
});

const MENU_DIALOGS: ReadonlyArray<{ item: string; name: string }> = [
  { item: "main-menu-settings", name: "Settings" },
  { item: "main-menu-about", name: "About Atlasdraw" },
  { item: "main-menu-shortcuts", name: "Keyboard shortcuts" },
  { item: "main-menu-my-maps", name: "My maps" },
  { item: "main-menu-export", name: "Export" },
  { item: "main-menu-share", name: "Share map" },
];

test.describe("every dialog from the main menu", () => {
  for (const { item, name } of MENU_DIALOGS) {
    test(`${name}: opens by keys, keeps Tab inside, closes on Escape, gives focus back to the menu`, async ({
      page,
    }) => {
      await openEditor(page);
      const trigger = page.getByTestId("main-menu-trigger");
      await trigger.focus();
      await page.keyboard.press("Enter");
      const entry = page.getByTestId(item);
      await expect(entry).toBeVisible();
      await entry.focus();
      await page.keyboard.press("Enter");

      const dialog = page.getByRole("dialog", { name });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect.poll(() => focusIn(dialog)).toBe(true);

      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab");
        expect(await focusIn(dialog), `after key ${i + 1}`).toBe(true);
      }

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }

  test("the menu's trigger has a name", async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId("main-menu-trigger")).toHaveAccessibleName(
      "Menu",
    );
  });
});

test.describe("a question while a tool is on", () => {
  test("Measure on: Enter on Cancel answers the question, Escape closes it, Measure stays", async ({
    page,
  }) => {
    await openEditor(page);
    await page.keyboard.press("m");
    const measure = page.getByTestId("measure-tool-bar");
    await expect(measure).toBeVisible();

    await runFromPalette(page, "Clear the drawing");
    const question = page.getByRole("alertdialog", {
      name: "Clear the drawing?",
    });
    await expect(question).toBeVisible();
    await expect(page.getByTestId("confirm-dialog-cancel")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(question).toHaveCount(0);
    await expect(measure).toBeVisible();

    await runFromPalette(page, "Clear the drawing");
    await expect(question).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(question).toHaveCount(0);
    await expect(measure).toBeVisible();

    // With no dialog open, Escape is the tool's again.
    await page.keyboard.press("Escape");
    await expect(measure).toHaveCount(0);
  });

  test("Ctrl+O over a question does nothing: the question stays", async ({
    page,
  }) => {
    await openEditor(page);
    await runFromPalette(page, "Clear the drawing");
    const question = page.getByRole("alertdialog", {
      name: "Clear the drawing?",
    });
    await expect(question).toBeVisible();
    let chooser = false;
    page.on("filechooser", () => {
      chooser = true;
    });

    await page.keyboard.press(`${MOD}+o`);
    await page.keyboard.press(`${MOD}+k`);

    await expect(question).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toHaveCount(0);
    expect(chooser).toBe(false);
  });

  test("Escape cancels the Pin tool", async ({ page }) => {
    await openEditor(page);
    await runFromPalette(page, "Pin to map");
    await expect(page.getByTestId("atlas-tool-overlay")).toBeVisible();
    await expect(page.getByTestId("tool-options-bar")).toContainText(
      "Escape to cancel",
    );

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("atlas-tool-overlay")).toHaveCount(0);
  });
});

test.describe("toasts", () => {
  test("the live regions are there before the first toast, and a toast is read out", async ({
    page,
  }) => {
    await openEditor(page);
    const polite = page.getByTestId("toast-status");
    const alert = page.getByTestId("toast-alert");
    await expect(polite).toHaveAttribute("role", "status");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(polite).toBeEmpty();

    const download = page.waitForEvent("download");
    await page.keyboard.press(`${MOD}+s`);
    await download;
    await expect(polite).toContainText("Map saved");
  });

  test("an error is an alert, and a toast stays while the pointer is on it", async ({
    page,
  }) => {
    await openEditor(page);
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press(`${MOD}+o`);
    await (
      await chooser
    ).setFiles({
      name: "broken.atlasdraw",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not a map"),
    });
    const alert = page.getByTestId("toast-alert");
    await expect(alert.getByTestId("toast-error")).toBeVisible();

    await alert.getByTestId("toast-error").hover();
    await page.waitForTimeout(5000);
    await expect(alert.getByTestId("toast-error")).toBeVisible();

    await page.mouse.move(5, 5);
    await expect(alert.getByTestId("toast-error")).toHaveCount(0, {
      timeout: 8000,
    });
  });
});

test.describe("keys are shown as this platform types them", () => {
  test("the palette hint and the drawing's keys say Ctrl or ⌘ as the platform does", async ({
    page,
  }) => {
    await openEditor(page);
    await expect(page.getByTestId("collar-tools")).toContainText(
      process.platform === "darwin" ? "⌘K" : "Ctrl+K",
    );

    await page.keyboard.press("Shift+?");
    const panel = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(panel.getByTestId("shortcut-row-Undo")).toContainText(
      MOD_LABEL,
    );
    await expect(panel.getByTestId("shortcut-row-Undo")).not.toContainText(
      MOD_LABEL === "Ctrl" ? "⌘" : "Ctrl",
    );
  });
});

test.describe("onboarding", () => {
  test("is a dialog: focus goes in, Skip is reachable, commands wait, Escape ends it for good", async ({
    page,
  }) => {
    await page.goto("/");
    const tour = page.getByRole("dialog", { name: "Welcome to Atlasdraw" });
    await expect(tour).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => focusIn(tour)).toBe(true);

    // Skip is reachable by Tab, and Tab stays in the tour.
    let reached = false;
    for (let i = 0; i < 4; i += 1) {
      if ((await focused(page)) === "onboarding-skip") {
        reached = true;
        break;
      }
      await page.keyboard.press("Tab");
      expect(await focusIn(tour)).toBe(true);
    }
    expect(reached).toBe(true);

    // The commands wait for the tour.
    await page.keyboard.press(`${MOD}+k`);
    await page.keyboard.press("c");
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("map-editor-root")).not.toHaveAttribute(
      "data-comment-mode",
      "on",
    );

    await page.keyboard.press("Escape");
    await expect(tour).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("map-editor-root")).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(500);
    await expect(page.getByTestId("onboarding-scrim")).toHaveCount(0);
  });
});
