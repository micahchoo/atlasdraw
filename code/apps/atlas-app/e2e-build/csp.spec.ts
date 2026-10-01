/**
 * The content security policy of the production build, in a real browser.
 *
 * The unit tests prove what the policy says. What only a browser settles:
 * the app boots, draws and imports under it with no violation, the inline
 * boot script runs by its hash, and a script someone injects does not run.
 * Requests to other hosts are answered here, so the test calls no server.
 */

import { test, expect, type Page } from "@playwright/test";

import { skipOnboarding } from "../e2e/helpers/onboarding";

interface Violation {
  directive: string;
  blocked: string;
}

/** Record every policy violation of the page, from its first script on. */
async function watchViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: unknown[] };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__violations.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
      });
    });
  });
}

function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(
    () => (window as unknown as { __violations: Violation[] }).__violations,
  );
}

/** Answer every request to another origin than the app's with a 404. */
async function answerOtherHosts(page: Page): Promise<void> {
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  await page.route(
    (url) => url.origin !== own,
    (route) => route.fulfill({ status: 404, body: "" }),
  );
}

const GEOJSON = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "well" },
      geometry: { type: "Point", coordinates: [13.4, 52.5] },
    },
  ],
});

test.describe("content security policy", () => {
  test("the editor boots, draws and imports with no violation", async ({
    page,
  }) => {
    await watchViolations(page);
    await answerOtherHosts(page);
    await skipOnboarding(page);
    await page.goto("/");

    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(policy).toContain("script-src 'self'");

    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    await expect(page.locator(".excalidraw canvas").first()).toBeVisible();

    // Draw a rectangle with the keyboard tool and a drag.
    await page.keyboard.press("r");
    await page.mouse.move(500, 300);
    await page.mouse.down();
    await page.mouse.move(600, 380, { steps: 5 });
    await page.mouse.up();

    // Import a layer: the parse runs in a module worker.
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "wells.geojson"));
      document.querySelector('[data-testid="map-editor-root"]')!.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    }, GEOJSON);
    await expect(page.getByTestId("toast-success")).toContainText(
      "1 feature imported",
    );

    await page.waitForTimeout(500);
    expect(await violations(page)).toEqual([]);
  });

  test("a script injected into the page does not run", async ({ page }) => {
    await watchViolations(page);
    await answerOtherHosts(page);
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();

    // An inline script, and one from another host, as an HTML injection
    // would add them.
    await page.evaluate(() => {
      const inline = document.createElement("script");
      inline.textContent = "window.__injected = 1";
      document.body.appendChild(inline);
      const remote = document.createElement("script");
      remote.src = "https://evil.example/x.js";
      document.body.appendChild(remote);
    });
    await page.waitForTimeout(300);
    const ran = await page.evaluate(
      () => (window as unknown as { __injected?: number }).__injected,
    );
    expect(ran).toBeUndefined();
    const blocked = await violations(page);
    expect(blocked.map((v) => v.directive)).toEqual([
      "script-src-elem",
      "script-src-elem",
    ]);
    expect(blocked.map((v) => v.blocked)).toContain(
      "https://evil.example/x.js",
    );
  });

  test("the inline boot script runs by its hash on a viewer route", async ({
    page,
  }) => {
    await watchViolations(page);
    await answerOtherHosts(page);
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.goto("/embed/abcdefghij_klmnop-qrs");
    await expect(page.locator("html")).toHaveAttribute("data-boot", "embed");
    expect(await violations(page)).toEqual([]);
  });
});

test.describe("frame-ancestors, sent by the server", () => {
  // vite preview sends no header; nginx (nginx.conf) does. Run with
  // E2E_BUILD_URL pointing at the nginx image, EMBED_FRAME_ANCESTORS set to
  // "https://news.example https://blog.example".
  test.skip(!process.env.E2E_BUILD_URL, "needs the nginx image");

  test("an embed may be framed by the allowlist; any other page only by itself", async ({
    request,
  }) => {
    const embed = await request.get("/embed/abcdefghij_klmnop-qrs");
    expect(embed.headers()["content-security-policy"]).toBe(
      "frame-ancestors https://news.example https://blog.example",
    );
    for (const path of ["/", "/m/abcdefghij_klmnop-qrs"]) {
      const page = await request.get(path);
      expect(page.headers()["content-security-policy"]).toBe(
        "frame-ancestors 'self'",
      );
    }
  });
});
