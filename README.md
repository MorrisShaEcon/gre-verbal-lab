# GRE Verbal Lab

GRE Verbal Lab is a database-first, local-first GRE vocabulary learning system.
It combines a versioned word-sense catalog with a personal review history,
mistake loop, and explainable daily plan.

## v2.2.0 alpha

The current alpha changes both the content model and the learning interaction:

- first use starts from a built-in catalog rather than an import screen;
- new words use a stable daily 70% priority / 30% long-tail mix;
- every one of the 292 quiz-target senses in the local personal build has three
  editor-reviewed, exact-sense semantic distractors drawn from a 296-sense
  formal option pool; a learner's previously selected wrong sense receives priority
  on later attempts, without pretending that spelling-only alternatives are
  “high-confusion” data;
- one first-attempt correct answer is treated as learning evidence, not mastery;
  wrong answers are recorded and repeated later in the same session;
- cards prefer openly licensed human recordings from Lingua Libre and Wikimedia
  Commons, with synthetic speech shown only as a labelled fallback;
- answer feedback can show source-verified IPA, Chinese and English definitions, synonyms,
  antonyms, scheduling evidence, and examples that pass the content gate;
- synonym and antonym evidence is tracked separately, so a source-checked empty
  relation is labelled as not recorded by OEWN instead of “pending review”;
- catalog updates are separated from learner state and append-only review events;
- private licensed materials and the public open-source catalog have separate
  build outputs.
- the private build can show manually reviewed excerpts from the learner's
  locally held GRE recall/practice PDFs, including passage, stem, options,
  answer, PDF pages, and the exact location of the matched word;
- a local match is labelled `confirmed sense` only after a human checks that it
  expresses the card's exact meaning. A spelling occurrence that has not passed
  that check remains `word form only` and is never presented as sense evidence;
- the learner chooses a daily new-word target from 1–200, sees an estimated
  completion date, and can continue with additional 70/30 batches after the
  planned work is complete;
- a screenshot-first mock-test mistake inbox stores structured error causes,
  linked vocabulary, due reviews, and mastery history locally.

The local personal catalog currently contains 2,535 raw core words and 4,292
raw word senses. The audited formal option layer contains 296 unique study-ready
senses across 287 words. Of these, 292 senses across 283 words can become quiz
targets; four separately validated adverb senses are support-only distractors,
and 204 primary senses can be introduced as new words. Public
GitHub builds use a smaller open demonstration catalog until the full openly
licensed catalog completes editorial review. The current public demo contains
39 study-ready primary senses: every Chinese definition is an
exact Chinese Open Wordnet lemma aligned through the same CILI identifier as its
Open English WordNet definition and example. No definition from the private
commercial study lists is copied into that build.

A personal build can attach a locally generated, question-level practice corpus.
Every displayed question-to-sense link requires an item-level semantic decision:
exact-sense confirmation, word-form-only evidence, or rejection. The personal
catalog copies at most three non-rejected contexts per sense; the public catalog
copies none of the corpus, bindings, source locators, or review statistics.

## Run

```bash
pnpm install
pnpm dev
pnpm test
pnpm build:open
pnpm build:standalone:open
# With a local personal catalog already generated:
pnpm build:personal
pnpm build:standalone
```

When `public/data/catalog.personal.json` exists, the personal standalone command
creates `dist/personal/GRE-Verbal-Lab-PERSONAL-v2.2.0.html`. That file is private
and must not be attached to a public GitHub Release. The public command produces
`dist/open/GRE-Verbal-Lab-v2.2.0.html` from the open catalog. The open build uses
an explicit public mode and fails if personal question data is present in the
distributable catalog.

## Data pipeline

The private pipeline is auditable and keeps source materials out of public
builds:

```bash
pnpm catalog:base
# Generate the local corpus with a user-held extractor/configuration.
pnpm corpus:prepare-review
# Manually classify every selected candidate, then:
pnpm corpus:merge-review
pnpm catalog:audio
pnpm catalog:build
pnpm catalog:audit
pnpm quiz:audit
```

- The two user-owned spreadsheets define the local core scope and supplemental
  senses.
- Open English WordNet and source-pinned Wiktionary revisions supply formal
  display IPA. CMUdict remains useful phoneme evidence, but its unsyllabified
  ARPAbet conversion is labelled approximate and cannot satisfy the formal gate.
- Open English WordNet 2025 supplies open lexical candidates and examples.
- Open cross-lingual lexical evidence and editorial overrides determine whether
  an English example is aligned to the intended Chinese sense.
- Lingua Libre and Wikimedia Commons supply human recordings only when the
  individual file exposes a compatible license, creator, and source page.
- Locally held GRE materials contribute derived occurrence counts to ranking.
  In the personal build only, a separate private corpus may also retain source
  text after structural extraction and human sense review. This corpus and its
  bindings stay under `imports/private/` and are ignored by Git.
- A reviewed local excerpt is labelled “local GRE recall/practice material,”
  never “official ETS.” An exact word occurrence alone does not prove that the
  question uses the card's meaning.

A sense enters the formal study queue only when it is the canonical record for
its word and OEWN sense, its POS matches the sense key, its alignment is exact
or explicitly editor-approved, it has source-verified/editor-reviewed IPA, both
relation fields have been checked, and it has an eligible target-bearing
example. A checked empty field is displayed as “not recorded by OEWN,” never
filled with an invented relation. Source verification alone does not prove
sense alignment.

See [Data pipeline](docs/DATA_PIPELINE.md) and
[Content policy](docs/CONTENT_POLICY.md).
Third-party copyright and license notices are retained in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Privacy and copyright

- Learning records remain in IndexedDB and require no account.
- The public repository excludes commercial word lists, copyrighted questions,
  television or film scripts, private mistakes, preparation PDFs, and the
  personal catalog unless redistribution is explicitly licensed.
- Authentic GRE questions and screen dialogue may be referenced by source and
  locator, but their text is not redistributed without permission.
- A learner may import personally held material for local use. Private import is
  not converted into permission to publish or attach that material to a GitHub
  release.
- Open lexical and audio data retain source, creator, and license attribution.
- Public catalog and standalone builds strip private question fields and run a
  serialized leak scan before completion. Personal artifacts must remain local.

## Documentation

- [Chinese user guide](docs/USER_GUIDE.md)
- [v2 acceptance criteria](docs/V2_ACCEPTANCE.md)
- [Data pipeline](docs/DATA_PIPELINE.md)
- [Content policy](docs/CONTENT_POLICY.md)
- [2026-07-13 content audit](docs/CONTENT_AUDIT_2026-07-13.md)
- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)

## License

Application code and original project content are MIT licensed. Third-party data
remains under the licenses recorded in each catalog's provenance metadata.
