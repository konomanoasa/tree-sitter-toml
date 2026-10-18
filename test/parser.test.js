import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  assertValidHistory,
  parse,
} from "./support/parser.js";

const dateTimeCases = [
  ["lowest date elements", "0000-01-01"],
  ["highest date elements", "9999-12-31"],
  ["single-digit month and day", "2026-09-09"],
  ["two-digit month and day", "2026-10-10"],
  ["day in the twenties", "2026-11-29"],
  ["day in the thirties", "2026-11-30"],
  ["lowest time elements", "00:00:00"],
  ["highest time elements", "23:59:60"],
  ["hour in the teens and fractional leap second", "19:59:60.5"],
  ["hour in the twenties without seconds", "20:00"],
  ["local date-time with highest elements", "9999-12-31T23:59:60"],
  ["lowercase date-time delimiters", "2026-01-01t12:34z"],
  ["zero positive offset", "2026-01-01T00:00+00:00"],
  ["zero negative offset", "2026-01-01T00:00-00:00"],
  ["highest positive offset", "2026-01-01T00:00:00+23:59"],
  ["highest negative offset", "2026-01-01T00:00:00-23:59"],
  ["month-dependent day is left to the consumer", "2026-04-31"],
  ["leap-year validation is left to the consumer", "2026-02-29"],
  ["leap-second validation is left to the consumer", "2026-01-01T12:00:60Z"],
];

for (const [name, value] of dateTimeCases) {
  test(`toml: ${name}`, () => {
    for (const source of [
      `a = ${value}`,
      `a = [${value}]`,
      `a = {b = ${value}}`,
    ]) {
      const result = parse(source);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [], result.cst);
      assert.match(result.cst, /\bdate_time\b/);
      assert.deepEqual(
        [...result.cst.matchAll(/\bdigit `([0-9])`/g)].map((match) => match[1]),
        value.match(/[0-9]/g),
      );
    }
  });
}

test("toml issues: long tokens retain every normal digit and character", () => {
  const digitCount = 4096;
  const characterCount = 1024;
  for (const { source, leaf, count, owner, reason, issueBytes } of [
    {
      source: `a=${"1".repeat(digitCount)}_`,
      leaf: "digit",
      count: digitCount - 1,
      owner: "unsigned_dec_int",
      reason: "invalid_number",
      issueBytes: Buffer.byteLength("_"),
    },
    {
      source: `a="${"🌿".repeat(characterCount)}`,
      leaf: "basic_unescaped",
      count: characterCount,
      owner: "basic_string",
      reason: "missing_basic_string_close",
      issueBytes: 0,
    },
  ]) {
    const end = Buffer.byteLength(source);
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.equal(
      result.nodes.filter((node) => node.kind === leaf).length,
      count,
    );
    assert.deepEqual(result.issues, [
      [owner, "incomplete_syntax", reason, end - issueBytes, end],
    ]);
  }
});

for (const sequence of [
  String.raw`\uD800`,
  String.raw`\uDFFF`,
  String.raw`\U0000D800`,
  String.raw`\U00110000`,
  String.raw`\UFFFFFFFF`,
]) {
  for (const [prefix, suffix, owner] of [
    ['a="', '"', "basic_string"],
    ['a="""', '"""', "ml_basic_body"],
  ]) {
    test(`toml issues: ${sequence} is not a Unicode scalar in ${owner}`, () => {
      const result = parse(prefix + sequence + suffix);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        [
          owner,
          "invalid_syntax",
          "invalid_escape",
          prefix.length,
          prefix.length + sequence.length,
        ],
      ]);
      const index = result.nodes.findIndex(
        ({ kind }) => kind === "invalid_escape",
      );
      assert.equal(result.nodes[index + 1].kind, "escaped");
      assert.equal(result.nodes[index + 1].parent, index);
    });
  }
}

for (const [sequence, owner, leaves] of [
  ["\\", "escaped", [["\\", 0, 1]]],
  [
    "\\xA",
    "escape_seq_char",
    [
      ["\\", 0, 1],
      ["x", 1, 2],
      ["hexdig", 2, 3],
    ],
  ],
  [
    "\\u12",
    "escape_seq_char",
    [
      ["\\", 0, 1],
      ["u", 1, 2],
      ["hexdig", 2, 3],
      ["hexdig", 3, 4],
    ],
  ],
  [
    "\\U0010",
    "escape_seq_char",
    [
      ["\\", 0, 1],
      ["U", 1, 2],
      ["hexdig", 2, 3],
      ["hexdig", 3, 4],
      ["hexdig", 4, 5],
      ["hexdig", 5, 6],
    ],
  ],
]) {
  for (const quote of ['"', '"""']) {
    test(`toml: ${quote} retains escape prefix ${sequence} before a decoding failure`, () => {
      const prefix = `a=${quote}`;
      const invalidBytes = Buffer.from([0xff, 0xfe, 0x80]);
      const start = Buffer.byteLength(prefix);
      const byte = start + sequence.length;
      const source = Buffer.concat([
        Buffer.from(prefix + sequence),
        invalidBytes,
        Buffer.from(`y${quote}`),
      ]);
      const result = parse(source);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        [
          owner,
          "invalid_syntax",
          "invalid_encoding",
          byte,
          byte + invalidBytes.length,
        ],
      ]);
      assert.deepEqual(
        result.nodes
          .filter(
            (node) =>
              node.start >= start && node.end <= byte && node.start < node.end,
          )
          .map(({ kind, start: begin, end }) => [
            kind,
            begin - start,
            end - start,
          ]),
        leaves,
      );
      const edit = { byte, deleteBytes: invalidBytes.length, insert: "" };
      assertIncrementalEqualsFresh(
        source,
        [edit],
        `${prefix}${sequence}y${quote}`,
      );
    });
  }
}

test("closing recovery keeps decoding failures separate from adjacent junk", () => {
  const result = parse(Buffer.from("a={b=1 x]\xff]}", "latin1"));
  assert.equal(result.hasError, false, result.cst);
  assert.deepEqual(result.issues, [
    ["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 9],
    ["inline_table_keyvals", "invalid_syntax", "invalid_encoding", 9, 10],
    ["inline_table_keyvals", "invalid_syntax", "invalid_character", 10, 11],
  ]);
});

const closingDepth = 128;

test(`closing recovery across ${closingDepth} arrays without an outer inline table`, () => {
  const prefix = `a=${"[".repeat(closingDepth)}1`;
  const source = `${prefix}}${"]".repeat(closingDepth)}`;
  const closingByte = Buffer.byteLength(prefix);
  const result = parse(source);
  assert.equal(result.hasError, false, result.cst);
  assert.deepEqual(result.issues, [
    [
      "array_values",
      "invalid_syntax",
      "invalid_character",
      closingByte,
      closingByte + 1,
    ],
  ]);
  assert.equal(
    result.nodes.filter((node) => node.kind === "array").length,
    closingDepth,
  );
});

test(`closing recovery unwinds ${closingDepth} alternating containers at an outer closing`, () => {
  const prefix = `a=${"[{b=".repeat(closingDepth)}1`;
  const source = `${prefix}${"]".repeat(closingDepth)}`;
  const closingByte = Buffer.byteLength(prefix);
  const result = parse(source);
  assert.equal(result.hasError, false, result.cst);
  assert.equal(
    result.nodes.filter((node) => node.kind === "array").length,
    closingDepth,
  );
  assert.deepEqual(
    result.issues,
    Array.from({ length: closingDepth }, (_, index) => [
      "inline_table",
      "invalid_syntax",
      "missing_inline_table_close",
      closingByte + index,
      closingByte + index,
    ]),
  );
});

const histories = [
  {
    name: "delete a quote after a key that follows rejected fraction junk",
    initial: '=.1_.5 x="',
    steps: [
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "=.1_.5 x=",
        valid: false,
      },
    ],
  },
  {
    name: "insert an invalid numeric suffix inside an unclosed array",
    initial: "a=[1 ",
    steps: [
      { byte: 4, deleteBytes: 0, insert: "a", source: "a=[1a ", valid: false },
      { byte: 4, deleteBytes: 1, insert: "", source: "a=[1 ", valid: false },
      { byte: 5, deleteBytes: 0, insert: "]", source: "a=[1 ]", valid: true },
    ],
  },
  {
    name: "extend date with time and restore separator",
    initial: "a = 2026-09-20",
    steps: [
      {
        byte: 14,
        deleteBytes: 0,
        insert: " 07:32",
        source: "a = 2026-09-20 07:32",
        valid: true,
      },
      {
        byte: 14,
        deleteBytes: 1,
        insert: "\t",
        source: "a = 2026-09-20\t07:32",
        valid: false,
      },
      {
        byte: 14,
        deleteBytes: 1,
        insert: "T",
        source: "a = 2026-09-20T07:32",
        valid: true,
      },
    ],
  },
  {
    name: "cross month bounds and restore a valid date",
    initial: "a = 2026-12-01",
    steps: [
      {
        byte: 9,
        deleteBytes: 2,
        insert: "13",
        source: "a = 2026-13-01",
        valid: false,
      },
      {
        byte: 9,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-00-01",
        valid: false,
      },
      {
        byte: 9,
        deleteBytes: 2,
        insert: "01",
        source: "a = 2026-01-01",
        valid: true,
      },
    ],
  },
  {
    name: "cross day bounds and restore a valid date",
    initial: "a = 2026-01-31",
    steps: [
      {
        byte: 12,
        deleteBytes: 2,
        insert: "32",
        source: "a = 2026-01-32",
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-01-00",
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 2,
        insert: "01",
        source: "a = 2026-01-01",
        valid: true,
      },
    ],
  },
  {
    name: "cross time element bounds and restore a valid time",
    initial: "a = 23:59:60",
    steps: [
      {
        byte: 4,
        deleteBytes: 2,
        insert: "24",
        source: "a = 24:59:60",
        valid: false,
      },
      {
        byte: 4,
        deleteBytes: 2,
        insert: "00",
        source: "a = 00:59:60",
        valid: true,
      },
      {
        byte: 7,
        deleteBytes: 2,
        insert: "60",
        source: "a = 00:60:60",
        valid: false,
      },
      {
        byte: 7,
        deleteBytes: 2,
        insert: "00",
        source: "a = 00:00:60",
        valid: true,
      },
      {
        byte: 10,
        deleteBytes: 2,
        insert: "61",
        source: "a = 00:00:61",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 2,
        insert: "00",
        source: "a = 00:00:00",
        valid: true,
      },
    ],
  },
  {
    name: "cross offset bounds and restore a valid date-time",
    initial: "a = 2026-01-01T00:00+23:59",
    steps: [
      {
        byte: 21,
        deleteBytes: 2,
        insert: "24",
        source: "a = 2026-01-01T00:00+24:59",
        valid: false,
      },
      {
        byte: 21,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-01-01T00:00+00:59",
        valid: true,
      },
      {
        byte: 24,
        deleteBytes: 2,
        insert: "60",
        source: "a = 2026-01-01T00:00+00:60",
        valid: false,
      },
      {
        byte: 24,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-01-01T00:00+00:00",
        valid: true,
      },
    ],
  },
  {
    name: "edit whitespace before dotted key separator",
    initial: "a.b = true",
    steps: [
      {
        byte: 1,
        deleteBytes: 0,
        insert: " \t",
        source: "a \t.b = true",
        valid: true,
      },
      {
        byte: 3,
        deleteBytes: 1,
        insert: "",
        source: "a \tb = true",
        valid: false,
      },
      {
        byte: 3,
        deleteBytes: 0,
        insert: ".",
        source: "a \t.b = true",
        valid: true,
      },
    ],
  },
  {
    name: "extend multiline closing quote run",
    initial: 'a = """x"""',
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: '"',
        source: 'a = """x""""',
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 0,
        insert: '"',
        source: 'a = """x"""""',
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 0,
        insert: '"',
        source: 'a = """x""""""',
        valid: false,
      },
      {
        byte: 8,
        deleteBytes: 1,
        insert: "",
        source: 'a = """x"""""',
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 2,
        insert: "",
        source: 'a = """x"""',
        valid: true,
      },
    ],
  },
  {
    name: "restore multiline literal closing delimiter",
    initial: "a = '''x'''",
    steps: [
      {
        byte: 8,
        deleteBytes: 1,
        insert: "",
        source: "a = '''x''",
        valid: false,
      },
      {
        byte: 8,
        deleteBytes: 0,
        insert: "''",
        source: "a = '''x''''",
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 1,
        insert: "",
        source: "a = '''x'''",
        valid: true,
      },
    ],
  },
  {
    name: "change multiline string kind",
    initial: 'a = """x\ny"""',
    steps: [
      {
        byte: 4,
        deleteBytes: 3,
        insert: "'''",
        source: "a = '''x\ny\"\"\"",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 3,
        insert: "'''",
        source: "a = '''x\ny'''",
        valid: true,
      },
    ],
  },
  {
    name: "restore inline table after incomplete comment",
    initial: "a = {b = true,}",
    steps: [
      {
        byte: 14,
        deleteBytes: 1,
        insert: "# tail",
        source: "a = {b = true,# tail",
        valid: false,
      },
      {
        byte: 20,
        deleteBytes: 0,
        insert: "\n}",
        source: "a = {b = true,# tail\n}",
        valid: true,
      },
    ],
  },
  {
    name: "change table header kind",
    initial: "[a]\nx = true",
    steps: [
      {
        byte: 0,
        deleteBytes: 0,
        insert: "[",
        source: "[[a]\nx = true",
        valid: false,
      },
      {
        byte: 4,
        deleteBytes: 0,
        insert: "]",
        source: "[[a]]\nx = true",
        valid: true,
      },
    ],
  },
  {
    name: "recover a suffix into an adjacent assignment and restore it",
    initial: "a=[1]",
    steps: [
      { byte: 5, deleteBytes: 0, insert: "x", source: "a=[1]x", valid: false },
      {
        byte: 6,
        deleteBytes: 0,
        insert: "=2",
        source: "a=[1]x=2",
        valid: false,
      },
      {
        byte: 5,
        deleteBytes: 0,
        insert: "\n",
        source: "a=[1]\nx=2",
        valid: true,
      },
      { byte: 5, deleteBytes: 1, insert: "", source: "a=[1]x=2", valid: false },
      { byte: 6, deleteBytes: 2, insert: "", source: "a=[1]x", valid: false },
      { byte: 5, deleteBytes: 1, insert: "", source: "a=[1]", valid: true },
    ],
  },
  {
    name: "repair and restore malformed exponent digits",
    initial: "a=0e",
    steps: [
      { byte: 4, deleteBytes: 0, insert: "e", source: "a=0ee", valid: false },
      { byte: 4, deleteBytes: 1, insert: "5", source: "a=0e5", valid: true },
      { byte: 4, deleteBytes: 1, insert: "", source: "a=0e", valid: false },
    ],
  },
  {
    name: "complete and break a time after a date and a space",
    initial: "a=2026-01-01 0x:32",
    steps: [
      {
        byte: 14,
        deleteBytes: 1,
        insert: "7",
        source: "a=2026-01-01 07:32",
        valid: true,
      },
      {
        byte: 14,
        deleteBytes: 1,
        insert: "x",
        source: "a=2026-01-01 0x:32",
        valid: false,
      },
    ],
  },
  {
    name: "extend and restore the longest multiline closing prefix",
    initial: 'a="""x"""""',
    steps: [
      {
        byte: 11,
        deleteBytes: 0,
        insert: '"',
        source: 'a="""x""""""',
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 0,
        insert: '"=2',
        source: 'a="""x"""""""=2',
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 3,
        insert: "",
        source: 'a="""x""""""',
        valid: false,
      },
      {
        byte: 11,
        deleteBytes: 1,
        insert: "",
        source: 'a="""x"""""',
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

for (const { name, source, edits } of [
  {
    name: "change a scalar escape to a surrogate and restore it",
    source: String.raw`a="\uD7FF"`,
    edits: [
      { byte: 5, deleteBytes: 4, insert: "D800" },
      { byte: 5, deleteBytes: 4, insert: "D7FF" },
    ],
  },
  {
    name: "complete an impossible scalar prefix",
    source: String.raw`a="\U1`,
    edits: [{ byte: 6, deleteBytes: 0, insert: '0000000"' }],
  },
]) {
  test(`toml: ${name}`, () => {
    assertEditHistory({ source, edits });
  });
}

const cases = [
  [
    "adjacent forbidden bare key characters form one issue",
    "a@@b=1",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 3]],
  ],
  [
    "different forbidden bare key characters share their cause",
    "a\u0001@b=1",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 3]],
  ],
  [
    "normal bare key characters separate issues",
    "a@b@c=1",
    [
      ["simple_key", "invalid_syntax", "invalid_key_character", 1, 2],
      ["simple_key", "invalid_syntax", "invalid_key_character", 3, 4],
    ],
  ],
  [
    "adjacent forbidden string characters form one issue",
    'a="x\u0001\u0002y"',
    [["basic_string", "invalid_syntax", "invalid_character", 4, 6]],
  ],
  [
    "adjacent forbidden comment characters form one issue",
    "# x\u0001\u0002y",
    [["comment", "invalid_syntax", "invalid_character", 3, 5]],
  ],
  [
    "numeric violations stop before normal digits",
    "a=1?!2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "numeric violations stop before the exponent",
    "a=1??e2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "numeric violations stop before the fraction",
    "a=1??.2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "repeated digit separators cannot be completed at EOF",
    "a=1__",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "repeated digit separators retain the valid trailing separator",
    "a=1___2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "repeated leading digit separators form one issue",
    "a=0x__1",
    [["hex_int", "invalid_syntax", "invalid_number", 4, 6]],
  ],
  [
    "adjacent escapes remain independent",
    'a="\\q\\z"',
    [
      ["basic_string", "invalid_syntax", "invalid_escape", 3, 5],
      ["basic_string", "invalid_syntax", "invalid_escape", 5, 7],
    ],
  ],
  [
    "adjacent separators remain independent",
    "a=[1,,,2]",
    [
      ["array_values", "invalid_syntax", "unexpected_separator", 5, 6],
      ["array_values", "invalid_syntax", "unexpected_separator", 6, 7],
    ],
  ],
  [
    "value at EOF",
    "a =",
    [["keyval", "incomplete_syntax", "missing_value", 3, 3]],
  ],
  [
    "value before a newline",
    "a =\nb = 2",
    [["keyval", "invalid_syntax", "missing_value", 3, 3]],
  ],
  [
    "basic quote at EOF",
    'a = "x',
    [["basic_string", "incomplete_syntax", "missing_basic_string_close", 6, 6]],
  ],
  [
    "array closing at EOF",
    "a = [1",
    [["array", "incomplete_syntax", "missing_array_close", 6, 6]],
  ],
  [
    "bad escape between normal characters",
    'a = "x\\qy"',
    [["basic_string", "invalid_syntax", "invalid_escape", 6, 8]],
  ],
  [
    "nested closings at EOF",
    "a = [[1",
    [
      ["array", "incomplete_syntax", "missing_array_close", 7, 7],
      ["array", "incomplete_syntax", "missing_array_close", 7, 7],
    ],
  ],
];

test("toml issues: editing a normal key character splits and rejoins an invalid run", () => {
  const initial = "a@@b=1";
  const edits = [{ byte: 2, deleteBytes: 0, insert: "c" }];
  const split = assertIncrementalEqualsFresh(initial, edits, "a@c@b=1");
  assert.deepEqual(split.issues, [
    ["simple_key", "invalid_syntax", "invalid_key_character", 1, 2],
    ["simple_key", "invalid_syntax", "invalid_key_character", 3, 4],
  ]);
  edits.push({ byte: 2, deleteBytes: 1, insert: "" });
  const joined = assertIncrementalEqualsFresh(initial, edits, initial);
  assert.deepEqual(joined.issues, [
    ["simple_key", "invalid_syntax", "invalid_key_character", 1, 3],
  ]);
});

for (const [initial, insert] of [
  ["a =", "1"],
  ['a = "x', '"'],
  ["a = [1", "]"],
  ["a=07", ":32"],
  ["a=07", " "],
  ["a=[07", "]"],
  ["a=01", "00-01-01"],
  ["a=0e", "e"],
  ["a=0e+", "e"],
  ["a=1e5", "e"],
  ["a=[1]", "x=2"],
  ["a=1-2.5", " = 3"],
  ['a="""x"""""', '"'],
]) {
  test(`toml issues: append and remove ${JSON.stringify(insert)} at ${JSON.stringify(initial)}`, () => {
    const byte = Buffer.byteLength(initial);
    const edits = [{ byte, deleteBytes: 0, insert }];
    assertIncrementalEqualsFresh(initial, edits, initial + insert);
    edits.push({ byte, deleteBytes: Buffer.byteLength(insert), insert: "" });
    assertIncrementalEqualsFresh(initial, edits, initial);
  });
}

const boundaryCases = [
  [
    "quoted key immediately followed by a numeric value",
    '""0',
    [["keyval", "invalid_syntax", "missing_assignment_operator", 2, 2]],
  ],
  [
    "header missing its key before an invalid delimiter",
    "[{",
    [
      ["std_table", "invalid_syntax", "missing_key", 1, 1],
      ["std_table", "invalid_syntax", "invalid_character", 1, 2],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 2, 2],
    ],
  ],
  [
    "signed fraction without digits",
    "a=+.",
    [
      ["dec_int", "invalid_syntax", "missing_digits", 3, 3],
      ["frac", "incomplete_syntax", "missing_digits", 4, 4],
    ],
  ],
  [
    "space terminates a base prefix before unassigned trailing digits",
    "a=0x 1",
    [
      ["hex_int", "invalid_syntax", "missing_digits", 4, 4],
      ["expression", "invalid_syntax", "invalid_character", 5, 6],
    ],
  ],
  [
    "space terminates a fraction before a stray character",
    "a=. \\",
    [
      ["float", "invalid_syntax", "missing_digits", 2, 2],
      ["frac", "invalid_syntax", "missing_digits", 3, 3],
      ["expression", "invalid_syntax", "invalid_character", 4, 5],
    ],
  ],
  [
    "colon after a broken numeric prefix does not start a date",
    "a=2+01:00",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7],
    ],
  ],
  [
    "empty time fraction before a numeric offset",
    "a=2026-01-01T12:34:56.+01:00",
    [["time_secfrac", "invalid_syntax", "missing_digits", 22, 22]],
  ],
  [
    "leading inline table comma before a newline",
    "a={,\nx=1}",
    [["inline_table_keyvals", "invalid_syntax", "unexpected_separator", 3, 4]],
  ],
  [
    "leading array comma before a space",
    "a=[, 1]",
    [["array_values", "invalid_syntax", "unexpected_separator", 3, 4]],
  ],
  [
    "repeated array comma before a newline",
    "a=[1,,\n2]",
    [["array_values", "invalid_syntax", "unexpected_separator", 5, 6]],
  ],
  [
    "header retains a dotted key after an unexpected comma",
    "[1,.",
    [
      ["std_table", "invalid_syntax", "invalid_character", 2, 3],
      ["std_table", "invalid_syntax", "unexpected_key", 3, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 3, 3],
      ["dotted_key", "incomplete_syntax", "missing_key", 4, 4],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 4, 4],
    ],
  ],
  [
    "nested recovery retains every keyval and array owner",
    "a={b[1,2=3}",
    [
      ["keyval", "invalid_syntax", "missing_assignment_operator", 4, 4],
      ["val", "invalid_syntax", "invalid_character", 8, 9],
      ["array_values", "invalid_syntax", "missing_array_separator", 9, 9],
      ["array", "invalid_syntax", "missing_array_close", 10, 10],
    ],
  ],
  [
    "numeric array element after a newline without a comma",
    "a=[1\n2]",
    [["array_values", "invalid_syntax", "missing_array_separator", 5, 5]],
  ],
  [
    "numeric array element adjacent to a string",
    'a=["x"1]',
    [["array_values", "invalid_syntax", "missing_array_separator", 6, 6]],
  ],
  [
    "unknown array value after a missing comma",
    "a=[1 a]",
    [
      ["array_values", "invalid_syntax", "missing_array_separator", 5, 5],
      ["val", "invalid_syntax", "invalid_value", 5, 6],
    ],
  ],
  [
    "numeric inline table key after a newline without a comma",
    "a={b=1\n2=3}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "numeric inline table key adjacent to a container",
    "a={b=[]1=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "leading separator after a negative sign",
    "a=-_1",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "leading separator after a positive sign at EOF",
    "a=+_",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "leading separator in a signed float",
    "a=-_1.2",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "single space introduces an hour prefix at EOF",
    "a = 2026-01-01 0",
    [
      ["time_hour", "incomplete_syntax", "invalid_date_time", 15, 16],
      ["partial_time", "incomplete_syntax", "missing_time_separator", 16, 16],
      ["partial_time", "incomplete_syntax", "missing_digits", 16, 16],
    ],
  ],
  [
    "inline table keeps a value without a key",
    "a={[1]}",
    [["inline_table_keyvals", "invalid_syntax", "unexpected_value", 3, 6]],
  ],
  [
    "mismatched closing stays with the enclosing inline table",
    "a={b=1[}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        6,
        6,
      ],
      ["inline_table_keyvals", "invalid_syntax", "unexpected_value", 6, 7],
      ["array", "invalid_syntax", "missing_array_close", 7, 7],
    ],
  ],
  [
    "extra closing before comment keeps one expression",
    "a=1] # tail\nb=2",
    [["expression", "invalid_syntax", "invalid_character", 3, 4]],
  ],
  [
    "adjacent scalar and nested array retain both values",
    "a=[1[2]]",
    [["array_values", "invalid_syntax", "missing_array_separator", 4, 4]],
  ],
  [
    "adjacent boolean and string retain both values",
    'a=[true"x"]',
    [["array_values", "invalid_syntax", "missing_array_separator", 7, 7]],
  ],
  [
    "CR waiting for LF at EOF",
    "a=1\r",
    [["toml", "incomplete_syntax", "invalid_line_ending", 3, 4]],
  ],
  [
    "short boolean at EOF",
    "a = tru",
    [["val", "incomplete_syntax", "invalid_value", 4, 7]],
  ],
  [
    "short boolean before closing",
    "a=[tru]",
    [["val", "invalid_syntax", "invalid_value", 3, 6]],
  ],
  [
    "signed special float prefix",
    "a = +in",
    [["special_float", "incomplete_syntax", "invalid_value", 5, 7]],
  ],
  [
    "bare numeric sign",
    "a = -",
    [["dec_int", "incomplete_syntax", "missing_digits", 5, 5]],
  ],
  [
    "base prefix without digits",
    "a = 0x",
    [["hex_int", "incomplete_syntax", "missing_digits", 6, 6]],
  ],
  [
    "leading base separator",
    "a = 0x_",
    [["hex_int", "invalid_syntax", "invalid_number", 6, 7]],
  ],
  [
    "bad binary digit",
    "a = 0b2",
    [["bin_int", "invalid_syntax", "invalid_number", 6, 7]],
  ],
  [
    "trailing separator at EOF",
    "a = 1_",
    [["unsigned_dec_int", "incomplete_syntax", "invalid_number", 5, 6]],
  ],
  [
    "trailing separator before closing",
    "a=[1_]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 5]],
  ],
  [
    "unsigned leading-zero digits at EOF await a date or time",
    "a = 01",
    [["val", "incomplete_syntax", "invalid_value", 4, 6]],
  ],
  [
    "fraction missing integer digits",
    "a = .5",
    [["float", "invalid_syntax", "missing_digits", 4, 4]],
  ],
  [
    "exponent missing signed digits",
    "a = 1e+",
    [["float_exp_part", "incomplete_syntax", "missing_digits", 7, 7]],
  ],
  [
    "out of range month",
    "a = 2026-13-01",
    [["date_month", "invalid_syntax", "invalid_date_time", 9, 11]],
  ],
  [
    "appendable hour prefix",
    "a = 2026-01-01T0",
    [
      ["time_hour", "incomplete_syntax", "invalid_date_time", 15, 16],
      ["partial_time", "incomplete_syntax", "missing_time_separator", 16, 16],
      ["partial_time", "incomplete_syntax", "missing_digits", 16, 16],
    ],
  ],
  [
    "unappendable hour prefix",
    "a = 2026-01-01T9",
    [
      ["time_hour", "invalid_syntax", "invalid_date_time", 15, 16],
      ["partial_time", "incomplete_syntax", "missing_time_separator", 16, 16],
      ["partial_time", "incomplete_syntax", "missing_digits", 16, 16],
    ],
  ],
  [
    "offset without date",
    "a = 12:34Z",
    [["local_time", "invalid_syntax", "unexpected_time_offset", 9, 10]],
  ],
  [
    "fraction without seconds",
    "a = 12:34.5",
    [["partial_time", "invalid_syntax", "unexpected_time_fraction", 9, 11]],
  ],
  [
    "invalid escape at EOF",
    'a = "\\q',
    [
      ["basic_string", "invalid_syntax", "invalid_escape", 5, 7],
      ["basic_string", "incomplete_syntax", "missing_basic_string_close", 7, 7],
    ],
  ],
  [
    "short escape at EOF",
    'a = "\\u12',
    [
      ["basic_string", "incomplete_syntax", "invalid_escape", 5, 9],
      ["basic_string", "incomplete_syntax", "missing_basic_string_close", 9, 9],
    ],
  ],
  [
    "short escape before quote",
    'a = "\\u12"',
    [["basic_string", "invalid_syntax", "invalid_escape", 5, 9]],
  ],
  [
    "multiline continuation prefix",
    'a = """\\  ',
    [
      ["ml_basic_body", "incomplete_syntax", "invalid_escape", 7, 10],
      [
        "ml_basic_string",
        "incomplete_syntax",
        "missing_ml_basic_string_close",
        10,
        10,
      ],
    ],
  ],
  [
    "bare CR after multiline backslash",
    'a = """x\\\ry"""',
    [
      ["ml_basic_body", "invalid_syntax", "invalid_escape", 8, 9],
      ["ml_basic_body", "invalid_syntax", "invalid_line_ending", 9, 10],
    ],
  ],
  [
    "empty string before CRLF",
    'a = "\r\n',
    [["basic_string", "invalid_syntax", "missing_basic_string_close", 5, 5]],
  ],
  [
    "literal string before CRLF",
    "a = '\r\n",
    [
      [
        "literal_string",
        "invalid_syntax",
        "missing_literal_string_close",
        5,
        5,
      ],
    ],
  ],
  [
    "CR in array layout",
    "a = [\r]",
    [["array", "invalid_syntax", "invalid_line_ending", 5, 6]],
  ],
  [
    "CR in inline table layout",
    "a = {\r}",
    [["inline_table", "invalid_syntax", "invalid_line_ending", 5, 6]],
  ],
  [
    "NUL before a definite value",
    "a = \0true",
    [["val", "invalid_syntax", "invalid_character", 4, 5]],
  ],
  [
    "NUL between key fragments",
    "a\0b = true",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 2]],
  ],
  [
    "NUL within a number",
    "a = [1\0,2]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7]],
  ],
  [
    "NUL in a comment",
    "# a\0b",
    [["comment", "invalid_syntax", "invalid_character", 3, 4]],
  ],
  [
    "UTF8 bare key character",
    "a🌿b=1",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 5]],
  ],
  [
    "missing first dotted key",
    ".a=1",
    [["dotted_key", "invalid_syntax", "missing_key", 0, 0]],
  ],
  [
    "missing middle dotted key",
    "a..b=1",
    [["dotted_key", "invalid_syntax", "missing_key", 2, 2]],
  ],
  [
    "empty table name",
    "[]",
    [["std_table", "invalid_syntax", "missing_key", 1, 1]],
  ],
  [
    "extra header key",
    "[a b]",
    [["std_table", "invalid_syntax", "unexpected_key", 3, 4]],
  ],
  [
    "partial header closing at EOF",
    "[[a]",
    [["array_table", "incomplete_syntax", "invalid_delimiter", 3, 4]],
  ],
  [
    "partial header closing before newline",
    "[[a]\nx=1",
    [["array_table", "invalid_syntax", "invalid_delimiter", 3, 4]],
  ],
  [
    "missing array separator",
    "a=[true false]",
    [["array_values", "invalid_syntax", "missing_array_separator", 8, 8]],
  ],
  [
    "missing inline table separator",
    "a={b=1 c=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "missing document newline",
    "a=1 b=2",
    [["toml", "invalid_syntax", "missing_newline", 4, 4]],
  ],
  [
    "nested incomplete entries",
    "a={b={c=",
    [
      ["keyval", "incomplete_syntax", "missing_value", 8, 8],
      ["inline_table", "incomplete_syntax", "missing_inline_table_close", 8, 8],
      ["inline_table", "incomplete_syntax", "missing_inline_table_close", 8, 8],
    ],
  ],
  [
    "control character after a quoted key",
    "'a'\0",
    [
      ["keyval", "invalid_syntax", "missing_assignment_operator", 3, 3],
      ["val", "invalid_syntax", "invalid_character", 3, 4],
    ],
  ],
  [
    "control character after whitespace following a value",
    "a = 1 \v",
    [["expression", "invalid_syntax", "invalid_character", 6, 7]],
  ],
  [
    "control character in array layout after a newline",
    "a = [1\n\0]",
    [
      ["array_values", "invalid_syntax", "missing_array_separator", 7, 7],
      ["val", "invalid_syntax", "invalid_character", 7, 8],
    ],
  ],
  [
    "inline table open after whitespace in a header",
    "[a {",
    [
      ["std_table", "invalid_syntax", "invalid_character", 3, 4],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 4, 4],
    ],
  ],
  [
    "control character after an invalid header character",
    "[{\0",
    [
      ["std_table", "invalid_syntax", "missing_key", 1, 1],
      ["std_table", "invalid_syntax", "invalid_character", 1, 2],
      ["std_table", "invalid_syntax", "unexpected_key", 2, 3],
      ["simple_key", "invalid_syntax", "invalid_key_character", 2, 3],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 3, 3],
    ],
  ],
  [
    "four leading-zero digits at EOF await a date",
    "a=0100",
    [["val", "incomplete_syntax", "invalid_value", 2, 6]],
  ],
  [
    "five leading-zero digits cannot become a date",
    "a=01000",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "signed leading-zero digits cannot become a date",
    "a=+07",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "space terminates leading-zero digits",
    "a=07 ",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "newline terminates leading-zero digits",
    "a=07\n",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "comment terminates leading-zero digits",
    "a=07# end",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "closing bracket terminates leading-zero digits",
    "a=[07]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "array at EOF preserves an unfinished numeric value",
    "a=[07",
    [
      ["val", "incomplete_syntax", "invalid_value", 3, 5],
      ["array", "incomplete_syntax", "missing_array_close", 5, 5],
    ],
  ],
  [
    "inline table at EOF preserves an unfinished numeric value",
    "a={b=01",
    [
      ["val", "incomplete_syntax", "invalid_value", 5, 7],
      ["inline_table", "incomplete_syntax", "missing_inline_table_close", 7, 7],
    ],
  ],
  [
    "array suffix stays in its expression",
    "a=[1]x",
    [["expression", "invalid_syntax", "invalid_character", 5, 6]],
  ],
  [
    "contiguous junk stays in one expression issue",
    "a=[1]junk",
    [["expression", "invalid_syntax", "invalid_character", 5, 9]],
  ],
  [
    "invalid numeric letters preserve the following digit",
    "a=1xy2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "date suffix stays in its expression",
    "a=1979-05-27x",
    [["expression", "invalid_syntax", "invalid_character", 12, 13]],
  ],
  [
    "complete boolean survives an invalid suffix",
    "a=truex",
    [["expression", "invalid_syntax", "invalid_character", 6, 7]],
  ],
  [
    "adjacent assignment after an array preserves its key",
    "a=[1]x=2",
    [["toml", "invalid_syntax", "missing_newline", 5, 5]],
  ],
  [
    "adjacent dotted assignment after a date preserves its key",
    "a=1979-05-27x.y=2",
    [["toml", "invalid_syntax", "missing_newline", 12, 12]],
  ],
  [
    "adjacent quoted assignment after a string preserves its key",
    'a="s""x"=2',
    [["toml", "invalid_syntax", "missing_newline", 5, 5]],
  ],
  [
    "adjacent assignment after an integer preserves its key",
    "a=1x=2",
    [["toml", "invalid_syntax", "missing_newline", 3, 3]],
  ],
  [
    "exponent without digits remains incomplete at EOF",
    "a=0e",
    [["exp", "incomplete_syntax", "missing_digits", 4, 4]],
  ],
  [
    "second exponent marker stays in the exponent",
    "a=0ee",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 5]],
  ],
  [
    "bad signed exponent stays in the exponent",
    "a=0e+e",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 6]],
  ],
  [
    "bad exponent stays inside an array value",
    "a=[0ee]",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 6]],
  ],
  [
    "bad exponent stays inside an inline table value",
    "a={b=0ee}",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 7, 8]],
  ],
  [
    "six closing quotes retain the longest multiline string",
    'a="""x""""""',
    [["expression", "invalid_syntax", "invalid_character", 11, 12]],
  ],
  [
    "space after a date does not turn trailing junk into a key",
    "a=2026-01-01 x",
    [["expression", "invalid_syntax", "invalid_character", 13, 14]],
  ],
  [
    "dash before an exponent letter stays in the integer",
    "a=4-e2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "dash run after a sign keeps the exponent letter",
    "a=--e",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "stray equals suffix follows the complete numeric value",
    "a=1_2=3",
    [["expression", "invalid_syntax", "invalid_character", 5, 7]],
  ],
  ...[
    ["a=1_2=3.0", "expression", 5, 9],
    ["a=1=2e5", "expression", 3, 7],
    ["a={b=1=2.0}", "inline_table_keyvals", 6, 10],
  ].map(([source, owner, start, end]) => [
    `a float after a stray equals does not reclassify the integer: ${source}`,
    source,
    [[owner, "invalid_syntax", "invalid_character", start, end]],
  ]),
  [
    "an array float after a stray equals starts the next value",
    "a=[1=1.0]",
    [
      ["val", "invalid_syntax", "invalid_character", 4, 5],
      ["array_values", "invalid_syntax", "missing_array_separator", 5, 5],
    ],
  ],
  [
    "dash run keeps an exponent letter after other numeric junk",
    "a=[1-:e]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 7]],
  ],
  [
    "integer junk continues through a dot and an exponent letter",
    "a=1x.e",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "signed junk continues through a dot",
    "a=-a.",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "fraction junk continues through a second decimal point",
    "a=1.5?.",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "exponent junk continues through a second exponent letter",
    "a=1e5?e",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "a dash later in a junk run keeps the exponent letter in the integer",
    "a=1?-e5",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "an underscore after a dash keeps the exponent letter in the integer",
    "a=1-_e",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "separator junk continues through a dot",
    "a=1_x.",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "a leading fraction separator continues through a second decimal point",
    "a=1._.",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 6]],
  ],
  [
    "a signed leading separator continues through an exponent letter",
    "a=+_e=",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "signed junk continues through the separator before digits",
    "a=+?_1",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "fraction junk ending at a dot keeps the following exponent",
    "a=1.5x.e5",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
];

const issueRecoveryCases = [
  ...["key", "e", "E", "key .x"].map((key) => [
    `numeric word junk yields to a confirmed assignment: ${key}`,
    `a=1x?${key}=2`,
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["toml", "invalid_syntax", "missing_newline", 5, 5],
    ],
  ]),
  ...["a=1.5x?e=2", "a=1e5x?e=2"].map((source) => [
    `fraction or exponent word junk yields to an assignment: ${source}`,
    source,
    [
      ["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7],
      ["toml", "invalid_syntax", "missing_newline", 7, 7],
    ],
  ]),
  ...["a=1.5x?e5", "a=1e5x?e5"].map((source) => [
    `unconfirmed exponent-letter key stays in the numeric run: ${source}`,
    source,
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 8]],
  ]),
  ...["hex_int", "oct_int", "bin_int"].map((owner, index) => [
    `${owner} word junk yields to an assignment after punctuation`,
    `a=0${["x", "o", "b"][index]}1x?key=2`,
    [
      [owner, "invalid_syntax", "invalid_number", 5, 7],
      ["toml", "invalid_syntax", "missing_newline", 7, 7],
    ],
  ]),
  [
    "array word junk retains assignment-like text in the number",
    "a=[1x?e=2]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 8]],
  ],
  [
    "array exponent keeps assignment-like text in its required digits",
    "a=[1ex=2]",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "array exponent keeps assignment-like text after its digits",
    "a=[1e5x=2]",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 6, 8]],
  ],
  [
    "a value after junk still yields to an adjacent assignment",
    "a==1e=2",
    [
      ["val", "invalid_syntax", "invalid_character", 2, 3],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "inline numeric word junk preserves a confirmed key",
    "a={b=1x?key=2}",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 8],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        8,
        8,
      ],
    ],
  ],
  [
    "inline glued text without an assignment remains junk",
    "a={b=truex}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 10]],
  ],
  [
    "inline glued text becomes a key only with a confirmed assignment",
    "a={b=truex=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        9,
        9,
      ],
    ],
  ],
  [
    "inline glued junk ends before a confirmed assignment",
    "a={b=truex?key=2}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 11],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        11,
        11,
      ],
    ],
  ],
  [
    "inline glued junk preserves the comma and following keyval",
    "a={b=truex,x=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 10]],
  ],
  ...["a={x", "a={b=true,x"].map((source) => [
    `a key at the start of an inline item retains its missing syntax: ${source}`,
    source,
    [
      [
        "keyval",
        "incomplete_syntax",
        "missing_assignment_operator",
        source.length,
        source.length,
      ],
      [
        "keyval",
        "incomplete_syntax",
        "missing_value",
        source.length,
        source.length,
      ],
      [
        "inline_table",
        "incomplete_syntax",
        "missing_inline_table_close",
        source.length,
        source.length,
      ],
    ],
  ]),
  [
    "missing fractional digits preserve the following real exponent",
    "a=1.e5",
    [["frac", "invalid_syntax", "missing_digits", 4, 4]],
  ],

  [
    "numeric junk stops before an adjacent bare key",
    "a=1?key=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "numeric junk stops before an adjacent exponent-letter key",
    "a=1?e=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "numeric junk stops before a confirmed dotted key with whitespace",
    "a=1?key .x=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "unconfirmed numeric key text stays in one issue",
    "a=1?key",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 7]],
  ],
  [
    "numeric junk stops before an adjacent quoted key",
    'a=1?"key"=2',
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  ...["hex_int", "oct_int", "bin_int"].map((owner, index) => [
    `${owner} junk stops before an adjacent key`,
    `a=0${["x", "o", "b"][index]}1?key=2`,
    [
      [owner, "invalid_syntax", "invalid_number", 5, 6],
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
    ],
  ]),
  [
    "inline numeric junk keeps the next real key",
    "a={b=1?key=2}",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "array numeric junk does not create key-value pairs",
    "a=[1?key=2]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 9]],
  ],
  [
    "fraction junk before its first normal digit retains assignment text",
    "a=1.?key=2",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 9]],
  ],
  [
    "exponent junk before its first normal digit retains assignment text",
    "a=1e?key=2",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 9]],
  ],
  ...["a=1.5?key=2", "a=1e5?key=2"].map((source) => [
    `numeric junk after a real fractional or exponent digit recovers a key: ${source}`,
    source,
    [
      ["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 6],
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
    ],
  ]),
  ...["a=1..5", "a=1e.5"].map((source) => [
    `invalid dot before the first digit stays in its numeric element: ${source}`,
    source,
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 5]],
  ]),
  ...[
    ["a=1.?e=2", "zero_prefixable_int", 4, 7],
    ["a=1.?e5", "zero_prefixable_int", 4, 6],
    ["a=-?e5", "dec_int", 3, 5],
  ].map(([source, owner, start, end]) => [
    `an exponent letter before the first required digit stays in the run: ${source}`,
    source,
    [[owner, "invalid_syntax", "invalid_number", start, end]],
  ]),
  ...["a=0_ ", "a=0_e5"].map((source) => [
    `a zero followed by a separator without a digit is not a leading zero: ${source}`,
    source,
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ]),
  [
    "a zero stays normal before an invalid separator at EOF",
    "a=0_",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "a key after a zero and a separator yields to a confirmed assignment",
    "a=0_x=1",
    [["toml", "invalid_syntax", "missing_newline", 3, 3]],
  ],
  ...["a=1-2.5=3", "a=1-2.5 = 3", "a=1__2.5=3", 'a=1-2."x"=3'].map((source) => [
    `a dotted key after an integer keeps its dots out of the value: ${source}`,
    source,
    [["toml", "invalid_syntax", "missing_newline", 3, 3]],
  ]),
  [
    "a dotted key after an integer keeps its missing last segment",
    "a=1-2. = 3",
    [
      ["toml", "invalid_syntax", "missing_newline", 3, 3],
      ["dotted_key", "invalid_syntax", "missing_key", 7, 7],
    ],
  ],
  [
    "an inline dotted key after an integer keeps its dots out of the value",
    "a={b=1-2.5=3}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        6,
        6,
      ],
    ],
  ],
  [
    "an unconfirmed key chain keeps its dot as the fraction",
    "a=1-2.5",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],

  [
    "adjacent date delimiter becomes a key",
    "a=1979-05-27T=1",
    [["toml", "invalid_syntax", "missing_newline", 12, 12]],
  ],
  [
    "adjacent local time offset becomes a key",
    "a=07:32Z=1",
    [["toml", "invalid_syntax", "missing_newline", 7, 7]],
  ],
  [
    "adjacent datetime offset becomes a key",
    "a=1979-05-27T07:32Z=1",
    [["toml", "invalid_syntax", "missing_newline", 18, 18]],
  ],
  [
    "adjacent numeric time offset becomes a key",
    "a=07:32-01=1",
    [["toml", "invalid_syntax", "missing_newline", 7, 7]],
  ],
  [
    "dotted time suffix becomes a key",
    "a=07:32Z.x=1",
    [["toml", "invalid_syntax", "missing_newline", 7, 7]],
  ],
  [
    "array date delimiter stays a delimiter before an assignment",
    "a=[1979-05-27T=1]",
    [
      ["local_date_time", "invalid_syntax", "missing_digits", 14, 14],
      ["val", "invalid_syntax", "invalid_character", 14, 15],
      ["array_values", "invalid_syntax", "missing_array_separator", 15, 15],
    ],
  ],
  [
    "inline date delimiter becomes a key",
    "a={b=1979-05-27T=1}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        15,
        15,
      ],
    ],
  ],
  [
    "one issue owns contiguous expression junk",
    "a=truex.;}]",
    [["expression", "invalid_syntax", "invalid_character", 6, 11]],
  ],
  [
    "a completed boolean keeps a whole dotted key with a missing middle segment",
    "a=truex..key=2",
    [
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
      ["dotted_key", "invalid_syntax", "missing_key", 8, 8],
    ],
  ],
  [
    "expression junk keeps a quoted key whole before a confirmed key",
    'a=true"a b" c=1',
    [
      ["expression", "invalid_syntax", "invalid_character", 6, 11],
      ["toml", "invalid_syntax", "missing_newline", 12, 12],
    ],
  ],
  [
    "whitespace separates expression junk",
    "a=true]} ;,",
    [
      ["expression", "invalid_syntax", "invalid_character", 6, 8],
      ["expression", "invalid_syntax", "invalid_character", 9, 11],
    ],
  ],
  [
    "one issue owns contiguous value junk",
    "a==\0=1",
    [["val", "invalid_syntax", "invalid_character", 2, 5]],
  ],
  [
    "header junk preserves the real key",
    "[{{a]",
    [
      ["std_table", "invalid_syntax", "missing_key", 1, 1],
      ["std_table", "invalid_syntax", "invalid_character", 1, 3],
      ["std_table", "invalid_syntax", "unexpected_key", 3, 4],
    ],
  ],
  [
    "header junk stops before its closing delimiter",
    "[a{},}]",
    [["std_table", "invalid_syntax", "invalid_character", 2, 6]],
  ],
  [
    "separator and invalid digit share one issue",
    "a=1_x",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "leading separator and invalid base digit share one issue",
    "a=0x_g",
    [["hex_int", "invalid_syntax", "invalid_number", 4, 6]],
  ],
  [
    "invalid numeric run stops before normal digits",
    "a=1_x2y_",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 8],
    ],
  ],
  [
    "numeric junk preserves the following exponent",
    "a=1.2_x3e4",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "numeric junk stops at a normal digit before an adjacent key",
    "a=1x?1y=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
    ],
  ],
  [
    "a missing inline table close ends rejected numeric key text",
    "a=[{b=1x ]c=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 7, 8],
      ["inline_table", "invalid_syntax", "missing_inline_table_close", 9, 9],
      ["toml", "invalid_syntax", "missing_newline", 10, 10],
    ],
  ],
  ...[
    ["hex_int", "a=0x1_:ga", 8],
    ["oct_int", "a=0o1_:8", 8],
    ["bin_int", "a=0b1_:2", 8],
    ["hex_int", "a=0x1__ab", 6],
  ].map(([owner, source, end]) => [
    `separator junk follows the digit rules of ${source}`,
    source,
    [[owner, "invalid_syntax", "invalid_number", 5, end]],
  ]),
];

const valueBoundaryCases = [
  [
    "a spaced dotted key keeps its missing middle segment",
    "a=1 x..y=2",
    [
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 6, 6],
    ],
  ],
  [
    "a spaced dotted key keeps its missing last segment",
    "a=1 x.=2",
    [
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 6, 6],
    ],
  ],
  [
    "numeric junk yields to a dotted key with a missing middle segment",
    "a=1?x..y=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 6, 6],
    ],
  ],
  [
    "an empty quoted segment establishes a dotted key with missing segments",
    'a=1 .""..=2',
    [
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 8, 8],
      ["dotted_key", "invalid_syntax", "missing_key", 9, 9],
    ],
  ],
  [
    "spaces between missing segments preserve the whole dotted key",
    "a=1 x . . y . =2",
    [
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 8, 8],
      ["dotted_key", "invalid_syntax", "missing_key", 14, 14],
    ],
  ],
  [
    "an inline dotted key keeps its missing middle segment",
    "a={b=1 x..y=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
      ["dotted_key", "invalid_syntax", "missing_key", 9, 9],
    ],
  ],
  [
    "a glued inline dotted key keeps its missing last segment",
    "a={b=truex.=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        9,
        9,
      ],
      ["dotted_key", "invalid_syntax", "missing_key", 11, 11],
    ],
  ],
  [
    "dots without a real segment remain document junk",
    "a=1 ..=2",
    [["expression", "invalid_syntax", "invalid_character", 4, 8]],
  ],
  [
    "a dot without a real segment remains inline junk",
    "a={b=1 .=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 10]],
  ],
  [
    "an equals sign inside numeric junk keeps the following digit in the number",
    "a=1?=2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "an inline equals sign inside numeric junk keeps the following digit in the number",
    "a={b=1?=2}",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 8]],
  ],
  [
    "a completed boolean keeps an equals suffix outside its value",
    "a=true=2",
    [["expression", "invalid_syntax", "invalid_character", 6, 8]],
  ],
  [
    "a completed string keeps an equals suffix outside its value",
    'a="x"=2',
    [["expression", "invalid_syntax", "invalid_character", 5, 7]],
  ],
  [
    "a completed array keeps an equals suffix outside its value",
    "a=[]=2",
    [["expression", "invalid_syntax", "invalid_character", 4, 6]],
  ],
  [
    "an inline boolean keeps an equals suffix in the container",
    "a={b=true=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 11]],
  ],
  [
    "an inline number keeps an equals suffix in the container",
    "a={b=1_2=3}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 8, 10]],
  ],
  [
    "a completed boolean keeps a control character and equals suffix outside its value",
    "a=true\u0001=2",
    [["expression", "invalid_syntax", "invalid_character", 6, 9]],
  ],
  [
    "an inline boolean keeps a control character and equals suffix in the container",
    "a={b=true\u0001=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 12]],
  ],
  [
    "spaced semicolon stays outside the following document key",
    "a=1 ;c=2",
    [
      ["expression", "invalid_syntax", "invalid_character", 4, 5],
      ["toml", "invalid_syntax", "missing_newline", 5, 5],
    ],
  ],
  [
    "spaced semicolon stays outside the following inline key",
    "a={b=1 ;c=2}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 8],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        8,
        8,
      ],
    ],
  ],
  [
    "spaced dot retains a document key with a missing first segment",
    "a=1 .x=2",
    [
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 4, 4],
    ],
  ],
  [
    "spaced dot retains an inline key with a missing first segment",
    "a={b=1 .x=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
      ["dotted_key", "invalid_syntax", "missing_key", 7, 7],
    ],
  ],
  [
    "space does not turn document junk into an unassigned key",
    "a=1 x",
    [["expression", "invalid_syntax", "invalid_character", 4, 5]],
  ],
  [
    "space does not turn inline junk into an unassigned key",
    "a={b=1 x}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 8]],
  ],
  [
    "inline punctuation and unassigned letters share an issue",
    "a={b=1 ;x}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 9]],
  ],
  [
    "a real comma separates a key after inline junk",
    "a={b=1 ;,c=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 8]],
  ],
  [
    "a tab before a real inline assignment retains its key",
    "a={b=1\tc=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "a semicolon at the initial key position remains a key error",
    "a={;c=2}",
    [["simple_key", "invalid_syntax", "invalid_key_character", 3, 4]],
  ],
  [
    "a signed zero stays normal before an invalid separator at EOF",
    "a=+0_",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 5]],
  ],
  [
    "a zero stays normal before repeated separators at EOF",
    "a=0__",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "an invalid trailing separator keeps a spaced document key",
    "a=1_ x=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 5, 5],
    ],
  ],
  [
    "invalid trailing separators keep a spaced inline key",
    "a={b=0x1__ x=2}",
    [
      ["hex_int", "invalid_syntax", "invalid_number", 8, 10],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        11,
        11,
      ],
    ],
  ],
  [
    "a UTC offset keeps a spaced document key",
    "a=2026-01-01T07:32Z x=2",
    [["toml", "invalid_syntax", "missing_newline", 20, 20]],
  ],
  [
    "digits after rejected numeric junk end before a spaced bare key",
    "a=1x.1 x=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["toml", "invalid_syntax", "missing_newline", 7, 7],
    ],
  ],
  [
    "digits after rejected numeric junk end before a spaced quoted key",
    'a=1x.1 "x"=2',
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["toml", "invalid_syntax", "missing_newline", 7, 7],
    ],
  ],
  [
    "a rejected inline separator does not reject a key after the table",
    "a={b=0_}k=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7],
      ["toml", "invalid_syntax", "missing_newline", 8, 8],
    ],
  ],
  [
    "a rejected nested separator does not reject a key in the outer table",
    "a={b={c=0_}k=2}",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 9, 10],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        11,
        11,
      ],
    ],
  ],
  [
    "a rejected inline UTC offset does not reject a key after the table",
    "a={b=2026-01-01T07:32Z}k=2",
    [["toml", "invalid_syntax", "missing_newline", 23, 23]],
  ],
  [
    "rejected inline dotted junk does not reject a key after the table",
    "a={b=1 x.}k=2",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 9],
      ["toml", "invalid_syntax", "missing_newline", 10, 10],
    ],
  ],
  [
    "a UTC offset keeps a spaced inline key",
    "a={b=1979-05-27T07:32Z x=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        23,
        23,
      ],
    ],
  ],
  ...[
    {
      source: "a=1 :c=2",
      owner: "expression",
      separatorOwner: "toml",
      separator: "missing_newline",
      start: 4,
    },
    {
      source: "a=1 \\c=2",
      owner: "expression",
      separatorOwner: "toml",
      separator: "missing_newline",
      start: 4,
    },
    {
      source: "a=1 \u0001c=2",
      owner: "expression",
      separatorOwner: "toml",
      separator: "missing_newline",
      start: 4,
    },
    {
      source: "a={b=1 :c=2}",
      owner: "inline_table_keyvals",
      separatorOwner: "inline_table_keyvals",
      separator: "missing_inline_table_separator",
      start: 7,
    },
    {
      source: "a={b=1 \\c=2}",
      owner: "inline_table_keyvals",
      separatorOwner: "inline_table_keyvals",
      separator: "missing_inline_table_separator",
      start: 7,
    },
    {
      source: "a={b=1 \u0001c=2}",
      owner: "inline_table_keyvals",
      separatorOwner: "inline_table_keyvals",
      separator: "missing_inline_table_separator",
      start: 7,
    },
  ].map(({ source, owner, separatorOwner, separator, start }) => [
    `spaced junk preserves the following assignment in ${JSON.stringify(source)}`,
    source,
    [
      [owner, "invalid_syntax", "invalid_character", start, start + 1],
      [separatorOwner, "invalid_syntax", separator, start + 1, start + 1],
    ],
  ]),
];

for (const [name, source, expected] of [
  ...cases,
  ...boundaryCases,
  ...issueRecoveryCases,
  ...valueBoundaryCases,
]) {
  test(`toml issues: ${name}`, () => {
    const result = assertIncrementalEqualsFresh(
      `\n${source}`,
      [{ byte: 0, deleteBytes: 1, insert: "" }],
      source,
    );
    assert.deepEqual(result.issues, expected, result.cst);
  });
}

test("toml issues: deep nesting keeps every missing closing at EOF", () => {
  const nestingDepth = 256;
  const source = `a=${"[".repeat(nestingDepth)}0`;
  const end = Buffer.byteLength(source);
  const closings = "]".repeat(nestingDepth);
  const result = parse(source);
  assert.equal(result.hasError, false, result.cst);
  assert.deepEqual(
    result.issues,
    Array.from({ length: nestingDepth }, () => [
      "array",
      "incomplete_syntax",
      "missing_array_close",
      end,
      end,
    ]),
  );
  assert.equal(
    result.nodes.filter((node) => node.kind === "array").length,
    nestingDepth,
  );
  const closed = assertIncrementalEqualsFresh(
    source,
    [{ byte: end, deleteBytes: 0, insert: closings }],
    source + closings,
  );
  assert.deepEqual(closed.issues, []);
});

test("toml: edits to spaced dotted junk invalidate failed key lookahead", () => {
  for (const prefix of ["a=true", "a=1?", "a=1x?", "a={b=true", "a={b=1x?"]) {
    const initial = `${prefix}x .x .x`;
    const completed = `${initial}=2`;
    assertIncrementalEqualsFresh(
      initial,
      [{ byte: Buffer.byteLength(initial), deleteBytes: 0, insert: "=2" }],
      completed,
    );
    assertIncrementalEqualsFresh(
      completed,
      [
        {
          byte: Buffer.byteLength(initial),
          deleteBytes: Buffer.byteLength("=2"),
          insert: "",
        },
      ],
      initial,
    );
  }
});

test("toml: rejected dotted junk ends before a later key or another expression", () => {
  for (const [source, lastKeyval] of [
    ["a=truex .x key=2", "key=2"],
    ["a=truex .x\nb=2", "b=2"],
    ["a=truex .x\nb=1key=2", "key=2"],
    ['a=truex .x ."k"=2', 'x .x ."k"=2'],
    ['a=truex .x ."k\nkey=2', "key=2"],
    ["a=1?x .x key=2", "key=2"],
    ["a={b=1?x .x}\nnext=2", "next=2"],
    ["a=1x?key=2", "key=2"],
    ["a=1x?e=2", "e=2"],
    ["a={b=truex?key=2}", "key=2"],
  ]) {
    const fresh = assertIncrementalEqualsFresh(
      `\n${source}`,
      [{ byte: 0, deleteBytes: 1, insert: "" }],
      source,
    );
    const keyval = fresh.nodes.filter((node) => node.kind === "keyval").at(-1);
    assert.ok(keyval, fresh.cst);
    assert.equal(source.slice(keyval.start, keyval.end), lastKeyval, fresh.cst);
  }
});

for (const [name, source] of [
  ["a spaced standard header follows a completed value", "a=1 [b]"],
  ["an adjacent standard header follows a completed value", "a=1[b]"],
  ["a spaced array table header follows a completed value", "a=true [[b]]"],
  ["an adjacent array table header follows a completed value", "a=true[[b]]"],
  ["an empty header follows a completed array", "a=[][]"],
  ["an unfinished header follows a completed value", "a=1 [b"],
  ["a header opening alone follows a completed value", "a=1 ["],
  ["a bracket inside an array starts another array value", "a=[1 [2]]"],
  [
    "a bracket inside an inline table retains an unexpected array value",
    "a={b=1 [2]}",
  ],
]) {
  test(`toml header recovery: ${name}`, () => {
    for (let byte = 0; byte < source.length; byte++) {
      const remove = { byte, deleteBytes: 1, insert: "" };
      assertIncrementalEqualsFresh(
        source,
        [remove],
        applyEdits(source, [remove]),
      );
      assertIncrementalEqualsFresh(
        source,
        [remove, { byte, deleteBytes: 0, insert: source[byte] }],
        source,
      );
    }
  });
}

for (const [name, source] of [
  ["inline junk and an unmatched closing form one issue", "a={b=1 x]}"],
  ["junk after an unexpected value joins the unmatched closing", "a={[]a]}"],
  ["junk between unmatched closings stays in one issue", "a={b=1]x]}"],
  ["whitespace separates junk from an unmatched closing", "a={b=1 x ]}"],
  [
    "a comma after joined junk still separates the next keyval",
    "a={b=1 x],c=2}",
  ],
  ["junk stops before the enclosing array's closing", "a=[{b=1 x]"],
  [
    "a confirmed key after an unmatched closing starts a new keyval",
    "a={b=1]c=2}",
  ],
  ["spaced text after an unmatched closing stays junk", "a={b=1] x}"],
  [
    "a spaced confirmed key after an unmatched closing starts a new keyval",
    "a={b=1] c=2}",
  ],
  [
    "a completed array does not supply an opening to a later table",
    "a=[{}]\nb={x=1]}",
  ],
  [
    "a completed table does not supply an opening to a later array",
    "a={x=[]}\nb=[1}]",
  ],
  ["a closing brace unwinds the innermost array only", "a=[{x=[1}]"],
  ["a closing bracket unwinds the innermost table only", "a={x=[{y=1]}"],
  [
    "a leading unmatched closing does not supply an item before a comma",
    "a={],b=1}",
  ],
  ["consecutive unmatched closings form one issue", "a=[1}}]"],
  ["a table header does not supply an array opening", "[x]\na={b=1]}"],
  ["an unmatched bracket stays inside the inline table", "a={b=1]}"],
  ["an unmatched brace stays inside the array", "a=[1}]"],
  ["an enclosing array closes after the table's missing brace", "a=[{b=1]"],
  ["an enclosing table closes after the array's missing bracket", "a={b=[1}"],
  ["an unmatched brace stays in the innermost array", "a=[[1}]]"],
  ["an unmatched bracket does not synthesize a keyval", "a={]}"],
  ["an unmatched brace does not synthesize a value", "a=[}]"],
  [
    "an unmatched brace after a comma preserves the following value",
    "a=[1,}2]",
  ],
  [
    "an unmatched brace after a trailing comma stays inside the array",
    "a=[1,}]",
  ],
  [
    "an unmatched bracket after a comma preserves the following keyval",
    "a={b=1,]c=2}",
  ],
  [
    "a newline after a trailing comma and an unmatched brace stays with the array",
    "a=[1,}\n]",
  ],
  [
    "a comment after a trailing comma and an unmatched bracket stays with the table",
    "a={b=1,]#c\n}",
  ],
]) {
  test(`closing recovery edits: ${name}`, () => {
    for (let byte = 0; byte < source.length; byte++) {
      const remove = { byte, deleteBytes: 1, insert: "" };
      assertIncrementalEqualsFresh(
        source,
        [remove],
        applyEdits(source, [remove]),
      );
      assertIncrementalEqualsFresh(
        source,
        [remove, { byte, deleteBytes: 0, insert: source[byte] }],
        source,
      );
    }
  });
}
