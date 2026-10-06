import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const signIn = page.getByRole("link", { name: "Sign in", exact: true });
  if (await signIn.isVisible()) await signIn.click();
  await expect(page.locator("main")).toBeVisible();
  const demo = page.getByRole("button", {
    name: "Explore a demo",
    exact: true,
  });
  if (await demo.isVisible()) await demo.click();
  await expect(page.getByText("DEMO MODE", { exact: true })).toBeVisible();
});
test("review, Trash, idempotent backend and Undo preserve the demo", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Deep clean", exact: true }).click();
  const row = page.locator(".mail-row").filter({ hasText: "Studio Supply" });
  await row.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Review cleanup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Studio Supply");
  await page
    .getByRole("button", { name: "Approve & move to Trash", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("moved to Trash");
  await page
    .getByRole("button", { name: "Activity & undo", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByRole("status")).toContainText("restored");
  await page.getByRole("button", { name: "Deep clean", exact: true }).click();
  await expect(row).toBeVisible();
});
test("assistant and approved deterministic rules persist", async ({ page }) => {
  await page
    .getByRole("button", { name: "Your inbox agent", exact: true })
    .click();
  await page
    .getByLabel("Ask your inbox agent")
    .fill("Delete promotions older than 6 months");
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A rule, ready for your review." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve this rule", exact: true })
    .click();
  await expect(page.locator(".rule-list")).toContainText(
    "Delete promotions older than 6 months",
  );
  await page.reload();
  await expect(page.locator(".rule-list")).toContainText(
    "Delete promotions older than 6 months",
  );
});
test("accessibility critical screens, dialog keyboard and reduced motion", async ({
  page,
}) => {
  for (const view of [
    "Inbox report",
    "Deep clean",
    "Subscriptions",
    "Protected mail",
    "Your inbox agent",
    "Rules & autopilot",
    "Inbox guardian",
    "Activity & undo",
  ]) {
    await page.getByRole("button", { name: view, exact: true }).click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations, JSON.stringify(result.violations)).toEqual([]);
  }
  await page.getByRole("button", { name: "Deep clean", exact: true }).click();
  await page.locator(".row-checkbox:enabled").first().check();
  await page
    .getByRole("button", { name: "Review cleanup", exact: true })
    .click();
  await page.keyboard.press("Tab");
  expect(
    await page
      .locator("dialog")
      .evaluate((d) => d.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
});
test("visual responsive matrix does not overflow and keeps essential content", async ({
  page,
}) => {
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 1280, height: 850 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/?view=report");
    await expect(page.locator(".hero-number")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/report-${size.width}.png`,
      fullPage: true,
    });
  }
  await page.goto("/?view=settings");
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page.screenshot({
    path: "test-results/settings-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("light");
});
