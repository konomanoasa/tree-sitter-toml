import assert from "node:assert/strict";
import { test } from "node:test";
import { assertIncrementalEqualsFresh, parse } from "./support/parser.js";

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
      assert.match(result.cst, /\bdate_time\b/);
      assert.deepEqual(
        [...result.cst.matchAll(/\bdigit `([0-9])`/g)].map((match) => match[1]),
        value.match(/[0-9]/g),
      );
    }
  });
}

test("toml: every two-digit date and time boundary has the specified acceptance", () => {
  for (let value = 0; value <= 99; value++) {
    const digits = String(value).padStart(2, "0");
    for (const [literal, valid] of [
      [`2026-${digits}-01`, value >= 1 && value <= 12],
      [`2026-01-${digits}`, value >= 1 && value <= 31],
      [`${digits}:00`, value <= 23],
      [`00:${digits}`, value <= 59],
      [`00:00:${digits}`, value <= 60],
      [`2026-01-01T00:00+${digits}:00`, value <= 23],
      [`2026-01-01T00:00+00:${digits}`, value <= 59],
    ]) {
      const tree = parse(`a=${literal}`);
      assert.equal(tree.hasError, !valid, `${literal}\n${tree.cst}`);
    }
  }
});

test("toml: escape scalar boundaries apply in values and quoted keys", () => {
  const cases = [
    ["u0000", true],
    ["uD7FF", true],
    ["uD800", false],
    ["uDBFF", false],
    ["uDC00", false],
    ["uDFFF", false],
    ["uE000", true],
    ["uFFFF", true],
    ["U00000000", true],
    ["U0000D800", false],
    ["U0000DFFF", false],
    ["U00010000", true],
    ["U0010FFFF", true],
    ["U00110000", false],
    ["UFFFFFFFF", false],
    ["x00", true],
    ["x7F", true],
    ["x80", true],
    ["xFF", true],
  ];
  for (const [sequence, valid] of cases) {
    for (const source of [
      `a="\\${sequence}"`,
      `"\\${sequence}"=1`,
      `a="""\\${sequence}"""`,
    ]) {
      const tree = parse(source);
      assert.equal(tree.hasError, !valid, `${source}\n${tree.cst}`);
    }
  }
});

test("toml: forbidden controls are rejected inside strings and comments", () => {
  const controls = [...Array(32).keys(), 127].filter(
    (code) => ![9, 10, 13].includes(code),
  );
  for (const code of controls) {
    for (const [prefix, suffix] of [
      ['a="x', 'y"'],
      ["a='x", "y'"],
      ['a="""x', 'y"""'],
      ["a='''x", "y'''"],
      ["# x", "y\nb=1"],
    ]) {
      const tree = parse(`${prefix}${String.fromCodePoint(code)}${suffix}`);
      assert.equal(tree.hasError, true, tree.cst);
    }
  }
});

test("toml: long normal tokens preserve their digits and Unicode leaves", () => {
  const digitCount = 4096;
  const characterCount = 1024;
  for (const [value, leaf, count] of [
    ["1".repeat(digitCount), "digit", digitCount - 1],
    [`0x${"A".repeat(digitCount)}`, "hexdig", digitCount],
    [`"${"🌿".repeat(characterCount)}"`, "basic_unescaped", characterCount],
    [`'${"🌿".repeat(characterCount)}'`, "literal_char", characterCount],
  ]) {
    const tree = parse(`a=${value}`);
    assert.equal(tree.hasError, false, tree.cst);
    assert.equal(tree.nodes.filter(({ kind }) => kind === leaf).length, count);
  }
});

test("toml: nested containers complete and return to the original valid CST after repair", () => {
  const depth = 64;
  for (const [opening, closing] of [
    ["[", "]"],
    ["{b=", "}"],
  ]) {
    const source = `a=${opening.repeat(depth)}1${closing.repeat(depth)}`;
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assertIncrementalEqualsFresh(
      source,
      [
        { byte: source.length - 1, deleteBytes: 1, insert: "" },
        { byte: source.length - 1, deleteBytes: 0, insert: closing },
      ],
      source,
    );
  }
});
