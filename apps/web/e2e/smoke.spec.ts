import { expect, test } from "@playwright/test";

test("home page loads and shows the app title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Fetha/);
});

test("terms of use and privacy policy are public and dated", async ({ page }) => {
  await page.goto("/termos");
  await expect(page.getByRole("heading", { level: 1, name: "Termos de uso" })).toBeVisible();
  await expect(page.getByText("Toda decisão é sua")).toBeVisible();

  await page.goto("/privacidade");
  await expect(
    page.getByRole("heading", { level: 1, name: "Política de privacidade" }),
  ).toBeVisible();
  await expect(page.getByText(/^Versão de \d{2}\/\d{2}\/\d{4}(, revisão \d+)?$/)).toBeVisible();
});
