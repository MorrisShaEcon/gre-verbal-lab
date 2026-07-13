import { isTrustedAlignmentRecord } from "./content-quality.mjs";

export function findBoundCuratedContextSense(senses, curated) {
  if (!curated?.openSenseId || !curated?.sentence?.trim()) return undefined;
  return senses.find((sense) => (
    sense.openSenseId === curated.openSenseId
    && sense.studyReviewState !== "excluded"
    && isTrustedAlignmentRecord(sense)
  ));
}
