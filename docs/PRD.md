# GRE Verbal Lab — V0.1 Product Requirements

## 1. Product statement

GRE Verbal Lab is a personal adaptive learning system that connects vocabulary,
word-sense relationships, question context, mistakes, and spaced review into one
continuous learning loop.

It is not intended to be another static word-list application. Its core value is
deciding **what this learner should practice next and why**.

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
5. Passive multiple-choice recognition creates false confidence.
6. Using several word lists at once fragments progress and review history.

## 4. Product goals

- Maintain a single source of truth for words, senses, and relationships.
- Measure definition recall, lexical relations, contextual understanding, and
  question performance separately.
- Generate a daily queue from due reviews, weaknesses, exam proximity, and
  mistake history.
- Make every scheduling decision understandable to the learner.
- Keep private study content on the user's device by default.

## 5. Non-goals for the first release

- Social feeds, leaderboards, or public user profiles
- A marketplace for copyrighted test-preparation content
- Fully automatic trust in AI explanations
- Multi-user classroom administration
- Native iOS or Android applications
- Cloud accounts and payment systems

## 6. Core concepts

### 6.1 Word-sense mastery

Mastery belongs to a specific sense of a word. Each sense has four independent
dimensions:

1. definition recall;
2. synonym and antonym discrimination;
3. contextual interpretation;
4. question performance.

### 6.2 Lexical relationships

Relationships are directional and sense-specific. Supported initial types:

- core synonym;
- contextual synonym;
- antonym;
- contrast;
- easily confused;
- similar form;
- possible sentence-equivalence pair.

Each relationship stores its source and confirmation state.

### 6.3 Mistake reasons

An incorrect attempt must be classifiable as one or more of:

- unknown stem word;
- unknown option word;
- wrong synonym relationship;
- missed contrast, cause, concession, or continuation signal;
- incorrect tone or intensity;
- unsupported reading inference;
- careless action;
- time pressure;
- correct guess with low confidence.

## 7. Main user journeys

### Journey A — Daily study

1. Open Today.
2. See task count and estimated time.
3. Complete active-recall cards and relationship drills.
4. Record confidence and response time.
5. Receive the next item without configuring the schedule manually.

### Journey B — Record a mistake

1. Add a question or a short personal context note.
2. Record the selected and correct answers.
3. Tag the mistake reason.
4. Link implicated words and senses.
5. System schedules original replay, word-sense reinforcement, and transfer
   practice.

### Journey C — Inspect a word

1. Search a word.
2. Choose a sense.
3. Review confirmed relationships, example contexts, attempts, and mastery.
4. Add or confirm a relationship.
5. Start targeted practice.

### Journey D — Weekly review

1. Inspect retention, question accuracy, and response time.
2. See the weakest word-sense clusters and mistake reasons.
3. Accept the suggested weekly emphasis or modify the available study time.

## 8. Functional requirements for v0.2

### Import

- Import a user-owned XLSX or CSV vocabulary list.
- Preview field mapping before saving.
- Detect duplicates without deleting distinct senses.
- Keep the original import private and local.

### Vocabulary library

- Search and filter words.
- Create and edit senses.
- Store part of speech, definition, note, frequency, and source.
- Archive without destroying history.

### Review

- Show prompt before answer.
- Support Again, Hard, Good, and Easy ratings.
- Capture response time and confidence.
- Schedule the next review and explain the decision.
- Provide keyboard and touch controls.

### Daily queue

- Respect a configurable time budget.
- Prioritize overdue and mistake-linked items.
- Mix recall, relationship, context, and mistake-replay activities.
- Avoid presenting excessive near-synonyms consecutively unless contrast is the
  explicit exercise.

### Backup

- Export all personal data to a portable file.
- Restore from an exported file.
- Never require an account for core functionality.

## 9. Adaptive priority model

The daily priority of an activity is based on:

- overdue amount;
- predicted recall difficulty;
- recent lapse severity;
- GRE frequency or user-assigned importance;
- relationship interference;
- linked-question mistakes;
- slow correct answers;
- low-confidence correct answers;
- days remaining before the exam;
- recent workload balance.

The system must expose a short reason such as:

> Scheduled today because this sense was confused twice with *mitigate* and
> appeared in a recent Text Completion mistake.

## 10. Success criteria

For the personal alpha:

- At least 80% of study sessions begin from the generated Today queue.
- A mistake can be recorded in less than 45 seconds.
- Every recorded mistake produces at least one future reinforcement activity.
- The learner can explain why any item is scheduled.
- Personal study content remains usable without internet access.

## 11. Open product decisions

- Final public project name and GitHub organization strategy
- Whether the first import supports only the current vocabulary workbook or a
  reusable mapping interface
- Default daily time budget
- Whether example sentences are entered manually or generated as unconfirmed
  suggestions
- Scope of the first question-entry interface

