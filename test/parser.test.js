import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "./support/parser.js";

const validCases = [
  {
    name: "CRLF separates expressions",
    source: "a = true\r\nb = false\r\n",
    node: /^0:8 - 1:0 +newline$/m,
  },
  {
    name: "CRLF inside multiline basic string",
    source: 'a = """\r\none\r\ntwo"""',
    node: /^1:3 - 2:0 +newline$/m,
  },
  {
    name: "CRLF inside multiline inline table",
    source: "a = {\r\nx = true,\r\n}",
    node: /^1:9 - 2:0 +newline$/m,
  },
];

for (const { name, source, node } of validCases) {
  test(`toml: ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, [], result.cst);
    assert.match(result.cst, node);
  });
}

test("toml: numeric character leaves preserve separators while whitespace stays hidden", () => {
  const result = parse("\t a . b = [ 1_0 , 2026-09-20 07:32 ] # c");
  assert.equal(result.hasError, false, result.cst);
  const leaves = result.cst
    .split("\n")
    .map((line) => line.replace(/^\S+\s+-\s+\S+\s+/, "").trim())
    .filter((line) => line.startsWith('"') || line.includes("`"));
  assert.deepEqual(leaves, [
    "unquoted_key `a`",
    '"."',
    "unquoted_key `b`",
    '"="',
    '"["',
    "digit1_9 `1`",
    '"_"',
    "digit `0`",
    '","',
    "digit `2`",
    "digit `0`",
    "digit `2`",
    "digit `6`",
    '"-"',
    "digit `0`",
    "digit `9`",
    '"-"',
    "digit `2`",
    "digit `0`",
    '" "',
    "digit `0`",
    "digit `7`",
    '":"',
    "digit `3`",
    "digit `2`",
    '"]"',
    "comment `# c`",
  ]);
});

test("toml: literal content and escape codes expose their original character ranges", () => {
  const result = parse("a = 'hello'\nb = 0xff\nc = \"\\u0041\"");
  assert.equal(result.hasError, false, result.cst);
  for (const expected of [
    "0:5 - 0:6",
    "0:6 - 0:7",
    "0:7 - 0:8",
    "0:8 - 0:9",
    "0:9 - 0:10",
    "1:6 - 1:7",
    "1:7 - 1:8",
    "2:7 - 2:8",
    "2:8 - 2:9",
    "2:9 - 2:10",
    "2:10 - 2:11",
  ]) {
    assert.ok(result.cst.replace(/ +/g, " ").includes(expected), result.cst);
  }
  assert.deepEqual(
    result.cst
      .split("\n")
      .map((line) => line.trim().split(/ +/).slice(3).join(" "))
      .filter(
        (line) =>
          line.startsWith("literal_char ") || line.startsWith("hexdig "),
      ),
    [
      "literal_char `h`",
      "literal_char `e`",
      "literal_char `l`",
      "literal_char `l`",
      "literal_char `o`",
      "hexdig `f`",
      "hexdig `f`",
      "hexdig `0`",
      "hexdig `0`",
      "hexdig `4`",
      "hexdig `1`",
    ],
  );
});

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

test("toml: date-time digit restrictions preserve other numeric forms", () => {
  const result = parse(
    "a = [0, 1, 2, 3, 5, 6, 7, 9, 10, 20, 23, 24, 59, 60, 61, 99, 100, 2000, 9999, 0.5, 1e2, 0x123abc, 0o01234567, 0b01]",
  );
  assert.equal(result.hasError, false, result.cst);
});

const invalidCases = [
  ["bare carriage return between expressions", "a = true\rb = false"],
  ["bare carriage return in multiline basic string", 'a = """one\rtwo"""'],
  ["bare carriage return in multiline literal string", "a = '''one\rtwo'''"],
  ["vertical tab as whitespace", "a\v= true"],
  ["control character in basic string", 'a = "\u0001"'],
  ["delete character in literal string", "a = '\u007f'"],
  ["control character in comment", "# \u0001"],
  ["zero month", "a = 2026-00-01"],
  ["month above twelve", "a = 2026-13-01"],
  ["month with two nines", "a = 2026-99-01"],
  ["zero day", "a = 2026-01-00"],
  ["day above thirty-one", "a = 2026-01-32"],
  ["day with two nines", "a = 2026-01-99"],
  ["hour above twenty-three", "a = 24:00"],
  ["hour with two nines", "a = 99:00"],
  ["minute above fifty-nine", "a = 00:60"],
  ["minute with two nines", "a = 00:99"],
  ["second above sixty", "a = 00:00:61"],
  ["fraction after an out-of-range second", "a = 00:00:61.5"],
  ["second with two nines", "a = 00:00:99"],
  ["out-of-range local date-time hour", "a = 2026-01-01T24:00:00"],
  ["out-of-range UTC minute", "a = 2026-01-01T00:60:00Z"],
  ["positive offset hour above twenty-three", "a = 2026-01-01T00:00+24:00"],
  ["negative offset hour above twenty-three", "a = 2026-01-01T00:00-24:00"],
  ["positive offset minute above fifty-nine", "a = 2026-01-01T00:00+00:60"],
  ["negative offset minute above fifty-nine", "a = 2026-01-01T00:00-00:60"],
];

for (const [name, source] of invalidCases) {
  test(`toml: ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.ok(result.issues.length > 0, result.cst);
  });
}

const recoveryCases = [
  ["quote run after a complete value", 'a = 1 """x"""'],
  ["quote run without a keyval", 'x """ y'],
  ["stray delimiter after a multiline basic string", 'a = """x""" """'],
  ["stray delimiter after a multiline literal string", "a = '''x''', '''"],
  ["quote pair as the whole document", '""'],
];

for (const [name, source] of recoveryCases) {
  test(`toml: ${name} preserves structure with explicit issues`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.ok(result.issues.length > 0, result.cst);
  });
}

test("toml issues: unfinished numeric values preserve digits without assigning a date kind", () => {
  const result = parse("a=0100");
  assert.deepEqual(
    result.nodes
      .filter((node) => result.nodes[node.parent]?.kind === "invalid_value")
      .map((node) => [node.kind, node.start, node.end]),
    [
      ["digit", 2, 3],
      ["digit", 3, 4],
      ["digit", 4, 5],
      ["digit", 5, 6],
    ],
  );
  assert.equal(
    result.nodes.some((node) => ["integer", "date_time"].includes(node.kind)),
    false,
  );
});

test("toml issues: real digits and delimiters remain inside their reason and owner", () => {
  const result = parse("a=[01,2026-13-01,12:34Z]");
  const retained = result.nodes.filter(
    (node) =>
      node.named &&
      [
        "invalid_number",
        "invalid_date_time",
        "unexpected_time_offset",
      ].includes(result.nodes[node.parent]?.kind),
  );
  assert.deepEqual(
    retained.map((node) => [
      node.kind,
      node.start,
      node.end,
      result.nodes[node.parent].kind,
    ]),
    [
      ["digit", 3, 4, "invalid_number"],
      ["digit", 11, 12, "invalid_date_time"],
      ["digit", 12, 13, "invalid_date_time"],
      ["time_offset", 22, 23, "unexpected_time_offset"],
    ],
  );
  assert.deepEqual(
    result.nodes
      .filter((node) => !node.named && ["[", "]", ","].includes(node.kind))
      .map((node) => [
        node.kind,
        result.nodes[node.parent].kind,
        node.start,
        node.end,
      ]),
    [
      ["[", "array", 2, 3],
      [",", "array_values", 5, 6],
      [",", "array_values", 16, 17],
      ["]", "array", 23, 24],
    ],
  );
});

test("toml issues: separator-only lists leave trailing layout with the container", () => {
  for (const [source, list, container] of [
    ["a=[,\n]", "array_values", "array"],
    ["a={,\n}", "inline_table_keyvals", "inline_table"],
  ]) {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, [
      [list, "invalid_syntax", "unexpected_separator", 3, 4],
    ]);
    const values = result.nodes.find((node) => node.kind === list);
    assert.deepEqual([values.start, values.end], [3, 4]);
    const newline = result.nodes.find((node) => node.kind === "newline");
    assert.equal(result.nodes[newline.parent].kind, container);
    assert.deepEqual([newline.start, newline.end], [4, 5]);
  }
});

test("toml issues: long tokens retain every normal digit and character", () => {
  for (const { source, leaf, owner, end } of [
    {
      source: `a=${"1".repeat(4096)}_`,
      leaf: "digit",
      owner: "unsigned_dec_int",
      end: 4099,
    },
    {
      source: `a="${"🌿".repeat(1024)}`,
      leaf: "basic_unescaped",
      owner: "basic_string",
      end: 4099,
    },
  ]) {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.equal(
      result.nodes.filter((node) => node.kind === leaf).length,
      leaf === "digit" ? 4095 : 1024,
    );
    assert.deepEqual(result.issues, [
      [
        owner,
        "incomplete_syntax",
        leaf === "digit" ? "invalid_number" : "missing_basic_string_close",
        leaf === "digit" ? end - 1 : end,
        end,
      ],
    ]);
  }
});

for (const [name, prefix, suffix, owner] of [
  ["bare key", "ke", "y=1", "simple_key"],
  ["comment", "# a", "b", "comment"],
  ["basic string", 'a="x', 'y"', "basic_string"],
  ["literal string", "a='x", "y'", "literal_string"],
  ["multiline basic string", 'a="""x', 'y"""', "ml_basic_body"],
  ["multiline literal string", "a='''x", "y'''", "ml_literal_body"],
  ["value", "a=", " ", "val"],
  ["decimal digits", "a=12", "3", "unsigned_dec_int"],
  ["hexadecimal digits", "a=0xA", "B", "hex_int"],
  ["octal digits", "a=0o1", "2", "oct_int"],
  ["binary digits", "a=0b0", "1", "bin_int"],
  ["exponent", "a=1e", "2", "zero_prefixable_int"],
]) {
  test(`toml issues: a decoding failure run in ${name} has its own range and reason`, () => {
    const source = Buffer.concat([
      Buffer.from(prefix),
      Buffer.from([255, 254, 128]),
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
          prefix.length,
          prefix.length + 3,
        ],
      ],
      result.cst,
    );
  });
}

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
for (const sequence of [
  String.raw`\xFF`,
  String.raw`\uD7FF`,
  String.raw`\uE000`,
  String.raw`\U0010FFFF`,
]) {
  test(`toml issues: ${sequence} stays a valid Unicode scalar sequence`, () => {
    const result = parse(`a="${sequence}"`);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, []);
  });
}

for (const [sequence, outcome, reason] of [
  [String.raw`\uD8`, "invalid_syntax", "invalid_escape"],
  [String.raw`\U0011`, "invalid_syntax", "invalid_escape"],
  [String.raw`\U1`, "invalid_syntax", "invalid_escape"],
  [String.raw`\uD`, "incomplete_syntax", "invalid_escape"],
  [String.raw`\U0010`, "incomplete_syntax", "invalid_escape"],
]) {
  test(`toml issues: EOF sequence prefix ${sequence} is classified by scalar completion`, () => {
    const source = `a="${sequence}`;
    assert.deepEqual(parse(source).issues, [
      ["basic_string", outcome, reason, 3, source.length],
      [
        "basic_string",
        "incomplete_syntax",
        "missing_basic_string_close",
        source.length,
        source.length,
      ],
    ]);
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
        Buffer.from([255, 254, 128]),
        Buffer.from(source.slice(byte)),
      ]);
      const result = parse(input);
      assert.deepEqual(
        result.issues
          .filter(([, , reason]) => reason === "invalid_encoding")
          .map(([, , , start, end]) => [start, end]),
        [[byte, byte + 3]],
        `${JSON.stringify({ source, byte })}\n${result.cst}`,
      );
    }
  }
});

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
      const start = 2 + quote.length;
      const byte = start + sequence.length;
      const source = Buffer.concat([
        Buffer.from(`a=${quote}${sequence}`),
        Buffer.from([255, 254, 128]),
        Buffer.from(`y${quote}`),
      ]);
      const result = parse(source);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        [owner, "invalid_syntax", "invalid_encoding", byte, byte + 3],
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
      const edit = { byte, deleteBytes: 3, insert: "" };
      assert.deepEqual(
        parse(source, [edit]).nodes,
        parse(
          Buffer.concat([source.subarray(0, byte), source.subarray(byte + 3)]),
        ).nodes,
      );
    });
  }
}
