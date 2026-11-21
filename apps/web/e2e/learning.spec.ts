import { expect, test } from "./tour";

import { registerAndSignIn } from "./helpers";

// Runs in CI (and by hand) whenever E2E_SECRET is set; see apps/web/e2e/README.md.
const e2eSecret = process.env.E2E_SECRET;

test.skip(!e2eSecret, "E2E_SECRET is not set; skipping the learning flow.");

interface LessonQuizAnswers {
  answers: { questionId: string; correctOptionId: string; correctOptionText: string }[];
}

test("opens the first lesson, passes its quiz and sees the next lesson recommended", async ({
  page,
  baseURL,
  request,
}) => {
  await registerAndSignIn(page, request, baseURL, e2eSecret ?? "");

  await page.goto("/aprender");
  await expect(page.getByRole("heading", { level: 1, name: "Aprender" })).toBeVisible();

  const continueCard = page.locator("section", { hasText: "Continuar" }).first();
  await continueCard.getByRole("link", { name: "Continuar" }).click();

  await expect(page).toHaveURL(/\/aprender\/what-is-an-option$/);
  await expect(page.getByRole("heading", { level: 1, name: "O que é uma opção" })).toBeVisible();

  const answersLookup = await page.request.get(
    "/api/e2e/lesson-quiz-answers?lesson=what-is-an-option",
    { headers: { "x-e2e-secret": e2eSecret ?? "" } },
  );
  expect(answersLookup.ok()).toBe(true);
  const { answers } = (await answersLookup.json()) as LessonQuizAnswers;

  const fieldsets = page.locator("fieldset");
  await expect(fieldsets).toHaveCount(answers.length);
  for (let index = 0; index < answers.length; index += 1) {
    const answer = answers[index];
    if (!answer) continue;
    await fieldsets.nth(index).getByRole("radio", { name: answer.correctOptionText }).click();
  }

  await page.getByRole("button", { name: "Enviar respostas" }).click();

  await expect(page.getByText(/^\d+ de \d+ corretas$/)).toBeVisible();
  await expect(page.getByText("Aprovado — esta lição está marcada como concluída.")).toBeVisible();

  const nextLessonLink = page.getByRole("link", { name: "Próxima lição" });
  await expect(nextLessonLink).toBeVisible();
  await nextLessonLink.click();
  await expect(page).toHaveURL(/\/aprender\/calls-and-puts$/);

  await page.goto("/aprender");
  const doneRow = page.getByRole("link", { name: /O que é uma opção/ });
  await expect(doneRow.getByText("Concluída", { exact: true })).toBeVisible();

  const continueCardAfter = page.locator("section", { hasText: "Continuar" }).first();
  await expect(continueCardAfter).toContainText("Calls e puts");
});
