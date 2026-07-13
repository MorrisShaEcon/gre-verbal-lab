import { describe, expect, it } from "vitest";
import {
  markIdsAfterCommit,
  parsePendingProfileSnapshot,
  serializePendingProfileSnapshot,
} from "./db-recovery";

describe("database recovery primitives", () => {
  it("round-trips a profile-only recovery snapshot without a vocabulary catalog", () => {
    const raw = serializePendingProfileSnapshot(
      { schemaVersion: 2, learning: { sense: { reviewCount: 1 } } },
      [{ id: "event-1" }],
      "2026-07-13T16:00:00.000Z",
    );
    const parsed = parsePendingProfileSnapshot<Record<string, unknown>, { id: string }>(raw);

    expect(parsed?.savedAt).toBe("2026-07-13T16:00:00.000Z");
    expect(parsed?.reviewEvents).toEqual([{ id: "event-1" }]);
    expect(parsed?.profile).not.toHaveProperty("words");
  });

  it("ignores malformed recovery snapshots", () => {
    expect(parsePendingProfileSnapshot("not-json")).toBeNull();
    expect(parsePendingProfileSnapshot(JSON.stringify({ schemaVersion: 1, profile: {}, reviewEvents: {} }))).toBeNull();
  });

  it("marks review-event ids only after a successful commit", async () => {
    const persisted = new Set(["existing"]);
    await expect(markIdsAfterCommit(Promise.reject(new Error("abort")), persisted, ["new"])).rejects.toThrow("abort");
    expect([...persisted]).toEqual(["existing"]);

    await markIdsAfterCommit(Promise.resolve(), persisted, ["new"]);
    expect([...persisted]).toEqual(["existing", "new"]);
  });
});
