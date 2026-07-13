# Data pipeline

## Goal

Build a versioned vocabulary catalog before the learner enters the app. Runtime
interaction consumes this catalog; it does not ask a normal user to assemble the
database. Catalog size is not the quality metric: a sense is scheduled only when
its source, reuse rights, and semantic alignment are strong enough.

## Stages

1. **Normalize scope**
   - Core workbook defines 2,535 unique headwords.
   - Supplemental workbook contributes distinct matching senses only.
   - IDs are stable hashes of normalized lemma, POS, and the current legacy
     definition until editorial sense IDs replace them.
2. **Analyze local exposure**
   - Exact surface-form counts are computed in memory from selected PDFs.
   - Output stores counts, source type, page range, weight, and extraction
     diagnostics, never source passages.
   - ETS paper practice scans only the two Verbal sections.
   - Counts influence priority but are never presented as official GRE
     frequency.
3. **Enrich phonetic evidence and human audio**
   - Prefer POS-aware Open English WordNet IPA when present.
   - Apply source-pinned Wiktionary IPA overrides when the page explicitly
     supports the recorded dialect.
   - Retain CMUdict ARPAbet and its unsyllabified IPA conversion only as an
     `approximate_transcription`; it cannot satisfy the formal study gate.
   - Query Wiktionary file links and Wikimedia Commons metadata for human
     recordings, then retain only compatible licenses.
   - Store creator, license, license URL, Commons page, dialect, and media URL per
     file. The cache is private build evidence, not a blanket audio license.
   - Ambiguous heteronyms require editorial overrides.
4. **Enrich lexical candidates**
   - Match same-POS Open English WordNet candidates.
   - Store English glosses, synonyms, antonyms, examples, and open sense IDs.
   - Write `relationState` and `relationSource`; the aggregate state becomes
     `verified` only after both synonym and antonym fields have been checked
     against the verified aligned OEWN sense, even when one or both are empty.
   - Write independent synonym and antonym evidence states. Synsets supply
     synonym co-members; lexical senses supply direct antonym edges. A checked
     empty relation is stored as `source_checked_absent`, not as “pending”.
   - Automatic candidates remain `auto_candidate` until the separate alignment
     stage accepts them.
5. **Verify Chinese-to-English sense alignment**
   - Compare the intended Chinese definition with open cross-lingual lexical
     evidence and any curated override.
   - Write `alignmentState`, `alignmentScore`, and `alignmentSource` for every
     sense.
   - A private, versioned review manifest records editor-approved corrections
     and explicit exclusions without publishing personal word-list text.
   - `editor_reviewed` may be accepted directly as `verified`; an automatic
     match becomes `verified` only for an exact Chinese Open Wordnet lemma match.
     Substring and partial-overlap matches remain `candidate`.
6. **Apply the example eligibility gate**
   - An example must have a permitted kind, traceable source, provenance, and
     reuse rights for the current build.
   - It must visibly contain the target word or a supported inflection.
   - The containing sense must have `alignmentState: "verified"`.
   - A verified source URL by itself is not enough: an example for a different
     sense of the same headword is rejected.
7. **Rank and stratify**
   - Evidence combines weighted local exposure, core/supplement consensus,
     source coverage, and existing lapse evidence.
   - The eligible catalog is divided into a focus pool and a long-tail pool.
   - New words use a stable daily 70/30 draw; due reviews are scheduled
     separately.
   - Learner correctness, latency, due state, and lapse history take over
     progressively after study begins.
8. **Generate and audit four-choice questions**
   - Create one correct definition and three unique distractors.
   - Require every distractor to pass the same formal content gate as the target.
   - Bind each of the 292 quiz-target senses to three editor-reviewed,
     exact-sense, same-POS semantic distractors from the 296-sense formal option
     pool. Four support-only senses may appear as distractors but never as
     question targets. Give a learner's prior wrong choice priority on a later
     attempt; do not treat spelling proximity as semantic evidence.
   - Reject synonyms, duplicate meanings, and choices close enough to allow two
     defensible answers.
   - Keep a stable answer key per attempt while rotating answer position across
     attempts.
9. **Editorial and private layers**
   - Public review schema lives in `data/study-sense-reviews.json`; the actual
     personal review manifest remains gitignored under `imports/private/`.
   - Original GRE-style writing is included only after explicit binding to a
     verified OEWN sense. Unbound writing remains source material and cannot
     override a dictionary definition.
   - User-owned ETS references, dictionary examples, or screen dialogue may be
     attached locally when permitted, but remain excluded from public output.
10. **Extract and bind the private GRE question corpus**
    - Parse the locally held fill-in and reading PDFs into passages, questions,
      options, answers, PDF pages, and stable source locators under the ignored
      `imports/private/` directory.
    - Build lexical candidates first. A surface or conservative inflection match
      remains `word_form_only`; it cannot become semantic evidence by itself.
    - Require a written item-level editorial decision for every candidate selected for display.
      Only a clear exact-sense use is labelled `confirmed_sense`.
    - Copy at most three reviewed contexts per sense into the personal catalog.
      Never describe learner-held recall/practice material as official ETS.
11. **Validate and package**
    - Check IDs, tiers, licenses, audio metadata, alignment and relation-evidence fields, eligible
      examples, unique answer choices, and private-source leakage.
    - Generate a gitignored personal catalog and a separately licensed open
      demo.

## Current private-catalog raw coverage

| Field | Coverage |
|---|---:|
| Headword, POS, Chinese definition | 2,535 / 2,535 |
| Pronunciation evidence | 2,456 / 2,535 |
| Trusted dictionary/editorial IPA | 2,042 / 2,535 |
| Explicitly English, openly licensed human audio | 1,435 / 2,535 |
| At least one checked lexical relation set | 456 / 2,535 |
| At least one verified sense alignment | 502 / 2,535 |
| At least one retained trusted context | 408 / 2,535 |
| Primary sense ready for formal study | 204 / 2,535 |
| Quiz-target senses with three exact editorial confusables | 292 / 292 |
| All canonical study-ready option senses | 296 / 4,292 |
| Distractor-only support senses | 4 / 296 |
| Study-ready senses with OEWN synonym co-members | 239 / 296 |
| Study-ready senses with a direct OEWN antonym edge | 48 / 296 |
| Study-ready senses checked with no direct OEWN antonym recorded | 248 / 296 |
| At least one local-material occurrence | 1,545 / 2,535 |
| Explicitly sense-bound original GRE-style context | 0 / 2,535 |
| Private question corpus | Local-only; excluded from Git |
| Item-level sense decisions | Required before display |
| Personal display limit | 3 non-rejected contexts per sense |

Raw coverage is not queue coverage. `pnpm catalog:audit` reports how many
primary senses pass the current alignment and example gate. Entries that fail
remain in the private background catalog for editorial work, but do not enter
the formal study queue or the audited library view.

## Public demo build

`scripts/build-open-demo.mjs` does not copy Chinese definitions from the private
study-list catalog. It selects primary senses only when Chinese Open Wordnet
marks a Chinese lemma as an exact match to the same CILI identifier used by the
verified Open English WordNet sense. The Chinese lemma, English gloss,
relations, and public dictionary example therefore remain one coherent sense.

The build is deterministic for a given personal-catalog input, removes private
source labels and frequency evidence, and currently emits 39 study-ready words
(33 focus and 6 long-tail). It fails if fewer than 20 primary senses pass the
public content gate. Partial cross-lingual overlaps remain audit evidence and
cannot become public definitions automatically.

## Rebuild and audit commands

```bash
pnpm catalog:base
# Generate the corpus with a user-held local extractor/configuration.
pnpm corpus:prepare-review
# Review every selected candidate, then merge the private decisions:
pnpm corpus:merge-review
pnpm catalog:audio
pnpm catalog:merge-confusables
pnpm catalog:build
pnpm catalog:audit
pnpm quiz:audit
```

`catalog:audio` uses the network and may be resumed from its gitignored metadata
cache. `catalog:audit` validates the catalog, audits Chinese-to-English sense
alignment, and writes a private study-content coverage report. The narrower
`catalog:alignment-audit` command prints alignment samples for editorial review.
`catalog:merge-confusables` validates the six private editorial review batches
(A–F) against exact formal sense IDs before updating the ignored manifest.
`quiz:audit` builds every one of the 292 quiz-target definition questions from
the 296-sense formal option pool and verifies four unique choices with exactly
one answer key, plus complete quiz-target editorial graph coverage. The four
support-only senses may be selected as distractors but never become question
targets.

The local extractor/configuration and all review artifacts may contain
user-held source text and therefore remain ignored. A full personal build fails
if the private corpus is present without its merged review binding file. The
public builder strips private fields and scans the serialized output before it
is allowed to finish.
