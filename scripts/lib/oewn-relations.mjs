const clean = (value) => String(value ?? "").trim();

export const OEWN_LICENSE = "CC BY 4.0";

export function normalizeOewnLemma(value) {
  return clean(value).toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
}

export function lemmaFromSenseId(value) {
  return normalizeOewnLemma(String(value ?? "").split("%")[0]);
}

function unique(values) {
  return [...new Set(values.map(normalizeOewnLemma).filter(Boolean))];
}

function evidence(state, source) {
  return { state, source };
}

/**
 * Extract only direct lexical evidence from an aligned OEWN sense.
 *
 * Synonyms are co-members of the aligned synset. Antonyms are lexical-sense
 * relations; reverseAntonymSenseIds may be supplied after auditing the complete
 * entry set because antonymy is symmetric even when a source serialization only
 * emits one direction. Hypernyms, derivations, `also`, and other relations are
 * deliberately excluded rather than being presented as direct synonyms or
 * antonyms.
 */
export function extractOewnRelations({
  headword,
  reference,
  synset,
  trustedAlignment,
  reverseAntonymSenseIds = [],
}) {
  if (!trustedAlignment || !reference || !synset) {
    const source = "Sense alignment is not verified; OEWN lexical relations withheld";
    return {
      relations: { synonyms: [], antonyms: [], confusables: [] },
      evidence: {
        synonyms: evidence("unverified", source),
        antonyms: evidence("unverified", source),
      },
    };
  }

  const normalizedHeadword = normalizeOewnLemma(headword);
  const synonyms = unique(synset.members ?? []).filter((member) => member !== normalizedHeadword).slice(0, 8);
  const antonymSenseIds = unique([...(reference.antonym ?? []), ...reverseAntonymSenseIds]);
  const antonyms = unique(antonymSenseIds.map(lemmaFromSenseId)).filter((member) => member !== normalizedHeadword).slice(0, 6);
  const synsetSource = `Open English WordNet 2025 synset ${reference.synset} members (${OEWN_LICENSE})`;
  const antonymSource = `Open English WordNet 2025 lexical sense ${reference.id} antonym relation (${OEWN_LICENSE})`;

  return {
    relations: { synonyms, antonyms, confusables: [] },
    evidence: {
      synonyms: evidence(synonyms.length ? "verified_present" : "source_checked_absent", synsetSource),
      antonyms: evidence(antonyms.length ? "verified_present" : "source_checked_absent", antonymSource),
    },
  };
}
