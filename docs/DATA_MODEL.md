# Data model

## Core entities

### Word

- `id`
- `headword`
- `normalizedHeadword`
- `pronunciation`
- `frequencyTier`
- `status`
- `createdAt`
- `updatedAt`

### WordSense

- `id`
- `wordId`
- `partOfSpeech`
- `definitionZh`
- `definitionEn`
- `usageNote`
- `register`
- `polarity`
- `sourceId`
- `confirmationState`

### LexicalRelation

- `id`
- `fromSenseId`
- `toSenseId`
- `relationType`
- `strength`
- `contextNote`
- `sourceId`
- `confirmationState`

### LearningState

- `id`
- `senseId`
- `definitionMastery`
- `relationshipMastery`
- `contextMastery`
- `questionMastery`
- `stability`
- `difficulty`
- `lastReviewedAt`
- `nextReviewAt`
- `lapseCount`

### Question

- `id`
- `questionType`
- `privateSourceReference`
- `promptText`
- `explanation`
- `copyrightVisibility`
- `createdAt`

### QuestionSenseLink

- `questionId`
- `senseId`
- `role`

Possible roles include stem, option, correct answer, distractor, and explanation.

### Attempt

- `id`
- `questionId`
- `selectedAnswer`
- `isCorrect`
- `confidence`
- `responseTimeMs`
- `attemptedAt`

### MistakeTag

- `attemptId`
- `reason`
- `note`

### ReviewEvent

- `id`
- `senseId`
- `activityType`
- `rating`
- `confidence`
- `responseTimeMs`
- `scheduledReason`
- `reviewedAt`

### ReinforcementTask

- `id`
- `sourceAttemptId`
- `activityType`
- `senseIds`
- `dueAt`
- `status`

## Important constraints

- A word may have multiple senses with independent learning states.
- A lexical relationship always connects two senses, never only two spellings.
- Deleting imported content must not silently delete attempt history.
- AI-created senses and relationships remain unconfirmed until accepted.
- Public exports must exclude private question text by default.

