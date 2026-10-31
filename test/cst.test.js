import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { parseCst } from "./support/cst.js";
import { parse } from "./support/parser.js";

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    for (const attribute of attributes) {
      assert.equal(
        attribute,
        ":cst",
        `unsupported corpus attribute: ${attribute}`,
      );
    }
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source });
  }
  return cases;
}

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

test(`toml: UTF-16LE isolates lone surrogates and preserves normal pairs`, () => {
  for (const [prefix, suffix, owner] of [
    ['a="ok', 'end"', "basic_string"],
    ["a='ok", "end'", "literal_string"],
    ['a="""ok', 'end"""', "ml_basic_body"],
    ["a='''ok", "end'''", "ml_literal_body"],
    ['"ok', 'end"=1', "basic_string"],
    ["# ok", "end\r\na=1", "comment"],
    ["ke", "y=1", "simple_key"],
    ["a=", "1", "val"],
    ["a=1", "2", "unsigned_dec_int"],
    ["a=0xA", "B", "hex_int"],
    ["a=0o1", "2", "oct_int"],
    ["a=0b0", "1", "bin_int"],
    ["a=1e+", "2", "zero_prefixable_int"],
    ["a=true", "\nb=2", "expression"],
    ['a="\\', 'end"', "escaped"],
    ['a="\\u00', 'end"', "escape_seq_char"],
  ]) {
    for (const text of ["\ud800", "\udfff", "\udc00\ud800"]) {
      const source = Buffer.from(prefix + text + suffix, "utf16le");
      const tree = parse(source, [], { encoding: "utf16-le" });
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(
        tree.issues,
        [
          [
            owner,
            "invalid_syntax",
            "invalid_encoding",
            prefix.length * 2,
            (prefix.length + text.length) * 2,
          ],
        ],
        tree.cst,
      );
    }
  }
  for (const [prefix, suffix, leaf] of [
    ['a="', '"', "basic_unescaped"],
    ["# ", "\r\n", "comment_text"],
  ]) {
    const source = Buffer.from(
      `${prefix}\ud800\ud800\udc00\udc00${suffix}`,
      "utf16le",
    );
    const tree = parse(source, [], { encoding: "utf16-le" });
    const start = prefix.length * 2;
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(
      tree.issues.map((issue) => issue.slice(2)),
      [
        ["invalid_encoding", start, start + 2],
        ["invalid_encoding", start + 6, start + 8],
      ],
      tree.cst,
    );
    assert.ok(
      tree.nodes.some(
        (node) =>
          node.kind === leaf &&
          node.start === start + 2 &&
          node.end === start + 6,
      ),
      tree.cst,
    );
  }
});
test(`toml: UTF-16LE preserves the UTF-8 structure and scalar boundaries`, () => {
  const source = '["日本"]\r\na = "🌿\\xFF"\r\n# café\n';
  const utf8 = parse(source);
  const bytes = Buffer.from(source, "utf16le");
  const utf16 = parse(bytes, [], { encoding: "utf16-le" });
  assert.equal(utf16.hasError, false, utf16.cst);
  assert.deepEqual(utf16.issues, []);
  const utf8Bytes = Buffer.from(source);
  assert.deepEqual(
    utf16.nodes,
    utf8.nodes.map((node) => ({
      ...node,
      start: utf8Bytes.subarray(0, node.start).toString().length * 2,
      end: utf8Bytes.subarray(0, node.end).toString().length * 2,
    })),
  );
});

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
