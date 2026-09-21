use tree_sitter::{Parser, Query};
use tree_sitter_toml as grammar;

#[test]
fn parses_valid_source() {
  let source = "answer = 42\n";
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert_eq!(root.kind(), "toml");
  assert_eq!(root.byte_range(), 0..source.len());
  assert!(!root.has_error());
}

#[test]
fn linked_scanner_preserves_quotes_in_multiline_strings() {
  let language = grammar::LANGUAGE.into();
  let mut parser = Parser::new();
  parser.set_language(&language).unwrap();
  for source in ["a = \"\"\"one\"two\"\"\"\n", "a = '''one'two'''\n"] {
    let tree = parser.parse(source, None).unwrap();
    let root = tree.root_node();
    assert_eq!(root.kind(), "toml");
    assert_eq!(root.byte_range(), 0..source.len());
    assert!(!root.has_error(), "{source}");
  }
  Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
}
