# Changelog

All notable changes follow [Semantic Versioning](https://semver.org/).

## [2.2.0-alpha.1] - 2026-07-13

### Added

- Added a private local-corpus contract for structurally complete questions,
  answers, document pages, source locators, and parse confidence.
- Added a question-by-question editorial binding layer with exact-sense,
  word-form-only, and rejected states; spelling matches never auto-promote to
  sense proof.
- The personal card and library can show passage, stem, options, answer, match
  location, review state, and PDF locator for up to three reviewed local
  contexts per sense.
- Added an editable 1–200 daily new-word target, remaining-work and completion
  forecast, plus saved additional 70/30 batches for learners who want to keep
  studying after the planned round.
- Added a local screenshot-first GRE mock-test mistake inbox with structured
  error causes, linked senses, due review, answer checking, mastery history, and
  screenshot-free safe export.

### Safeguards

- Private question text and bindings stay in the ignored `imports/private/`
  workflow and are described only as learner-held recall/practice material, not
  official ETS questions.
- Personal catalog generation fails closed when a private corpus exists without
  its reviewed bindings. Public catalog and standalone generation strip and scan
  for private fields, question identifiers, source names, and question text.
- Mock-test review hides answers until a real attempt is submitted and only due
  attempts can change the spaced-review state.

### Coverage

- Personal raw catalog: 2,535 words / 4,292 senses.
- Private corpus and review totals remain local-only and are excluded from Git.
- Personal display is limited to three non-rejected contexts per sense.
- Public open demo: 39 study-ready words and zero private question excerpts.

## [2.1.1-alpha.1] - 2026-07-13

### Corrected

- Replaced the misleading “pending review” relation placeholder with independent
  synonym and antonym states: present, source-checked absent, or unverified.
- Corrected `acclaim` to source-pinned US IPA `/əˈkleɪm/` and added 23 more
  traceable Wiktionary pronunciation overrides; CMU conversions are now marked
  approximate and cannot enter formal study by themselves.
- Manually reviewed the complete former 315-sense formal pool in three batches,
  recorded 51 targeted semantic/POS/example decisions in the private manifest,
  and removed duplicate word+sense cards from scheduling.
- Prevented unbound original contexts from overriding OEWN definitions or
  appearing as verified examples; target-bearing dictionary examples are now
  selected before same-synset examples that use only a synonym.
- Corrected the displayed senses of `callous`, `consummate`, `idle`, and
  `impertinent`, and replaced ambiguous distractors for those cards plus
  `admonish`, so the four visible Chinese choices retain one defensible answer
  without relying on post-answer context.

### Strengthened

- Formal scheduling now requires a canonical word+sense record, matching POS,
  exact COW or explicit editorial alignment, trusted IPA, checked relation
  fields, and a rights-cleared target-bearing example.
- Every distractor must itself pass the formal content gate. Questions exclude
  shared OEWN/CILI concepts, bidirectional synonyms, and near-duplicate Chinese
  or English definitions; same-POS alternatives are required when available.
- Added three exact-sense, editor-reviewed semantic distractors for every one of
  the 292 quiz-target senses. Four separately validated adverb senses are
  available only as distractors, producing a 296-sense formal option pool.
  Later attempts prioritize the exact wrong sense previously chosen by the
  learner.
- Added post-answer distinction notes for all three reviewed distractor senses.
- The app's library now shows only the audited formal layer and displays the
  separate source and state for synonyms and antonyms.

### Coverage

- Personal raw catalog: 2,535 words / 4,292 senses.
- Audited formal option layer: 296 unique senses across 287 words; 292 target
  senses across 283 words; four distractor-only senses; 204 primary senses.
- Public open demo: 39 study-ready words.

## [2.1.0-alpha.1] - 2026-07-13

### Changed

- Replaced reveal-and-self-rating cards with a four-choice definition question:
  one correct sense and three ranked confusable distractors.
- Moved mastery judgment into the system. A wrong answer becomes an `Again`
  event and is repeated later; one first-exposure correct answer remains
  `learning` because a four-choice item has a 25% guessing baseline.
- Made response time optional evidence rather than a required learner action.
- Restricted the formal queue to senses with IPA and independently checked
  synonym and antonym evidence, whose alignment state is `verified`, and whose
  example passes the source, rights, target-visibility, and sense checks.

### Added

- Openly licensed human pronunciation audio from Lingua Libre and Wikimedia
  Commons, including per-file creator, license, source page, dialect, explicit
  English-language evidence, and URL.
- On-demand Commons discovery for words without embedded audio and an explicitly
  labelled system-speech fallback.
- Quiz evidence in append-only review events, including the chosen option,
  correct option, distractor senses, correctness, and response band.
- Catalog content and quiz audit commands for checking queue eligibility and
  four unique answer choices.
- Explicit `alignmentState`, `alignmentScore`, and `alignmentSource` evidence for
  separating source verification from word-sense verification.
- Explicit aggregate and per-kind relation evidence. OEWN synset co-members and
  lexical-sense antonym edges are distinguished from checked empty fields;
  legacy and user-supplied arrays fail closed.
- Structured example rights and public/private use scopes that fail closed for
  legacy, unknown, or restricted content.

### Safeguards

- ETS question text and unlicensed film or television dialogue are not bundled
  in public builds.
- Personally held examples may be used through the private local workflow but
  are never promoted automatically into a redistributable catalog.
- A valid source URL or license never substitutes for verification that an
  example expresses the intended Chinese sense.
- Unknown-language audio and NC/ND recordings are rejected; a failed Commons
  lookup falls back during the same click instead of trapping playback retries.

### Known limitations

- Human audio and verified, reusable examples do not yet cover every catalog
  sense; unverified entries remain in the local catalog but stay out of the
  formal queue and do not expose untrusted English glosses or examples.
- Full editorial review of the private 2,535-word catalog remains in progress.

## [2.0.0-alpha.1] - 2026-07-12

### Changed

- Reframed the product around a built-in, versioned vocabulary catalog instead of mandatory first-run import.
- Replaced alphabetical new-word order with stable daily stratified sampling: 70% priority evidence and 30% long-tail exploration.
- Split IndexedDB storage into catalog, learner profile, and append-only review-event stores while retaining v1 migration.
- Moved manual spreadsheet import to advanced data management.

### Added

- Private local catalog build pipeline for 2,535 core words and 4,292 senses.
- CMUdict and Open English WordNet enrichment for IPA, pronunciation evidence, English definitions, lexical relations, and examples.
- Local material occurrence analysis that retains counts and source metadata without retaining source text.
- IPA display, browser speech, priority rank, evidence counts, synonyms, antonyms, and sourced context on the study card.
- Catalog provenance, coverage validation, public open-demo catalog, and private/public build separation.
- Branded 192px, 512px, and 1024px app icons.
- Editorially reviewed, original GRE-style contexts for the complete initial daily queue.

### Safeguards

- Authentic ETS question text is not bundled in the public catalog.
- Personal catalog and source caches remain gitignored and receive an explicitly private standalone filename.

## [1.0.0] - 2026-07-12

### Added

- Usable React and TypeScript local-first application.
- Private browser-side XLSX and CSV import with structure detection.
- Dependency-free XLSX cell reader that does not execute formulas, macros, or external links.
- Core-list and supplemental multi-sense merging without bundling source lists.
- IndexedDB persistence and portable JSON backup/restore.
- Explainable exam-date-aware spaced-review baseline.
- Active-recall cards with four ratings, confidence, and response-time capture.
- Automatic lapse reinforcement and manual mistake entry.
- Searchable word-sense library with editable lexical relationships and notes.
- Progress dashboard, responsive layout, PWA manifest, and offline cache.
- Standalone single-file build for local use and GitHub Pages deployment workflow.

### Privacy

- Added explicit ignore rules for spreadsheet files and private imports.
- Confirmed that commercial word-list contents are absent from the public build.

## [0.1.0] - 2026-07-11

### Added

- Initial product requirements for an adaptive GRE Verbal learning system.
- Local-first PWA architecture decision.
- Word-sense mastery and mistake-driven review data model.
- Milestone roadmap from product prototype to public beta.
- Interactive product wireframe.
- Public-repository content and copyright safeguards.
