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

fn parse_utf16(
  parser: &mut Parser,
  source: &[u16],
  big_endian: bool,
  old: Option<&Tree>,
) -> Tree {
  let encoded: Vec<u16> = source
    .iter()
    .map(|unit| {
      if big_endian {
        unit.to_be()
      } else {
        unit.to_le()
      }
    })
    .collect();
  if big_endian {
    parser.parse_utf16_be(&encoded, old)
  } else {
    parser.parse_utf16_le(&encoded, old)
  }
  .unwrap()
}

#[test]
fn utf16_unpaired_surrogates_are_encoding_issues_in_every_context() {
  for big_endian in [false, true] {
    let mut parser = Parser::new();
    parser.set_language(&grammar::LANGUAGE.into()).unwrap();
    for (prefix, suffix, owner) in [
      ("a=\"ok", "end\"", "basic_string"),
      ("a='ok", "end'", "literal_string"),
      ("a=\"\"\"ok", "end\"\"\"", "ml_basic_body"),
      ("a='''ok", "end'''", "ml_literal_body"),
      ("\"ok", "end\"=1", "basic_string"),
      ("'ok", "end'=1", "literal_string"),
      ("[\"ok", "end\"]", "basic_string"),
      ("[['ok", "end']]", "literal_string"),
      ("# ok", "end\na=1", "comment"),
      ("a=[1,# ok", "end\n2]", "comment"),
      ("# ok", "", "comment"),
      ("ke", "y=1", "simple_key"),
      ("[ke", "y]", "simple_key"),
      ("a=", "1", "val"),
      ("a=1", "2", "unsigned_dec_int"),
      ("a=0xA", "B", "hex_int"),
      ("a=0o1", "2", "oct_int"),
      ("a=0b0", "1", "bin_int"),
      ("a=1.", "2", "zero_prefixable_int"),
      ("a=1e+", "2", "zero_prefixable_int"),
      ("a=true", "\nb=2", "expression"),
      ("a=true ", "", "expression"),
      ("a={b=true", "}", "inline_table_keyvals"),
      ("a=\"\\", "end\"", "escaped"),
      ("a=\"\\u00", "end\"", "escape_seq_char"),
    ] {
      for surrogates in [
        &[0xd800][..],
        &[0xdbff],
        &[0xdc00],
        &[0xdfff],
        &[0xd800, 0xdbff],
        &[0xdc00, 0xdfff],
        &[0xdc00, 0xd800],
      ] {
        let mut input: Vec<u16> = prefix.encode_utf16().collect();
        let start = input.len() * 2;
        input.extend(surrogates);
        let end = input.len() * 2;
        input.extend(suffix.encode_utf16());
        let tree = parse_utf16(&mut parser, &input, big_endian, None);
        let nodes = public_nodes(&tree);
        let issues: Vec<_> =
          nodes.iter().filter(|n| n.kind == "syntax_issue").collect();
        assert_eq!(
          issues.len(),
          1,
          "{prefix:?} {suffix:?} {surrogates:x?} BE={big_endian}: {}",
          tree.root_node().to_sexp()
        );
        let reason = tree
          .root_node()
          .descendant_for_byte_range(start, end)
          .unwrap();
        assert_eq!(
          reason.kind(),
          "invalid_encoding",
          "{prefix:?} {surrogates:x?}: {}",
          tree.root_node().to_sexp()
        );
        assert_eq!(reason.byte_range(), start..end);
        let outcome = reason.parent().unwrap();
        assert_eq!(outcome.kind(), "invalid_syntax");
        let issue = outcome.parent().unwrap();
        assert_eq!(issue.kind(), "syntax_issue");
        assert_eq!(issue.parent().unwrap().kind(), owner);
      }
    }
  }
}

#[test]
fn utf16_scalar_boundaries_match_utf8_public_structure() {
  let text = "é\u{d7ff}\u{e000}\u{fffd}\u{ffff}\u{10000}\u{10ffff}";
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  for (prefix, suffix) in [
    ("a=\"", "\""),
    ("a='", "'"),
    ("a=\"\"\"\n", "\n\"\"\""),
    ("a='''\r\n", "\r\n'''"),
    ("\"", "\"=1"),
    ("'", "'=1"),
    ("[\"", "\"]"),
    ("[['", "']]"),
    ("# ", "\r\na=1"),
  ] {
    let source = format!("{prefix}{text}{suffix}");
    let utf8 = parser.parse(&source, None).unwrap();
    let mut expected = public_nodes(&utf8);
    assert!(!expected.iter().any(|node| node.kind == "syntax_issue"));
    for node in &mut expected {
      node.range = source[..node.range.start].encode_utf16().count() * 2
        ..source[..node.range.end].encode_utf16().count() * 2;
    }
    let input: Vec<_> = source.encode_utf16().collect();
    for big_endian in [false, true] {
      let utf16 = parse_utf16(&mut parser, &input, big_endian, None);
      assert_eq!(public_nodes(&utf16), expected, "{source:?} BE={big_endian}");
    }
  }
}

#[test]
fn utf16_encoding_issues_stop_at_valid_surrogate_pairs() {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  for (prefix, suffix, leaf) in [
    ("a=\"", "\"", "basic_unescaped"),
    ("# ", "", "comment_text"),
  ] {
    let mut input: Vec<_> = prefix.encode_utf16().collect();
    let start = input.len() * 2;
    input.extend([0xd800, 0xd800, 0xdc00, 0xdc00]);
    input.extend(suffix.encode_utf16());
    for big_endian in [false, true] {
      let tree = parse_utf16(&mut parser, &input, big_endian, None);
      let nodes = public_nodes(&tree);
      assert_eq!(
        nodes
          .iter()
          .filter(|node| node.kind == "syntax_issue")
          .map(|node| node.range.clone())
          .collect::<Vec<_>>(),
        [start..start + 2, start + 6..start + 8]
      );
      assert_eq!(
        nodes
          .iter()
          .filter(|node| node.kind == "invalid_encoding")
          .count(),
        2
      );
      let pair = tree
        .root_node()
        .descendant_for_byte_range(start + 2, start + 6)
        .unwrap();
      assert_eq!(pair.kind(), leaf);
      assert_eq!(pair.byte_range(), start + 2..start + 6);
      assert_eq!(pair.child_count(), 0);
    }
  }
}

#[test]
fn utf16_surrogate_pair_edits_match_fresh_parses() {
  for big_endian in [false, true] {
    let mut parser = Parser::new();
    parser.set_language(&grammar::LANGUAGE.into()).unwrap();
    let mut fresh_parser = Parser::new();
    fresh_parser
      .set_language(&grammar::LANGUAGE.into())
      .unwrap();
    for (prefix, suffix) in [
      ("a=\"ok", "end\""),
      ("a='ok", "end'"),
      ("a=\"\"\"ok", "end\"\"\""),
      ("a='''ok", "end'''"),
      ("\"ok", "end\"=1"),
      ("# ok", "end\na=1"),
    ] {
      for removed_unit in [0, 1] {
        let mut input: Vec<_> = prefix.encode_utf16().collect();
        let pair_start = input.len() * 2;
        let index = input.len() + removed_unit;
        input.extend([0xd83c, 0xdf3f]);
        input.extend(suffix.encode_utf16());
        let original = parse_utf16(&mut parser, &input, big_endian, None);
        assert!(
          !public_nodes(&original)
            .iter()
            .any(|node| node.kind == "syntax_issue")
        );
        let mut tree = original.clone();
        let removed = input.remove(index);
        let start = index * 2;
        tree.edit(&InputEdit {
          start_byte: start,
          old_end_byte: start + 2,
          new_end_byte: start,
          start_position: Point::new(0, start),
          old_end_position: Point::new(0, start + 2),
          new_end_position: Point::new(0, start),
        });
        tree = parse_utf16(&mut parser, &input, big_endian, Some(&tree));
        let fresh = parse_utf16(&mut fresh_parser, &input, big_endian, None);
        let nodes = public_nodes(&tree);
        assert_eq!(
          nodes,
          public_nodes(&fresh),
          "{prefix:?} remove={removed_unit} BE={big_endian}"
        );
        assert_eq!(
          nodes
            .iter()
            .filter(|node| node.kind == "syntax_issue")
            .count(),
          1
        );
        let reason = tree
          .root_node()
          .descendant_for_byte_range(pair_start, pair_start + 2)
          .unwrap();
        assert_eq!(reason.kind(), "invalid_encoding");
        assert_eq!(reason.byte_range(), pair_start..pair_start + 2);
        input.insert(index, removed);
        tree.edit(&InputEdit {
          start_byte: start,
          old_end_byte: start,
          new_end_byte: start + 2,
          start_position: Point::new(0, start),
          old_end_position: Point::new(0, start),
          new_end_position: Point::new(0, start + 2),
        });
        tree = parse_utf16(&mut parser, &input, big_endian, Some(&tree));
        assert_eq!(
          public_nodes(&tree),
          public_nodes(&original),
          "{prefix:?} restore={removed_unit} BE={big_endian}"
        );
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
