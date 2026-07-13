# Content audit — 2026-07-13

## Outcome

The application now exposes a smaller audited formal layer instead of treating
the complete raw import as publication-ready content.

| Layer | Result |
|---|---:|
| Raw personal catalog | 2,535 words / 4,292 senses |
| Former formal pool reviewed in three batches | 315 senses |
| Final canonical formal option layer | 296 senses / 287 words |
| Quiz-target layer | 292 senses / 283 words |
| Distractor-only support layer | 4 senses / 4 words |
| Primary senses eligible for new-word scheduling | 204 |
| Public open demo | 39 words |

The remaining raw senses are retained privately for future editorial work. They
do not appear in the audited library or enter the adaptive queue.

## Problems found and corrected

- The former 315-sense pool contained 51 redundant cards produced from the same
  word and OEWN sense. Scheduling now admits one canonical record per
  `word + openSenseId`.
- Three complete review batches compared Chinese meaning, POS, English gloss,
  OEWN sense, relations, and examples. The ignored private manifest records 51
  targeted decisions across 47 words: 43 approved corrections and 8 explicit
  exclusions.
- Automatic Chinese substring matches no longer become verified facts. Only an
  exact Chinese Open Wordnet match or a recorded editorial approval can enter
  formal study.
- CMU ARPAbet conversion had been displayed as if it were fully formed IPA even
  though it lacks reliable syllable boundaries. It is now marked approximate
  and cannot satisfy the formal gate. Twenty-four words have source-pinned
  Wiktionary US IPA overrides; unresolved words remain out of formal study when
  they have no other trusted transcription.
- Synonym and antonym coverage is now audited independently. A missing OEWN
  antonym is displayed as “source checked, not recorded,” never as “pending
  review” and never filled with an invented relation.
- Unbound project-written examples can no longer override OEWN definitions or
  enter a finished card. OEWN examples containing the target word are selected
  before same-synset examples that only use a synonym.
- Every distractor must itself pass the formal gate. The question audit excludes
  shared OEWN/CILI concepts, bidirectional synonyms, and near-duplicate meanings;
  all 292 quiz-target senses now bind to three editor-reviewed exact-sense,
  same-POS semantic distractors from the 296-sense formal pool. Pure spelling
  similarity no longer masquerades as
  semantic confusion evidence. A learner's past wrong choice is prioritized on
  a later attempt for the same target.
- A separate human ambiguity audit sampled 42 questions, with 36 drawn from the
  three newest review batches. It found and corrected five cards whose Chinese
  choices could still support two answers despite passing structural checks:
  `admonish`, `callous`, `consummate`, `idle`, and `impertinent`.
- The formal layer originally had only one adverb, so a same-POS question for
  `piecemeal` was impossible. Four non-primary adverb senses (`asunder`, `awry`,
  `haphazard`, and `offhand`) were separately aligned to exact OEWN senses,
  corrected for POS, and admitted only after their IPA, relations, and
  target-bearing examples passed the same formal gate. They may be used as
  validated options but are never scheduled as question targets.

## Final formal-layer evidence

| Evidence | Coverage |
|---|---:|
| Editor-approved alignments | 248 / 296 |
| Exact Chinese Open Wordnet alignments | 48 / 296 |
| OEWN synonym set present | 239 / 296 |
| OEWN synonym source checked, no co-member recorded | 57 / 296 |
| Direct OEWN antonym present | 48 / 296 |
| OEWN antonym source checked, no direct edge recorded | 248 / 296 |
| Quiz-target senses with three exact editorial confusables | 292 / 292 |
| Distractor-only support senses | 4 / 296 |

All 296 formal senses have trusted IPA, matching POS, independently checked
relation fields, and at least one rights-compatible dictionary example that
visibly uses the target word or a supported inflection.

## Reproducible checks

```bash
pnpm test
pnpm catalog:merge-confusables
pnpm catalog:build
pnpm catalog:audit
pnpm quiz:audit
pnpm build:standalone
```

The private review manifest and personal catalog are deliberately gitignored.
The public repository contains the validation logic, empty review schema,
open-license pronunciation overrides, tests, and the open demo catalog.
