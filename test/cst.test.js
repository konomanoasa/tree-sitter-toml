import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { parseCorpus } from "./support/corpus.js";
import { parseCst } from "./support/cst.js";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  assertValidHistory,
  parse,
} from "./support/parser.js";

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source } of entries) {
    test(`toml: corpus source coverage, issue ownership and fresh determinism: ${file}: ${name}`, () => {
      const tree = parse(source);
      assert.equal(tree.hasError, false, tree.cst);
    });
  }
}

test("corpus inputs retain BOM, NUL, whitespace and line endings", () => {
  const text = [
    "==================\nEmpty\n==================\n\n---\n(toml)\n\n",
    "==================\nLayout\n:cst\n==================\n",
    "\uFEFF \t\v\f\r\na=1\n\n\n---\nignored output\n\n",
    "==================\nNUL\n:cst\n==================\n",
    'a="\0"\n---\nignored output\n\n',
    "==================\nFinal CR\n:cst\n==================\n",
    "a=1\r\r\n---\nignored output\n",
  ].join("");
  assert.deepEqual(parseCorpus(text), [
    { name: "Empty", source: "" },
    { name: "Layout", source: "\uFEFF \t\v\f\r\na=1\n\n" },
    { name: "NUL", source: 'a="\0"' },
    { name: "Final CR", source: "a=1\r" },
  ]);
});

test("corpus input reader rejects unsupported conditions and framing", () => {
  for (const text of [
    "not a corpus file",
    "==================\nUnclosed header\n",
    "==================\n\n==================\na=1\n---\n",
    "==================\nSkipped\n:skip\n==================\na=1\n---\n",
    "==================\nNo separator\n==================\na=1\n",
  ]) {
    assert.throws(() => parseCorpus(text), { code: "ERR_ASSERTION" }, text);
  }
});

const invalidBytes = Buffer.from([0xff, 0xfe, 0x80]);

test("CST decoding preserves fields, anonymous quotes, UTF-8 byte ranges, CRLF, and issues", () => {
  const source = '"é"=\r\n';
  const cst = [
    "0:0 - 1:0   toml",
    "0:0 - 0:5     expression",
    "0:0 - 0:5       keyval",
    "0:0 - 0:4         key: key",
    "0:0 - 0:4           simple_key",
    "0:0 - 0:4             quoted_key",
    "0:0 - 0:4               basic_string",
    '0:0 - 0:1                 "\\""',
    "0:1 - 0:3                 basic_char",
    "0:1 - 0:3                   basic_unescaped `é`",
    '0:3 - 0:4                 "\\""',
    '0:4 - 0:5         "="',
    "0:5 - 0:5         issue: syntax_issue",
    "0:5 - 0:5           invalid_syntax",
    "0:5 - 0:5             missing_value",
    "0:5 - 1:0     newline",
    "0:5 - 0:7       `\\r\\n`",
  ].join("\n");
  const result = parseCst(cst, source);
  assert.equal(result.hasError, false);
  assert.deepEqual(
    result.nodes.map(({ kind, named, field, parent, start, end }) => [
      kind,
      named,
      field,
      parent,
      start,
      end,
    ]),
    [
      ["toml", true, null, null, 0, 7],
      ["expression", true, null, 0, 0, 5],
      ["keyval", true, null, 1, 0, 5],
      ["key", true, "key", 2, 0, 4],
      ["simple_key", true, null, 3, 0, 4],
      ["quoted_key", true, null, 4, 0, 4],
      ["basic_string", true, null, 5, 0, 4],
      ['"', false, null, 6, 0, 1],
      ["basic_char", true, null, 6, 1, 3],
      ["basic_unescaped", true, null, 8, 1, 3],
      ['"', false, null, 6, 3, 4],
      ["=", false, null, 2, 4, 5],
      ["syntax_issue", true, "issue", 2, 5, 5],
      ["invalid_syntax", true, null, 12, 5, 5],
      ["missing_value", true, null, 13, 5, 5],
      ["newline", true, null, 0, 5, 7],
    ],
  );
  assert.deepEqual(result.issues, [
    ["keyval", "invalid_syntax", "missing_value", 5, 5],
  ]);
});

test("CST decoding detects the native error flag and rejects a truncated root", () => {
  assert.equal(parseCst("0:0 - 0:1   •toml", "a").hasError, true);
  assert.throws(
    () => parseCst("0:0 - 0:0   toml", "a"),
    /root must reach the edited source end/,
  );
});

for (const [name, prefix, suffix, owner] of [
  ["bare key", "ke", "y=1", "simple_key"],
  ["comment", "# a", "b", "comment"],
  ["basic string", 'a="x', 'y"', "basic_string"],
  ["literal string", "a='x", "y'", "literal_string"],
  ["multiline basic string", 'a="""x', 'y"""', "ml_basic_body"],
  ["multiline literal string", "a='''x", "y'''", "ml_literal_body"],
  ["value", "a=", " ", "val"],
  ["document after a complete value", "a=true", "", "expression"],
  [
    "inline table after a complete value",
    "a={b=true",
    "}",
    "inline_table_keyvals",
  ],
  ["decimal digits", "a=12", "3", "unsigned_dec_int"],
  ["hexadecimal digits", "a=0xA", "B", "hex_int"],
  ["octal digits", "a=0o1", "2", "oct_int"],
  ["binary digits", "a=0b0", "1", "bin_int"],
  ["exponent", "a=1e", "2", "zero_prefixable_int"],
]) {
  test(`toml issues: a decoding failure run in ${name} has its own range and reason`, () => {
    const source = Buffer.concat([
      Buffer.from(prefix),
      invalidBytes,
      Buffer.from(suffix),
    ]);
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(
      result.issues,
      [
        [
          owner,
          "invalid_syntax",
          "invalid_encoding",
          Buffer.byteLength(prefix),
          Buffer.byteLength(prefix) + invalidBytes.length,
        ],
      ],
      result.cst,
    );
  });
}

test("toml issues: decoding failures stay isolated across syntax boundaries", () => {
  for (const source of [
    "name = 123\n",
    "a = 2026-10-05T12:34:56+09:00\n",
    "a = [true, 0x1F, -1.2e+3]\n",
    "a = {b=2, c=3}\n",
    "[a.b]\n",
    "[[a.b]]\n",
    "# comment\n",
    String.raw`a="x\u1234y"`,
  ]) {
    for (let byte = 0; byte <= source.length; byte++) {
      const input = Buffer.concat([
        Buffer.from(source.slice(0, byte)),
        invalidBytes,
        Buffer.from(source.slice(byte)),
      ]);
      const result = parse(input);
      assert.deepEqual(
        result.issues
          .filter(([, , reason]) => reason === "invalid_encoding")
          .map(([, , , start, end]) => [start, end]),
        [[byte, byte + invalidBytes.length]],
        `${JSON.stringify({ source, byte })}\n${result.cst}`,
      );
    }
  }
});

const histories = [
  {
    name: "insert trailing array comment and remove comma",
    initial: "a = [true,]",
    steps: [
      {
        byte: 10,
        deleteBytes: 0,
        insert: "# tail\n",
        source: "a = [true,# tail\n]",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "a = [true# tail\n]",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 0,
        insert: ",",
        source: "a = [true,# tail\n]",
        valid: true,
      },
    ],
  },
  {
    name: "move trailing array layout between array and values",
    initial: "a = [true ]",
    steps: [
      {
        byte: 9,
        deleteBytes: 0,
        insert: ",",
        source: "a = [true, ]",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "a = [true ]",
        valid: true,
      },
      {
        byte: 10,
        deleteBytes: 0,
        insert: ",",
        source: "a = [true ,]",
        valid: true,
      },
    ],
  },
  {
    name: "move trailing inline table layout by inserting a comma",
    initial: "a = {b = 1 }",
    steps: [
      {
        byte: 11,
        deleteBytes: 0,
        insert: ",",
        source: "a = {b = 1 ,}",
        valid: true,
      },
      {
        byte: 11,
        deleteBytes: 1,
        insert: "",
        source: "a = {b = 1 }",
        valid: true,
      },
    ],
  },
  {
    name: "edit line ending without losing statement boundary",
    initial: "a = true\nb = false",
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: "\r",
        source: "a = true\r\nb = false",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "a = true\rb = false",
        valid: false,
      },
      {
        byte: 9,
        deleteBytes: 0,
        insert: "\n",
        source: "a = true\r\nb = false",
        valid: true,
      },
    ],
  },
  {
    name: "replace Unicode string content by byte range",
    initial: 'a = "🌿"',
    steps: [
      {
        byte: 5,
        deleteBytes: 4,
        insert: "日本",
        source: 'a = "日本"',
        valid: true,
      },
      {
        byte: 11,
        deleteBytes: 1,
        insert: "",
        source: 'a = "日本',
        valid: false,
      },
      {
        byte: 11,
        deleteBytes: 0,
        insert: '"',
        source: 'a = "日本"',
        valid: true,
      },
    ],
  },
];

for (const { name, initial, steps } of histories) {
  test(`toml: ${name}`, () => {
    assertValidHistory(initial, steps);
  });
}

const lookaheadByteEdits = [
  {
    name: "two-byte character after an integer",
    source: "a=1 é\n",
    byte: 5,
    expected: Buffer.concat([
      Buffer.from("a=1 "),
      Buffer.from([0xc3]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 4, 5]],
  },
  {
    name: "two-byte character after a date",
    source: "a=2020-01-01 é\n",
    byte: 14,
    expected: Buffer.concat([
      Buffer.from("a=2020-01-01 "),
      Buffer.from([0xc3]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 13, 14]],
  },
  {
    name: "three-byte character after an array",
    source: "a=[] あ\n",
    byte: 7,
    expected: Buffer.concat([
      Buffer.from("a=[] "),
      Buffer.from([0xe3, 0x81]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 5, 7]],
  },
  {
    name: "four-byte character after a string",
    source: 'a="x" 😀\n',
    byte: 9,
    expected: Buffer.concat([
      Buffer.from('a="x" '),
      Buffer.from([0xf0, 0x9f, 0x98]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 6, 9]],
  },
];

for (const { name, source, byte, expected, issues } of lookaheadByteEdits) {
  test(`toml: deleting the final byte of a ${name} preserves fresh parsing`, () => {
    const edits = [{ byte, deleteBytes: 1, insert: "" }];
    assert.deepEqual(applyEdits(source, edits), expected);
    const result = assertIncrementalEqualsFresh(source, edits, expected);
    assert.deepEqual(result.issues, issues);
  });
}

for (const { name, source, edits } of [
  {
    name: "merge a decoding run after splitting a Unicode character",
    source: Buffer.from([97, 61, 34, 255, 195, 169, 34]),
    edits: [{ byte: 5, deleteBytes: 1, insert: "" }],
  },
  {
    name: "repair a decoding run after a backslash",
    source: Buffer.from([97, 61, 34, 92, 255, 254, 128, 34]),
    edits: [{ byte: 4, deleteBytes: 3, insert: "n" }],
  },
]) {
  test(`toml: ${name}`, () => {
    assertEditHistory({ source, edits });
  });
}
