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
      assert.ok(
        [":cst", ":error"].includes(attribute),
        `unsupported corpus attribute: ${attribute}`,
      );
    }
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source, valid: !attributes.includes(":error") });
  }
  return cases;
}

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source, valid } of entries) {
    test(`toml: corpus acceptance, source extent and fresh determinism: ${file}: ${name}`, () => {
      const tree = parse(source);
      assert.equal(tree.hasError, !valid, tree.cst);
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
    { name: "Empty", source: "", valid: true },
    { name: "Layout", source: "\uFEFF \t\v\f\r\na=1\n\n", valid: true },
    { name: "NUL", source: 'a="\0"', valid: true },
    { name: "Final CR", source: "a=1\r", valid: true },
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

test("toml: node metadata contains normal syntax and no diagnostic fields or nodes", () => {
  const types = JSON.parse(
    readFileSync(join(root, "src/node-types.json"), "utf8"),
  );
  assert.ok(types.some(({ type }) => type === "toml"));
  for (const { type, fields } of types) {
    assert.doesNotMatch(
      type,
      /^(syntax_issue|invalid_|incomplete_|missing_|unexpected_)/,
    );
    assert.ok(!fields || !("issue" in fields), type);
  }
});

test("CST decoding keeps an ERROR parent and nested anonymous leaves", () => {
  const source = "a?";
  const tree = parseCst(
    [
      "0:0 - 0:2   •toml",
      "0:0 - 0:2     ERROR",
      "0:0 - 0:1       unquoted_key `a`",
      '0:1 - 0:2       "?"',
    ].join("\n"),
    source,
  );
  assert.equal(tree.hasError, true);
  assert.deepEqual(
    tree.nodes.map(({ kind, parent, named, start, end }) => [
      kind,
      parent,
      named,
      start,
      end,
    ]),
    [
      ["toml", null, true, 0, 2],
      ["ERROR", 0, true, 0, 2],
      ["unquoted_key", 1, true, 0, 1],
      ["?", 1, false, 1, 2],
    ],
  );
});

test("toml: decoding failures cannot be accepted inside a normal token", () => {
  for (const [prefix, suffix] of [
    ['a="x', 'y"'],
    ["a='x", "y'"],
    ["# x", "y\nb=1"],
    ["a=1", "2"],
    ["ke", "y=1"],
    ['a="\\u00', 'FF"'],
  ]) {
    for (const invalid of [
      [0xff],
      [0xc0, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
    ]) {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from(invalid),
        Buffer.from(suffix),
      ]);
      const tree = parse(source);
      assert.equal(tree.hasError, true, tree.cst);
    }
  }
});
