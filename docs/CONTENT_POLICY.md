# Content, rights, and provenance policy

## Four independent checks

Content is eligible for the formal study queue only after four different
questions have been answered:

1. **Source:** Can the app identify where the definition, example, or recording
   came from?
2. **Rights:** Does the public or private build have permission to use it in that
   context, with any required attribution?
3. **Sense alignment:** Does it express the exact Chinese word sense being
   tested, rather than another sense of the same headword?
4. **Card completeness:** Is this the canonical word+sense record, with matching
   POS, trusted IPA, independently checked synonym and antonym evidence, and a
   visible sourced example before it is scheduled?

These checks must not be collapsed. `source_verified` means that the source
record was checked; it does not prove semantic alignment or redistribution
rights. Formal scheduling additionally requires `alignmentState: "verified"`.

## Public catalog

The public catalog may contain:

- original project writing, clearly labelled as original;
- open lexical data and dictionary examples with source and license;
- openly licensed human recordings with the individual file's creator, license,
  source page, and direct media URL;
- source names, URLs, question numbers, episode or time locators, counts, and
  other factual metadata;
- user-authored notes exported deliberately by that user.

It may not contain commercial word-list text, copied ETS questions, copied
answer choices or explanations, unlicensed film or television scripts,
subtitles or dialogue, third-party newspaper examples, or a personal study
history.

The fact that text is visible in a purchased book, streaming subscription,
dictionary application, or browser does not grant redistribution rights.

## Private local catalog

A learner may generate a private local catalog from materials they lawfully
possess or may access. It is gitignored, is named `PERSONAL` when packaged, and
must never be attached to a public release.

Private import supports local study, notes, source locators, and user-provided
examples. It does not convert third-party material into open content, and the
app must not silently promote it into the public catalog. The learner remains
responsible for the terms that apply to a source.

## Example labels

- `dictionary`: dictionary or lexical example with source and reuse terms.
- `gre_official`: authentic GRE text only when the current build has explicit
  permission to store and display it.
- `screen_dialogue`: film or television dialogue only when the current build has
  explicit permission to store and display it.
- `original_gre_style`: project-authored practice text, not an ETS question and
  not evidence of authentic GRE occurrence.
- `private_reference`: local source metadata or user content that must not enter
  a public build.

Original GRE-style writing may be useful supplementary practice, but it does not
satisfy a request for a dictionary, authentic GRE, or licensed screen example.

## Review and alignment labels

- `auto_candidate`: a machine-generated source or sense match awaiting review.
- `source_verified`: source identity and metadata have been checked.
- `editor_reviewed`: a person checked the item against the intended sense.
- `alignmentState: "verified"`: accepted for formal scheduling after editorial
  review or a conservative alignment rule.
- `alignmentState: "candidate"`: plausible but not strong enough for formal
  scheduling.
- `alignmentState: "unverified"`: missing or conflicting sense evidence.
- `alignmentScore`: a 0–1 confidence score, never a substitute for the state.
- `alignmentSource`: the lexical mapping, rule, or editorial record that supports
  the state.
- `relationState`: `verified` only when both synonym and antonym fields have been
  checked against the aligned OEWN sense; a field may be present or
  source-checked empty. `user_supplied` and `unverified` stay out of the formal
  queue.
- `relationSource`: exact lexical source for that verified set. A populated
  legacy array without this field fails closed.
- `relationEvidence`: per-kind OEWN evidence. `verified_present` requires a
  non-empty matching array; `source_checked_absent` requires an empty array and
  means only that the aligned OEWN source was checked without finding a direct
  relation. It must never be displayed as an unresolved editorial placeholder.
- `studyReviewState`: private editorial state. `editor_approved` records a
  reviewed correction; `excluded` always stays out of formal scheduling.

An example also needs a non-empty source label and provenance, compatible reuse
rights for the build, and visible use of the target word or an accepted
inflection.

## Audio policy

- Treat text IPA and playable audio as separate evidence.
- Formal IPA must come from a source-verified dictionary transcription or an
  explicit editorial review. An automatic CMU ARPAbet conversion is labelled
  approximate and never satisfies the formal gate by itself.

- Prefer embedded human recordings from Lingua Libre or Wikimedia Commons.
- Store attribution per recording because Commons files do not all share one
  license.
- Retain creator, license, license URL, source page, dialect, and media URL.
- Accept a recording only when structured metadata or a recognized filename
  convention provides explicit English-language evidence; unknown language is
  rejected rather than labelled English.
- Reject non-commercial, no-derivatives, and unknown licenses from the embedded
  audio catalog.
- Cache or redistribute a recording only as allowed by that file's license.
- Label system speech as synthetic and use it only when no eligible human
  recording is available.
- Commercial dictionary or pronunciation APIs may be added only under their
  current contract, quota, caching, branding, and key-security requirements.

## Current attribution sources

- [Open English WordNet 2025](https://en-word.net/): CC BY 4.0.
- [Open Multilingual Wordnet](https://omwn.org/): individual lexicons retain
  their stated licenses.
- [CMU Pronouncing Dictionary](http://www.speech.cs.cmu.edu/cgi-bin/cmudict):
  retain its source notice; automatic display conversions are approximate.
- [Wiktionary](https://en.wiktionary.org/): source-pinned pronunciation
  overrides retain the permanent revision URL and CC BY-SA attribution.
- [Lingua Libre](https://lingualibre.org/) and
  [Wikimedia Commons](https://commons.wikimedia.org/): retain the license and
  attribution recorded on each file page.
- Original GRE Verbal Lab contexts: project-authored and explicitly not ETS
  material.

[ETS material](https://www.ets.org/legal/permissions/licensing.html) is governed
by ETS permissions and licensing terms. Public builds store references rather
than question text unless explicit redistribution permission has been obtained.
