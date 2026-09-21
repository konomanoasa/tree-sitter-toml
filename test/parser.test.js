import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "./support/parser.js";

const accepted = [
  [
    "CRLF separates expressions",
    "a = true\r\nb = false\r\n",
    /^0:8 - 1:0 +newline$/m,
  ],
  [
    "CRLF inside multiline basic string",
    'a = """\r\none\r\ntwo"""',
    /^1:3 - 2:0 +newline$/m,
  ],
  [
    "CRLF inside multiline inline table",
    "a = {\r\nx = true,\r\n}",
    /^1:9 - 2:0 +newline$/m,
  ],
];

for (const [name, source, node] of accepted) {
  test(`toml: ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
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

const rejected = [
  ["bare carriage return between expressions", "a = true\rb = false"],
  ["bare carriage return in multiline basic string", 'a = """one\rtwo"""'],
  ["bare carriage return in multiline literal string", "a = '''one\rtwo'''"],
  ["vertical tab as whitespace", "a\v= true"],
  ["control character in basic string", 'a = "\u0001"'],
  ["delete character in literal string", "a = '\u007f'"],
  ["control character in comment", "# \u0001"],
];

for (const [name, source] of rejected) {
  test(`toml: ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, true, result.cst);
  });
}
