use konomanoasa_tree_sitter_toml as grammar;
use tree_sitter::{InputEdit, Parser, Point, Query, Tree};

#[test]
fn parses_valid_source() {
  let source = "answer = 42\n";
  let language = grammar::LANGUAGE.into();
  let mut parser = Parser::new();
  parser.set_language(&language).unwrap();
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert_eq!(root.kind(), "toml");
  assert_eq!(root.byte_range(), 0..source.len());
  assert!(!root.has_error());
  assert!(grammar::NODE_TYPES.contains("\"toml\""));
  Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
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
}

#[derive(Debug, PartialEq)]
struct PublicNode {
  kind: String,
  named: bool,
  field: Option<String>,
  depth: u32,
  range: std::ops::Range<usize>,
}

fn public_nodes(tree: &Tree) -> Vec<PublicNode> {
  let mut cursor = tree.walk();
  let mut nodes = Vec::new();
  loop {
    let node = cursor.node();
    assert!(!node.is_error() && !node.is_missing());
    nodes.push(PublicNode {
      kind: node.kind().into(),
      named: node.is_named(),
      field: cursor.field_name().map(String::from),
      depth: cursor.depth(),
      range: node.byte_range(),
    });
    if cursor.goto_first_child() {
      continue;
    }
    while !cursor.goto_next_sibling() {
      if !cursor.goto_parent() {
        return nodes;
      }
    }
  }
}

#[test]
fn inserting_and_removing_nul_preserves_structure_and_parser_reuse() {
  let language = grammar::LANGUAGE.into();
  let mut parser = Parser::new();
  parser.set_language(&language).unwrap();
  let mut fresh_parser = Parser::new();
  fresh_parser.set_language(&language).unwrap();
  let original = "a=\"x\"";
  let edited = "a=\"x\0\"";
  let original_tree = parser.parse(original, None).unwrap();
  let mut tree = original_tree.clone();
  tree.edit(&InputEdit {
    start_byte: 4,
    old_end_byte: 4,
    new_end_byte: 5,
    start_position: Point::new(0, 4),
    old_end_position: Point::new(0, 4),
    new_end_position: Point::new(0, 5),
  });
  tree = parser.parse(edited, Some(&tree)).unwrap();
  let fresh = fresh_parser.parse(edited, None).unwrap();
  assert_eq!(public_nodes(&tree), public_nodes(&fresh));
  let reason = tree.root_node().descendant_for_byte_range(4, 5).unwrap();
  assert_eq!(reason.kind(), "invalid_character");
  assert_eq!(reason.byte_range(), 4..5);
  let outcome = reason.parent().unwrap();
  assert_eq!(outcome.kind(), "invalid_syntax");
  let issue = outcome.parent().unwrap();
  let owner = issue.parent().unwrap();
  assert_eq!(owner.kind(), "basic_string");
  assert_eq!(owner.child_by_field_name("issue"), Some(issue));
  tree.edit(&InputEdit {
    start_byte: 4,
    old_end_byte: 5,
    new_end_byte: 4,
    start_position: Point::new(0, 4),
    old_end_position: Point::new(0, 5),
    new_end_position: Point::new(0, 4),
  });
  tree = parser.parse(original, Some(&tree)).unwrap();
  assert_eq!(public_nodes(&tree), public_nodes(&original_tree));
}

#[test]
fn long_invalid_runs_preserve_normal_digits_and_recovery_boundaries() {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  let count = 8192;
  for (source, reason, issues, digits) in [
    (
      format!("a={}", "1x".repeat(count)),
      "invalid_number",
      count,
      count,
    ),
    (
      format!("a={}", "1x2e".repeat(count)),
      "invalid_number",
      count * 2,
      count * 2,
    ),
    (
      format!("a={}", "1x2.".repeat(count)),
      "invalid_number",
      count * 2,
      count * 2,
    ),
    (
      format!("a=true{}", "x.".repeat(count)),
      "invalid_character",
      1,
      0,
    ),
    (
      format!("a=truex{}", " .x".repeat(count)),
      "invalid_character",
      count + 1,
      0,
    ),
    (
      format!("a=1?{}", "x.".repeat(count)),
      "invalid_number",
      1,
      1,
    ),
    (
      format!("a=1?{}", "x1.".repeat(count)),
      "invalid_number",
      count + 1,
      count + 1,
    ),
    (
      format!("a={}1", "=\0".repeat(count)),
      "invalid_character",
      1,
      1,
    ),
    (
      format!("[a{}]", "{},".repeat(count)),
      "invalid_character",
      1,
      0,
    ),
  ] {
    let tree = parser.parse(&source, None).unwrap();
    assert_eq!(tree.root_node().byte_range(), 0..source.len());
    let nodes = public_nodes(&tree);
    assert_eq!(
      nodes
        .iter()
        .filter(|node| node.kind == "syntax_issue")
        .count(),
      issues
    );
    assert_eq!(
      nodes.iter().filter(|node| node.kind == reason).count(),
      issues
    );
    assert_eq!(
      nodes
        .iter()
        .filter(|node| matches!(node.kind.as_str(), "digit" | "digit1_9"))
        .count(),
      digits
    );
  }
}
