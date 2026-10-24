# Lens incident examples

Captured incidents remain reference material for lens changes:

```text
incidents/<issue-number>/
  diff.patch        # the original breaking change
  expected.json     # {"lens": "...", "must_find": "one-line description"}
```

When editing a lens, supply the captured diff, `REVIEW.md` and the named lens to the independent reviewer.
Compare actual findings with `must_find` and record any miss with the change.
The retired replay command is no longer part of verification.
The supported runner and its behavior tests are documented in [simple review](../../review/simple-review.md).
