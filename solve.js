// Fast drop-in for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
// Same answers as the reference on every input, found by scanning with
// indexOf/slice instead of one character at a time.
//
// Semantics (mirroring the reference exactly):
// - U+FEFF at the very start is dropped; a record ends at LF or CRLF;
//   a line left with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with a quote runs to the next quote that is not
//   doubled; "" inside it is one quote; CRLF or a lone CR inside it is
//   read as LF; what follows its closing quote up to the next comma or
//   line break is appended as it stands (quote_junk, when the field
//   ends); a quote that never closes is a literal character and the text
//   after it is read again as unquoted (unterminated_quote).
// - A quote inside an unquoted field is a literal character. Fields stay
//   strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows are
//   padded (short_row, fields: count) or cut (long_row, extra: cut
//   fields) to the first record's width. Errors are {code, line, row}
//   in the order met; line is the 1-based line the record starts on,
//   counting every LF, CRLF and lone CR inside quotes.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows
  // it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Count LF characters in s (each is one line break).
  function countLF(s) {
    let c = 0;
    let i = s.indexOf('\n');
    while (i !== -1) {
      c += 1;
      i = s.indexOf('\n', i + 1);
    }
    return c;
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field and how it ended; `added` counts the characters kept after
  // the starting value.
  const DELIM = /[,\r\n]/g;
  function readUnquoted(value) {
    let added = 0;
    let start = pos;
    for (;;) {
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      const cut = m ? m.index : -1;
      const kind = m ? (m[0] === ',' ? 0 : m[0] === '\n' ? 1 : 2) : -1;
      if (cut === -1) {
        if (start < n) {
          value += text.slice(start);
          added += n - start;
        }
        pos = n;
        return { value, ended: END, added };
      }
      if (kind === 2) {
        // CR: line break when followed by LF, else a dropped stray CR.
        if (text.charCodeAt(cut + 1) === 10) {
          if (cut > start) {
            value += text.slice(start, cut);
            added += cut - start;
          }
          pos = cut + 2;
          line += 1;
          return { value, ended: LINE_BREAK, added };
        }
        if (cut > start) {
          value += text.slice(start, cut);
          added += cut - start;
        }
        error('stray_cr');
        pos = cut + 1;
        start = cut + 1;
        continue;
      }
      if (cut > start) {
        value += text.slice(start, cut);
        added += cut - start;
      }
      if (kind === 0) {
        pos = cut + 1;
        return { value, ended: COMMA, added };
      }
      pos = cut + 1;
      line += 1;
      return { value, ended: LINE_BREAK, added };
    }
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let q = text.indexOf('"', pos + 1);
    let hasDDQ = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      hasDDQ = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    let value = text.slice(open + 1, q);
    if (value.indexOf('\r') !== -1) {
      // CRLF and lone CR inside quotes are each one LF.
      value = value.replace(/\r\n?/g, '\n');
      if (hasDDQ) value = value.replaceAll('""', '"');
      line += countLF(value);
    } else {
      if (hasDDQ) value = value.replaceAll('""', '"');
      line += countLF(value);
    }
    pos = q + 1;
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to
    // the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        const f = readQuoted();
        fields.push(f.value);
        ended = f.ended;
        continue;
      }
      // Inline the common unquoted field: one delimiter scan, one slice.
      const start = pos;
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        fields.push(text.slice(pos));
        pos = n;
        ended = END;
        continue;
      }
      const d = m[0];
      if (d === ',') {
        fields.push(text.slice(pos, m.index));
        pos = m.index + 1;
        ended = COMMA;
        continue;
      }
      if (d === '\n') {
        fields.push(text.slice(pos, m.index));
        pos = m.index + 1;
        line += 1;
        ended = LINE_BREAK;
        continue;
      }
      // CR: a line break when followed by LF, else a dropped stray CR
      // (rare: fall back to the shared scan for the rest of the field).
      if (text.charCodeAt(m.index + 1) === 10) {
        fields.push(text.slice(pos, m.index));
        pos = m.index + 2;
        line += 1;
        ended = LINE_BREAK;
        continue;
      }
      error('stray_cr');
      const prefix = text.slice(start, m.index);
      pos = m.index + 1;
      const rest = readUnquoted(prefix);
      fields.push(rest.value);
      ended = rest.ended;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
