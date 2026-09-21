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

const dateTimes = [
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
  ["zero positive offset", "2026-01-01T00:00+00:00"],
  ["zero negative offset", "2026-01-01T00:00-00:00"],
  ["highest positive offset", "2026-01-01T00:00:00+23:59"],
  ["highest negative offset", "2026-01-01T00:00:00-23:59"],
  ["month-dependent day is left to the consumer", "2026-04-31"],
  ["leap-year validation is left to the consumer", "2026-02-29"],
  ["leap-second validation is left to the consumer", "2026-01-01T12:00:60Z"],
];

for (const [name, value] of dateTimes) {
  test(`toml: ${name}`, () => {
    const result = parse(`a = ${value}`);
    assert.equal(result.hasError, false, result.cst);
    assert.match(result.cst, /\bdate_time\b/);
    assert.deepEqual(
      [...result.cst.matchAll(/\bdigit `([0-9])`/g)].map((match) => match[1]),
      value.match(/[0-9]/g),
    );
  });
}

test("toml: date-time digit restrictions preserve other numeric forms", () => {
  const result = parse(
    "a = [0, 1, 2, 3, 5, 6, 7, 9, 10, 20, 23, 24, 59, 60, 61, 99, 100, 2000, 9999, 0.5, 1e2, 0x123abc, 0o01234567, 0b01]",
  );
  assert.equal(result.hasError, false, result.cst);
});

const rejected = [
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

for (const [name, source] of rejected) {
  test(`toml: ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, true, result.cst);
  });
}
