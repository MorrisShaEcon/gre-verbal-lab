# Contributing

The project is currently in a personal alpha. Product decisions are made by the
product owner, while implementation changes should remain reviewable and
reversible.

## Workflow

1. Describe meaningful work in an Issue.
2. Create a focused branch.
3. Add tests for behavior changes.
4. Open a Pull Request with screenshots for visible UI changes.
5. Update `CHANGELOG.md` for user-visible changes.
6. Run `pnpm catalog:audit` and `pnpm quiz:audit` for catalog changes.
7. Merge only after the product owner accepts the behavior.

## Versioning

- Patch: fixes and small internal improvements
- Minor: backward-compatible user-facing capability
- Major: incompatible data or workflow change

Pre-1.0 releases may still change the data model. Migration notes are required
for any stored-data change.

## Content policy

Do not commit:

- copyrighted GRE questions without permission;
- unlicensed film or television scripts, subtitles, or dialogue;
- commercial vocabulary lists;
- personal attempts, notes, or exported study data;
- secrets, API keys, or account credentials.

Open examples and recordings must retain source, creator when applicable, and
license metadata. A traceable source does not prove that an example matches the
intended sense: new content must pass the source, rights, target-visibility, and
sense-alignment checks independently.

User-provided private content belongs in gitignored local catalogs or overlays.
Do not copy it into `catalog.open.json` merely because it works in a personal
build.

For the public demo, a Chinese definition may be emitted from Chinese Open
Wordnet only when the primary sense has an exact CILI alignment to the retained
Open English WordNet sense. Do not overwrite one definition field while
inheriting the English gloss, examples, or `verified` state from another sense.
