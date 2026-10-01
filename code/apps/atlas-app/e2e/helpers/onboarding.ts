import type { Page } from "@playwright/test";

/**
 * The flag `src/components/OnboardingTips.tsx` reads (its STORAGE_KEY). A fresh
 * Playwright profile has no localStorage, so every test would otherwise boot
 * under the first-run onboarding scrim, which swallows every click.
 */
export const ONBOARDING_DISMISSED_KEY = "atlasdraw-onboarding-dismissed";

/**
 * Seed the onboarding flag before any page script runs. Call before
 * `page.goto`: an init script applies to the next navigation, not this one.
 */
export async function skipOnboarding(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    localStorage.setItem(key, "1");
  }, ONBOARDING_DISMISSED_KEY);
}
