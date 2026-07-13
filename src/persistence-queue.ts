/**
 * Serializes browser persistence without allowing one failed write to poison
 * every later save. Errors are surfaced to the caller and then considered
 * handled so the next queued write can still run.
 */
export function enqueueRecoverableSave(
  previous: Promise<void>,
  save: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  return previous
    .catch(() => undefined)
    .then(save)
    .catch((error) => {
      onError(error);
    });
}
