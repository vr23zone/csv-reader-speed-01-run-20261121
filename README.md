# csv-reader-speed-01-run-20261121 — fast csv-reader 1.0.0 drop-in

A faster reimplementation of make.fun's csv-reader 1.0.0 with byte-identical
answers on every input. `run(input)` returns `{columns, rows, errors}` for
`{text, header}` exactly as the reference does, including every broken-row
rule (BOM, stray CR, unterminated quotes, quote junk, short/long rows,
blank lines, CRLF inside quotes).

## How it is faster

The reference reads one character at a time, building each field with `+=`
and a function call per field. This version keeps the same single pass but:

- Unquoted fields are found with one native regex scan for the next
  delimiter (`[,\r\n]`) and sliced out whole — no per-character loop.
  The common case (comma / LF / CRLF terminator) is inlined in the
  record loop, so there is no function call or result object per field;
  only a lone CR falls back to the shared scan.
- Quoted fields find their closing quote with `indexOf` (skipping `""`
  pairs), then slice the content whole; CR/LF normalisation and `""`
  unescaping run only when the content actually contains them, and line
  breaks inside quotes are counted with an `indexOf` walk.
- Line numbers are tracked incrementally (one increment per line break
  consumed), so error records carry the exact line with no extra pass.

Nothing is cached from one case to the next; each `run(input)` is pure.

## Verification

- All 6 practice cases: answers identical to the reference and to
  `practice/reference/expected.json`.
- 8,652 differential fuzz cases (hand-written edge cases, structured
  random records, token soup): 0 mismatches vs the reference.
- 18 further cases drawn by the kit's own generator from 3 fresh seeds:
  0 mismatches.
- Speed on the practice set (this machine, `--no-incremental-marking`,
  trimmed mean of 15 runs): reference ~513 ms, this entry ~92 ms
  (**~5.6x**).

## Layout

- `solve.js` — the entry (`run(input)`).
- `main.ts` — the house driver, unchanged: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`.
- `package.json`, `LICENSE` (MIT).
