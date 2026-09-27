import { afterEach, describe, expect, it, vi } from "vitest";

import { AfterResponseMailer } from "./after-response-mailer";
import { FakeMailer } from "./fake-mailer";
import type { Mailer } from "./mailer";

const INPUT = { to: "someone@example.com", subject: "s", text: "t", html: "h" };

function collectTasks() {
  const tasks: (() => Promise<void>)[] = [];
  return {
    tasks,
    run: (task: () => Promise<void>) => {
      tasks.push(task);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AfterResponseMailer", () => {
  it("resolves without sending, and sends when the scheduled task runs", async () => {
    const inner = new FakeMailer();
    const scheduler = collectTasks();
    const mailer = new AfterResponseMailer(inner, scheduler.run);

    await mailer.send(INPUT);

    expect(inner.sent).toHaveLength(0);
    expect(scheduler.tasks).toHaveLength(1);

    await scheduler.tasks[0]?.();

    expect(inner.sent).toEqual([INPUT]);
  });

  it("logs a failed send by error name only, without rejecting the task", async () => {
    const failing: Mailer = {
      send: () => Promise.reject(new TypeError("secret detail someone@example.com")),
    };
    const scheduler = collectTasks();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await new AfterResponseMailer(failing, scheduler.run).send(INPUT);
    await expect(scheduler.tasks[0]?.()).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith("email send failed", "TypeError");
  });
});
