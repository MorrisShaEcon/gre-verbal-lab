export interface PendingProfileSnapshot<TProfile, TEvent> {
  schemaVersion: 1;
  savedAt: string;
  profile: TProfile;
  reviewEvents: TEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Keeps the emergency snapshot deliberately profile-only: the bundled catalog
 * is rebuilt on startup instead of being duplicated in localStorage.
 */
export function serializePendingProfileSnapshot<TProfile, TEvent>(
  profile: TProfile,
  reviewEvents: TEvent[],
  savedAt = new Date().toISOString(),
): string {
  return JSON.stringify({
    schemaVersion: 1,
    savedAt,
    profile,
    reviewEvents,
  } satisfies PendingProfileSnapshot<TProfile, TEvent>);
}

export function parsePendingProfileSnapshot<TProfile, TEvent>(
  raw: string | null,
): PendingProfileSnapshot<TProfile, TEvent> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.schemaVersion !== 1
      || typeof parsed.savedAt !== "string"
      || !isRecord(parsed.profile)
      || !Array.isArray(parsed.reviewEvents)
    ) return null;
    return parsed as unknown as PendingProfileSnapshot<TProfile, TEvent>;
  } catch {
    return null;
  }
}

/** Never marks event ids durable until the enclosing transaction has committed. */
export async function markIdsAfterCommit(
  transactionDone: Promise<unknown>,
  persistedIds: Set<string>,
  pendingIds: Iterable<string>,
): Promise<void> {
  await transactionDone;
  for (const id of pendingIds) persistedIds.add(id);
}
