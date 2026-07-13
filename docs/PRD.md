# GRE Verbal Lab — v2.2.0 Product Requirements

## 1. Product statement

GRE Verbal Lab is a personal adaptive learning system that connects vocabulary,
word-sense relationships, sourced context, mistakes, and spaced review into one
continuous learning loop.

It is not another static word-list application. Its core value is deciding
**what this learner should practice next, testing it without self-report, and
explaining the decision**.

## 2. Primary user

The initial user:

- has strong general English ability;
- studies or works in an English-language environment;
- needs GRE-specific vocabulary precision and reasoning habits;
- wants to connect vocabulary study with real question performance;
- needs a system that adapts to an October 2026 exam date;
- values privacy and control over personal learning data.

## 3. User problems

1. A word can feel familiar while its GRE-tested sense remains unknown.
2. Synonym lists hide differences in register, intensity, polarity, and context.
3. Existing vocabulary apps rarely connect a word to the questions where it
   caused mistakes.
4. Mistake notebooks record answers but do not automatically change the future
   study plan.
5. Asking the learner to self-label a word as “known” creates inconsistent data.
6. A single correct multiple-choice response can be a guess and must not be
   treated as mastery.
7. An authentic-looking example may have unclear rights or may express the wrong
   sense of a polysemous word.
8. Using several word lists at once fragments progress and review history.

## 4. Product goals

- Maintain a single source of truth for words, senses, relationships, audio, and
  context provenance.
- Test every new or due definition with four choices: one correct and three
  formally validated alternatives, preferring explicit confusion evidence when
  it exists.
- Infer mastery from observed answers and history rather than manual ratings.
- Measure definition recall, lexical relations, contextual understanding, and
  question performance separately.
- Generate a daily queue from due reviews, weaknesses, exam proximity, and
  mistake history.
- Prefer attributable human pronunciation and label any synthetic fallback.
- Admit only semantically aligned, rights-compatible examples to formal study.
- Keep private study content on the user's device by default.

## 5. Non-goals for the alpha

- Social feeds, leaderboards, or public user profiles
- A marketplace for copyrighted test-preparation or entertainment content
- Claiming that derived local occurrence counts are official GRE frequency
- Treating AI or lexical matching as editorial truth without evidence
- Full public redistribution of ETS questions, film scripts, or television
  dialogue without permission
- Native iOS or Android applications
- Cloud accounts and payment systems

## 6. Core concepts

### 6.1 Word-sense mastery

Mastery belongs to a specific sense of a word. Each sense has four independent
dimensions:

1. definition recognition and recall;
2. synonym and antonym discrimination;
3. contextual interpretation;
4. question performance.

One first-exposure correct answer is `learning`, not mastery. Repeated correct
retrieval across time provides stronger evidence; a wrong answer is a lapse and
must schedule reinforcement.

### 6.2 Four-choice definition test

- Show the word, POS, IPA, and pronunciation before revealing meaning.
- Provide exactly four unique Chinese definitions.
- Select distractors only from the 296-sense formal option pool. Each of the 292
  quiz-target senses has three editor-reviewed exact-sense, same-POS semantic
  distractors; four support-only senses may appear as distractors but never as
  question targets. A learner's earlier wrong choice is promoted on later
  attempts.
- Do not use pure spelling similarity as evidence that two meanings are
  genuinely confusable.
- Exclude synonyms, duplicate definitions, and alternatives so close that more
  than one could be defended.
- Randomize position with a stable per-attempt seed.
- Reveal the answer and explanation only after selection.
- Infer `Again`, `Hard`, `Good`, or `Easy` internally; do not ask the learner to
  assign the rating.
- Allow response-time evidence to be disabled for accessibility.

### 6.3 Lexical relationships

Relationships are directional, sense-specific, and source-aware. Supported
initial types:

- core synonym;
- contextual synonym;
- antonym;
- contrast;
- easily confused;
- similar form;
- possible sentence-equivalence pair.

### 6.4 Content eligibility

A formal study sense requires:

- a canonical word+OEWN sense record and POS matching the OEWN sense key;
- source-verified dictionary IPA or an explicitly editor-reviewed IPA;
- `alignmentState: "verified"`, supported by `alignmentScore` and
  `alignmentSource`;
- `relationState: "verified"`, independently checked synonym and antonym
  evidence (`verified_present` or `source_checked_absent`), and a structured
  `relationSource`;
- at least one dictionary, licensed official GRE, or licensed screen example;
- a traceable source and provenance record;
- reuse rights compatible with the current private or public build;
- visible use of the target word or an accepted inflection;
- evidence that the example expresses the tested sense.

An editor may explicitly approve or exclude a private sense. Automatic CMU IPA
conversion and partial Chinese-lemma overlap remain background evidence and do
not independently satisfy the formal gate.

Source verification, legal permission, and sense alignment are independent. An
original GRE-style example is allowed as supplementary practice but does not
substitute for a requested sourced example.

### 6.5 Pronunciation

- Prefer human recordings from an open or contracted source.
- Show dialect, creator/source, and license with the recording.
- Permit 0.8× and 1× playback without changing the stored source.
- Discover an eligible Commons recording on demand when none is embedded.
- Label system speech as synthetic and use it only as fallback.

### 6.6 Mistake reasons

An incorrect attempt may be associated with one or more of:

- unknown stem word;
- unknown option word;
- wrong synonym relationship;
- missed contrast, cause, concession, or continuation signal;
- incorrect tone or intensity;
- unsupported reading inference;
- careless action;
- time pressure;
- uncertain correct answer or suspected guess.

## 7. Main user journeys

### Journey A — Daily study

1. Set today's new-word target and see remaining words, estimated study days,
   completion date, task count, and estimated time.
2. Hear a human recording when available.
3. Choose the most accurate Chinese definition from four options.
4. Receive a system judgment and then inspect definition, relationships,
   examples, source, and scheduling reason.
5. Continue without configuring a rating or schedule.
6. Encounter a wrong answer again later in the same session.
7. Finish the planned round or request another saved 70/30 batch without a
   fixed daily ceiling.

### Journey B — Record and review a mock-test mistake

1. Attach a local screenshot and add a question reference or context.
2. Record the selected and correct answers.
3. Tag the mistake reason.
4. Link implicated words and senses.
5. System schedules original replay and word-sense reinforcement.
6. When due, answer again before the solution is revealed; the system judges
   correctness and records the next interval.

### Journey C — Inspect a word

1. Search a word and choose a sense.
2. Review alignment state, relationships, sourced examples, audio attribution,
   attempts, and mastery.
3. Add or confirm a private relationship or example.
   Private relation overlays remain additive notes and never upgrade the
   catalog's relation verification state.
4. Start targeted practice only if the sense passes the content gate.

### Journey D — Add private material

1. Open advanced data management.
2. Import a user-owned XLSX/CSV list or attach a local source reference.
3. Preview field mapping and confirm that the content remains local.
4. Use the overlay without adding it to public catalog or GitHub output.

### Journey E — Inspect a reviewed local GRE context

1. Answer a vocabulary question before any meaning or context is revealed.
2. Expand a local GRE recall/practice match for the exact current sense.
3. Inspect passage, stem, options, answer, PDF pages, match location, and the
   item-level editorial review note.
4. Treat a word-form-only occurrence as a search lead, never as proof that the
   question tests this sense.

## 8. Functional requirements

### Built-in catalog

- First launch starts from a versioned default vocabulary database.
- Catalog entries may include display IPA, human audio, lexical relationships,
  contexts, alignment evidence, priority evidence, and provenance.
- Catalog upgrades do not overwrite learner history or user overlays.
- Unverified entries remain in the local catalog for later editorial work but
  do not enter the formal queue or expose candidate English glosses as facts.

### Review and scheduling

- A new or due sense is tested before meaning is revealed.
- Every definition question has one answer and three unique distractors.
- Correctness, prior review count, lapse history, and optional response time
  determine the inferred rating.
- A wrong answer is written immediately and appended once to the session.
- The next interval and its reason are visible after answering.
- Keyboard 1–4 and touch controls are supported.

### Daily queue

- Accept a 1–200 daily new-word target and forecast the study days/completion
  date from the remaining formally eligible words.
- Count words already completed today toward today's target when it changes.
- Permit additional user-requested 70/30 batches and persist each batch before
  study begins.

- Respect configurable new-word and due-review limits.
- Prioritize overdue and mistake-linked items.
- Use a stable 70% focus / 30% long-tail new-word mix.
- Avoid excessive near-synonym adjacency unless contrast is the exercise.
- Exclude senses that fail the alignment or example gate.

### Audio

- Prefer eligible human audio and expose source attribution.
- Cache discovered metadata locally and audio on demand.
- Keep commercial API credentials out of the browser and repository.
- Do not claim that synthetic playback is human pronunciation.

### Private import and backup

- Import a user-owned XLSX or CSV vocabulary list from advanced settings.
- Preview field mapping and detect duplicates without deleting distinct senses.
- Keep the original import, local examples, and learning state private.
- Export all personal data to a portable file and restore it without an account.

## 9. Adaptive evidence model

The daily priority and inferred result may use:

- answer correctness;
- prior successful retrievals;
- recent lapse severity;
- optional response time;
- overdue amount and predicted recall difficulty;
- GRE relevance or user-assigned importance;
- relationship interference;
- linked-question mistakes;
- days remaining before the exam;
- recent workload balance.

The system exposes a short reason such as:

> This sense is repeated because it was confused with *mitigate* earlier in the
> session and is linked to a recent Text Completion mistake.

## 10. Success criteria

For the personal alpha:

- At least 80% of sessions begin from the generated Today queue.
- Every scheduled definition item has exactly four unique choices and one key.
- No first-exposure correct answer is labelled mastered.
- Every wrong answer creates both a review event and future reinforcement.
- Every scheduled sense is `verified` and has an eligible sourced example.
- Every human recording exposes source and license metadata.
- The learner can explain why any item was scheduled.
- Personal study content remains usable without an account and is excluded from
  public releases.

## 11. Open product decisions

- Editorial threshold and review workflow for the remaining catalog backlog
- Whether a licensed commercial dictionary API materially improves the open
  audio coverage enough to justify its cost and restrictions
- Structure of private ETS question references and local-only screen dialogue
- Default daily time budget
- Scope of relationship, cloze, and sentence-equivalence transfer drills
