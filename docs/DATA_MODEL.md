# Data model

## Static catalog

### Word

- stable ID, headword, normalized headword
- display pronunciations with dialect, IPA, source, quality, review state,
  optional source URL/license, and optional ARPAbet
- zero or more human `audioSources`
- source consensus and initial lapse evidence
- frequency profile: tier, rank, priority score, local/official material counts,
  and per-source evidence
- one or more word senses

### PronunciationAudio

- stable file ID and title
- direct media URL and source-page URL
- source label, creator, license, and license URL
- dialect, MIME type, and `human` flag
- explicit English language code/evidence when available

Attribution is stored per file. A source name such as Wikimedia Commons is not a
license by itself.

Text IPA and playable audio are independent evidence. Formal text IPA must be
`dictionary_ipa/source_verified` or `editor_reviewed/editor_reviewed`.
`approximate_transcription/auto_transcribed` remains background evidence only.

### WordSense

- stable ID, POS, Chinese and English definitions
- open lexical sense ID and source label
- usage note and enrichment state
- sense-specific synonyms, antonyms, and confusables
- `confusableSenseIds`: exact editor-reviewed sense targets behind the
  headword-level confusable labels
- `confusableRationales`: editor-written distinction for each exact target
- `confusableSource`: provenance of that editorial distractor decision
- `relationState`: `verified`, `user_supplied`, or `unverified`
- `relationSource`: lexical evidence supporting the synonym/antonym set
- `relationEvidence.synonyms` and `relationEvidence.antonyms`: independent
  evidence records with `verified_present`, `source_checked_absent`, or
  `unverified` state plus the exact OEWN synset or lexical-sense source
- `alignmentState`: `verified`, `candidate`, or `unverified`
- `alignmentScore`: normalized 0–1 alignment evidence
- `alignmentSource`: editorial record or lexical mapping used for the decision
- `studyReviewState`: `unreviewed`, `editor_approved`, or `excluded`
- `studyReviewNote`: private editorial decision provenance when applicable
- sourced context examples
- optional private `greQuestionMatches`, each bound to an exact question ID,
  PDF page/locator, structured stem/options/answer, exact match locations,
  and a human decision of `confirmed_sense` or `word_form_only`

Only the canonical record for each word+OEWN sense is schedulable. It must have
trusted IPA, a POS matching the OEWN sense key, exact COW or explicit editorial
alignment, `relationState: "verified"` with both per-kind fields checked, and an
eligible target-bearing example. A checked kind may be
`source_checked_absent`; `excluded` always fails closed.

`source_checked_absent` means that OEWN 2025 does not record that direct
relation for the aligned sense. It does not assert that a relation is impossible
or absent from every dictionary. Synonyms are read from aligned synset members;
antonyms are read only from lexical-sense `antonym` edges. Hypernyms,
derivations, and merely related words are not relabeled as synonyms or
antonyms.

### ContextExample

- text and optional Chinese translation
- kind: dictionary, official GRE, licensed screen dialogue, original GRE-style,
  or private reference
- source label, provenance, optional URL, and optional locator
- review state: source verified, editor reviewed, or automatic candidate
- structured `rightsState` and an `allowedIn` scope list for public/private use

Example acceptance also depends on rights for the current build and whether the
target word or an accepted inflection appears visibly. Source verification and
sense alignment remain separate decisions.

### GreQuestionMatch (private personal build only)

- stable question ID and local source filename
- PDF page range and section/passage/question locator
- question type, optional reading passage, stem, options, and answer values
- matched surface form and exact passage/stem/option locations
- `senseMatchState`: `confirmed_sense` or `word_form_only`
- required item-level editorial review note explaining the decision

The question corpus starts with exact surface-form links only. It cannot mark a
sense as confirmed automatically. The personal builder injects only reviewed
bindings and limits copied source text per sense; complete reviewed-link counts
remain in private statistics. The public builder removes both fields and scans
the serialized catalog for private IDs, filenames, and question-text fields.
Question matching is evidence shown after a vocabulary answer and does not
weaken or replace the existing formal study gate.

### CatalogMetadata

- schema version and catalog version
- visibility (`private-local-build` or `public-open-demo`)
- generation timestamp, sampling policy, and provenance records

## Quiz attempt

### DefinitionQuizQuestion

- stable question ID, word ID, sense ID, headword, and POS
- four unique options with one answer key
- three distractor sense IDs selected from the same formal content pool
- attempt seed used to keep the question stable while it is on screen

The correct definition is not revealed before selection. Each of the 292
quiz-target senses uses three exact-sense editorial confusables from the
296-sense formal option pool; a previously selected wrong sense gets
learner-specific priority. Four support-only senses may be selected as
distractors but never become question targets. Every distractor must be
study-ready. The engine excludes the same OEWN/CILI concept, bidirectional
synonyms, and near-duplicate meanings that could create two defensible answers.

### DefinitionQuizEvaluation

- correctness and selected/correct option IDs
- system-inferred rating and confidence
- response band: incorrect, first exposure, effortful, recalled, fluent, or
  timing unscored
- mastery decision: not mastered, learning, remembered, or fluent
- learner-facing feedback

One correct answer on first exposure is only `learning`, not mastery, because a
four-choice question has a 25% chance baseline. Response time may be disabled as
an accessibility setting.

## Learner profile

### LearningState

- sense ID, review count, and lapse count
- stability, difficulty, and next review time
- definition, relationship, and context mastery
- last system-inferred rating and confidence
- optional response time and schedule reason

### DailyPlan

- local date, catalog version, and deterministic seed
- normalized daily new-word target used to generate the plan
- selected word IDs and actual focus/long-tail counts
- generation time
- optional persisted `activeSession` for an additional-new-word batch, including
  its complete sense order and next unanswered index

Changing the target on the same date counts today's completed new words first
and creates a deterministic plan only for the remaining quota. Additional
new-word batches exclude already learned/currently planned words, retain the
same focus/long-tail policy, and are written to the daily plan before the first
card so their remaining order survives refresh.

### SenseOverlay

- user context note
- additive user-confirmed or edited relations
- local-only examples or source references

The overlay is stored separately so catalog updates do not overwrite user work
or promote private content into a public catalog. Overlay relations are unioned
with catalog relations and never change the catalog's `relationState`; adding a
relation to an unverified sense therefore cannot make it study-ready.

## Event log

### ReviewEvent

- unique event ID, word ID, sense ID, timestamp, and producing catalog version
- review or mistake kind
- system-inferred rating, confidence, response time, reason, and note
- question type and question ID
- selected option/sense, correct option, and correctness
- response band and distractor sense IDs

Events are stored individually and are no longer silently truncated. A wrong
answer writes evidence immediately and appends a same-session retry. Legacy
wrong choices are replayed only if they still belong to the current editorial
confusable graph, so obsolete random options cannot pollute later sessions.

## Mock-test mistake record (private learner data)

### MockMistakeRecord

- hard storage boundary: `private_local_only`
- draft, active, mastered, or archived state
- TC, SE, RC, CR, Quant, AWA, or other question type
- optional passage, question text, structured options, original answer, and
  correct answer
- one or more categorized error causes
- correct reasoning, trap analysis, improvement action, and notes
- linked word and sense IDs
- mock/source metadata and optional local screenshot data URL
- OCR evidence only when supplied by a local/external workflow; the App itself
  does not upload screenshots or call an OCR service
- mastery, lapse count, next review time, and append-only re-attempt history

Incomplete screenshot records remain drafts. A record enters reinforcement only
after question text, answers, error cause, and correct reasoning pass the local
readiness check. A safe standalone export removes screenshot bytes, raw OCR
text, and local paths by default; the full private App backup intentionally
retains them.

## Settings

- exam date, daily new-word target, and due-review limit
- whether response time may influence the inferred result
- human-audio playback speed

## Migration constraints

- v1 state and backup formats remain readable.
- Compatible stable sense IDs retain learning state.
- Unknown custom words remain in the learner profile.
- An automatic catalog match must not overwrite a user overlay.
- New alignment fields default conservatively; missing legacy evidence must not
  be interpreted as `verified`.
- New relation-evidence fields also fail closed: missing `relationState` or
  `relationSource` migrates as `unverified` even if legacy arrays are populated.
- A future migration must present ambiguous legacy sense matches for review
  instead of guessing.
