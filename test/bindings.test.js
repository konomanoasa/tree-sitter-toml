import assert from "node:assert/strict";
import { test } from "node:test";
import TOML from "@konomanoasa/tree-sitter-toml";
import Parser from "tree-sitter";

test("Node.js language parses multiline TOML strings with the scanner and exposes node metadata", () => {
  const parser = new Parser();
  parser.setLanguage(TOML);
  const source = 'key = """value\n"""\n';
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.type, "toml");
  assert.equal(tree.rootNode.hasError, false);
  assert.equal(tree.rootNode.text, source);
  assert.equal(tree.rootNode.descendantsOfType("syntax_issue").length, 0);
  assert.equal(tree.rootNode.descendantsOfType("ml_basic_string").length, 1);
  assert.ok(
    TOML.nodeTypeInfo.some((node) => node.type === "toml" && node.named),
  );
});

test("Node.js packaged highlights capture TOML comments", () => {
  const parser = new Parser();
  parser.setLanguage(TOML);
  const tree = parser.parse("# hello\n");
  const query = new Parser.Query(TOML, TOML.HIGHLIGHTS_QUERY);
  assert.deepEqual(
    query.captures(tree.rootNode).map(({ name, node }) => [name, node.text]),
    [["comment", "# hello"]],
  );
});
