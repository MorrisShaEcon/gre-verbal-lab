# v2.2.0 acceptance criteria

## First-run experience

- [x] A normal first launch requires no import.
- [x] The personal build starts with 2,535 searchable words.
- [x] Manual import is available only under advanced data management.

## Four-choice learning loop

- [x] Every scheduled definition question has exactly four unique choices.
- [x] Exactly one choice is keyed as correct.
- [x] Every distractor passes the formal content gate; all 292 quiz-target
  senses have three exact-sense, editor-reviewed same-POS semantic distractors
  drawn from a 296-sense formal option pool.
- [x] A learner's previously selected wrong sense is prioritized on a later
  attempt for the same target sense.
- [x] Answer feedback exposes the exact confusable meanings and an editorial
  distinction rationale for each one.
- [x] Distractors exclude the same OEWN/CILI concept, bidirectional synonyms,
  and duplicate or defensibly equivalent meanings.
- [x] Pure spelling similarity is not presented as semantic-confusion evidence.
- [x] The answer position is stable for the displayed attempt and can rotate on a
  later attempt.
- [x] Meaning, relations, and examples are revealed only after selection.
- [x] The system infers the rating and confidence; the learner is not asked to
  self-rate in the core flow.
- [x] One first-exposure correct answer remains `learning`, not mastered.
- [x] A wrong answer creates a lapse and is appended once for same-session replay.
- [x] Response-time evidence can be disabled without blocking the exercise.
- [x] Review events retain the selected option, answer key, distractors,
  correctness, and response band.

## Human audio

- [x] Eligible human recordings are preferred over system speech.
- [x] Every embedded recording has a media URL, source page, creator, license,
  license URL, dialect, and human flag.
- [x] Embedded and runtime recordings require explicit English-language
  evidence; unknown and known non-English files are rejected.
- [x] NC, ND, and unknown audio licenses are rejected.
- [x] The app can discover an exact open Commons recording on demand.
- [x] A failed Commons lookup falls back to labelled system speech in the same
  click and is cached briefly to prevent a retry loop.
- [x] Synthetic fallback is explicitly labelled.
- [x] Playback supports 0.8× and 1×.
- [ ] Complete eligible human-audio coverage for all primary words.

## Content and sense gate

- [x] Source verification and sense alignment are represented separately.
- [x] Every sense records `alignmentState`, `alignmentScore`, and
  `alignmentSource`.
- [x] Every sense records `relationState` and `relationSource`; missing legacy
  fields fail closed as `unverified`.
- [x] The formal queue accepts only `alignmentState: "verified"`.
- [x] The formal queue also requires `relationState: "verified"`; user overlays
  cannot upgrade an unverified catalog relation.
- [x] A scheduled card has IPA and independently checked synonym and antonym
  evidence; a checked empty field is explained and no relation is fabricated.
- [x] Formal IPA is source-verified/editor-reviewed; automatic CMU conversion is
  approximate background evidence only.
- [x] The formal queue enforces matching POS and one canonical card per
  word+OEWN sense.
- [x] Four validated adverb support senses may appear as distractors but cannot
  be scheduled as question targets or introduced as new words.
- [x] Three review batches covered the complete former 315-sense formal pool;
  corrections and exclusions are stored in the ignored private manifest.
- [x] Synonym and antonym coverage is tracked separately as present,
  source-checked absent, or unverified; a source-checked empty relation is not
  shown as “pending review”.
- [x] The OEWN relation audit verifies exact catalog extraction and confirms
  that all 7,988 lexical antonym edges are symmetric and target valid senses.
- [x] An eligible example has a permitted kind, source label, provenance, and
  reuse rights for the current build.
- [x] An eligible example visibly contains the target word or an accepted
  inflection.
- [x] Original GRE-style writing is not presented as an ETS question and does
  not satisfy the sourced-example gate by itself.
- [x] Entries that fail the gate remain in the background catalog but do not
  enter the formal queue or audited library view.
- [ ] Complete verified sense alignment for all primary GRE senses.
- [ ] Complete a verified reusable example for every primary sense.

## Daily planning

- [x] The learner can set a 1–200 daily new-word target and see remaining
  formal words, estimated study days, and an estimated completion date.
- [x] Changing today's target subtracts new words already completed today rather
  than silently creating a second full quota.
- [x] After completing the planned round, the learner may request another 70/30
  batch without an artificial daily stop.
- [x] An added batch is persisted atomically, so refresh does not replace its
  remaining words or order.
- [x] A 20-word new plan contains exactly 14 focus and 6 long-tail words when
  both eligible pools have capacity.
- [x] Sampling is weighted, without replacement, and not alphabetical.
- [x] The same date and catalog version produce the same order.
- [x] A new date or catalog version produces a new plan.
- [x] Due reviews remain independent of the 70/30 new-word quota.
- [x] Only the primary sense of a new headword is introduced in the first pass.
- [x] The planner does not fill a quota with content that fails the gate.

## Storage and migration

- [x] Static catalog, learner profile, and review events use separate stores.
- [x] Review events are append-only and no longer silently capped at 20,000.
- [x] v1 backup and stored-state migration remains supported.
- [x] Catalog replacement preserves compatible learning IDs and user overlays.
- [x] Missing legacy alignment evidence defaults conservatively instead of being
  treated as verified.
- [ ] Add ambiguity UI for legacy senses that cannot be mapped safely.

## Publication and private use

- [x] Private source files, caches, personal catalog, and personal standalone
  build are excluded from Git.
- [x] Public demo catalog contains only open or original content.
- [x] ETS question text and unlicensed film or television dialogue are excluded
  from public builds.
- [x] Private local import does not promote third-party text into the public
  catalog.
- [x] Open lexical and audio items retain required attribution.
- [ ] Complete the full open, verified catalog before calling v2 stable.

## Private GRE question context

- [x] A locally generated corpus can provide complete fill-in and reading
  questions bound to structured answers without entering Git history.
- [x] Every question selected for display has a valid source, PDF page range,
  locator, stem, options when applicable, answer, and zero unresolved parse
  anomalies.
- [x] Every displayed question-to-sense link has a written item-level editorial decision;
  `confirmed_sense` and `word_form_only` remain visibly distinct.
- [x] Exact word-form matching cannot automatically become sense confirmation.
- [x] The personal UI shows passage, stem, options, answer, match location, PDF
  pages, and the review note after the vocabulary answer is submitted.
- [x] The public catalog and distributable open app contain no private question
  text, IDs, source filenames, bindings, or private corpus metadata.
- [x] A full personal build fails closed if a private corpus is present without
  reviewed bindings.

## GRE mock-test mistake loop

- [x] A screenshot and structured question record can remain entirely local.
- [x] Records support draft, active, mastered, and archived states plus question
  type, answer, cause, reasoning, trap, improvement action, and linked senses.
- [x] Due items are shown ahead of the archive and refresh as time advances.
- [x] Review hides the answer until the learner submits a real answer; the
  system judges correctness before accepting a difficulty response.
- [x] Editing a mastered or archived record does not silently reactivate it.
- [x] Safe export removes screenshot data and raw OCR text; full private backup
  preserves them.
