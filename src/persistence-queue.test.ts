import { describe, expect, it } from "vitest";
import { enqueueRecoverableSave } from "./persistence-queue";

describe("recoverable persistence queue", () => {
  it("surfaces a failed save and still runs the next queued write", async () => {
    const calls: string[] = [];
    const errors: string[] = [];
    let queue = Promise.resolve();

    queue = enqueueRecoverableSave(queue, async () => {
      calls.push("failed");
      throw new Error("quota exceeded");
    }, (error) => errors.push(error instanceof Error ? error.message : "unknown"));
    await queue;

    queue = enqueueRecoverableSave(queue, async () => {
      calls.push("saved");
    }, () => errors.push("unexpected"));
    await queue;

    expect(calls).toEqual(["failed", "saved"]);
    expect(errors).toEqual(["quota exceeded"]);
  });
});
