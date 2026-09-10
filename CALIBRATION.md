# Pathmode readiness calibration and regression suite

Run it:

```bash
node scripts/readiness-suite.mjs
```

It downloads the exact `@pathmode/mcp-server` version pinned in [`.mcp.json`](.mcp.json), drives
it over MCP the way Claude Code does, and grades the printed verdict. No Pathmode account, no key,
no network beyond the npm download.

## Read this before quoting a number

**The headline number is not an accuracy result, and we will not present it as one.**

Three things get confused here, and they are not the same claim:

1. **Determinism.** The same spec gets the same verdict every time. That is a property of pure
   functions with no model call, and it is easy to check.
2. **Agreement with our labels.** The gate's verdict for a phrasing matches the `good`/`vague`
   label a human wrote for it. That is what Part A measures.
3. **Whether the spec describes the right product decision.** **Nothing here measures this**, and
   no corpus of this shape could. A spec can score 6/6 and be a bad idea, clearly stated.

Part A is a **regression baseline, not independent validation.** These 98 fixtures were written
alongside the rules they score, and the rules were tuned until they agreed. A high score is
therefore evidence that the gate still behaves as it did when it was calibrated. It is not
evidence that the gate generalizes. Independently collected, previously unseen specs would be
stronger evidence, and we do not have them.

Here is the sharpest way to see the limit, from this suite's own output. Part A scores **1.000 on
every kind against both `1.26.3` and `1.27.0`**. Those two releases differ by a real defect that
told authors who had written a constraint in prose that they had written nothing. **The field
corpus cannot tell them apart.** Part B fails three cases on `1.26.3` and none on `1.27.0`.

That is why the document cases exist, and it is a fair summary of what a labeled field corpus is
worth on its own.

## Part A, field-label agreement

For each item in [`readiness-corpus.json`](readiness-corpus.json), one dimension is put under
test inside a spec whose other five dimensions are known to pass, so the verdict for that
dimension reflects the fixture and nothing else.

**The construction trap, since getting it wrong produces a plausible wrong number.** A field
fixture is not a whole-spec pass/fail test. The outcomes gate is *at least two outcomes, and at
least two thirds of them measurable*, so a single good outcome fails on the **count** and would
be recorded as a false negative that is really a fault in the harness. An outcome fixture is
therefore paired with one known-measurable outcome: `good` gives 2 of 2 and passes, `vague` gives
1 of 2 and falls below the threshold. Every other gate is a `some(...)` over its field, so one
item isolates cleanly.

The runner enforces this rather than trusting it. If any dimension other than the one under test
fails, the case is reported as a **fixture construction error**, excluded from the counts, and
named. A suite that folded those into its own score would be reporting a number about itself.

Bring your own fixtures:

```bash
node scripts/readiness-suite.mjs --fixtures my-fixtures.json
```

A fixture is `{ "kind": "objective" | "outcome" | "title" | "constraint" | "verification",
"text": "...", "label": "good" | "vague", "tags": ["optional"] }`.

## Part B, document behaviour

Whole `intent.md` files, in [`fixtures/documents/`](fixtures/documents) with expectations in
[`fixtures/documents.json`](fixtures/documents.json). This is the layer that matters, because the
defects that reached users lived in the step that turns a document into fields, which Part A never
exercises.

Each case records **where its defect actually shipped**, and they are not all equal:

| Case | Provenance |
|---|---|
| prose sections are content, not absence | shipped in `<= 1.26.3`, fixed in `1.27.0` |
| non-English is unconfirmed, never absent | the known limitation the four-state verdict reports honestly |
| italic text the author wrote is content | never released; introduced and fixed between two commits |
| a subsection heading is not a verification check | never released; same |
| a hard-wrapped bullet is one item | never released; same |
| a generated caption is not a check | never released; same |
| bullets baseline, empty headings are still empty | guards against over-correcting the fix |

The four "never released" rows were caught in review before publishing, and three of them made
the gate **pass** a spec that should have failed, which is the worse direction. They are here so
they cannot come back.

## What a failing case looks like

Failures print the fixture, the expected and actual state, and the text the gate says it read, so
a disagreement is reproducible rather than merely asserted:

```
  ✗ prose sections are content, not absence
      constraints: expected pass, got absent
```

The four states are `pass`, `unconfirmed` (text was read, the word lists could not confirm it),
`absent` (nothing was read), and `not_applicable` (a human-approved waiver). The distinction
between `unconfirmed` and `absent` is deliberate: an audit of real specs found that failures on
read-but-unconfirmed text are usually **our** error, not the author's, so the gate must not claim
nothing was written.

## Known limitations, stated plainly

- The gates match a **fixed English vocabulary**. A non-English objective cannot be confirmed, and
  reports as `unconfirmed`. Part B has a Finnish case that holds this behaviour honest.
- 98 fixtures is small, and they are **our own authored examples**, not sampled from real repos.
- The gates judge **phrasing**, not correctness, novelty, feasibility, or whether the decision is
  a good one.
- Part A cannot detect a document-parsing regression, as shown above.

## If you disagree with a verdict

That is the most useful thing you can send us. Open an issue with the fixture and the verdict:
https://github.com/pathmodeio/claude-plugin/issues

A fixture where the gate is wrong is worth more to us than a passing run.
