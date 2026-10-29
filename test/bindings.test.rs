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
    assert!(!utf8.root_node().has_error());
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
fn utf16_unpaired_surrogates_are_rejected_in_every_lexical_context() {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  for big_endian in [false, true] {
    for (prefix, suffix) in [
      ("a=\"ok", "end\""),
      ("a='ok", "end'"),
      ("a=\"\"\"ok", "end\"\"\""),
      ("a='''ok", "end'''"),
      ("\"ok", "end\"=1"),
      ("'ok", "end'=1"),
      ("[\"ok", "end\"]"),
      ("[['ok", "end']]"),
      ("# ok", "end\na=1"),
      ("a=[1,# ok", "end\n2]"),
      ("# ok", ""),
      ("ke", "y=1"),
      ("[ke", "y]"),
      ("a=", "1"),
      ("a=1", "2"),
      ("a=0xA", "B"),
      ("a=0o1", "2"),
      ("a=0b0", "1"),
      ("a=1.", "2"),
      ("a=1e+", "2"),
      ("a=true", "\nb=2"),
      ("a=true ", ""),
      ("a={b=true", "}"),
      ("a=\"\\", "end\""),
      ("a=\"\\u00", "end\""),
    ] {
      for surrogates in [
        &[0xd800][..],
        &[0xdbff],
        &[0xdc00],
        &[0xdfff],
        &[0xd800, 0xdbff],
        &[0xdc00, 0xdfff],
        &[0xdc00, 0xd800],
        &[0xd800, 0xd800, 0xdc00, 0xdc00],
      ] {
        let mut input: Vec<u16> = prefix.encode_utf16().collect();
        input.extend(surrogates);
        input.extend(suffix.encode_utf16());
        let tree = parse_utf16(&mut parser, &input, big_endian, None);
        assert!(
          tree.root_node().has_error(),
          "{prefix:?} {suffix:?} {surrogates:x?} BE={big_endian}: {}",
          tree.root_node().to_sexp()
        );
      }
    }
  }
}

#[test]
fn utf16_surrogate_pair_repairs_restore_the_valid_cst() {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  for big_endian in [false, true] {
    for (prefix, suffix) in [
      ("a=\"ok", "end\""),
      ("a='ok", "end'"),
      ("a=\"\"\"ok", "end\"\"\""),
      ("a='''ok", "end'''"),
      ("\"ok", "end\"=1"),
      ("# ok", "end\na=1"),
    ] {
      for removed_unit in [0, 1] {
        let mut input: Vec<u16> = prefix.encode_utf16().collect();
        let index = input.len() + removed_unit;
        input.extend([0xd83c, 0xdf3f]);
        input.extend(suffix.encode_utf16());
        let original = parse_utf16(&mut parser, &input, big_endian, None);
        let expected = public_nodes(&original);
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
        assert!(tree.root_node().has_error());
        let reuse = !tree.root_node().has_error();
        input.insert(index, removed);
        tree.edit(&InputEdit {
          start_byte: start,
          old_end_byte: start,
          new_end_byte: start + 2,
          start_position: Point::new(0, start),
          old_end_position: Point::new(0, start),
          new_end_position: Point::new(0, start + 2),
        });
        tree =
          parse_utf16(&mut parser, &input, big_endian, reuse.then_some(&tree));
        assert!(
          !tree.root_node().has_error(),
          "{prefix:?} restore={removed_unit} BE={big_endian}: {}",
          tree.root_node().to_sexp()
        );
        assert_eq!(
          public_nodes(&tree),
          expected,
          "{prefix:?} restore={removed_unit} BE={big_endian}"
        );
      }
    }
  }
}

#[test]
fn inserting_and_removing_nul_restores_structure() {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
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
  assert!(tree.root_node().has_error());
  let reuse = !tree.root_node().has_error();
  tree.edit(&InputEdit {
    start_byte: 4,
    old_end_byte: 5,
    new_end_byte: 4,
    start_position: Point::new(0, 4),
    old_end_position: Point::new(0, 5),
    new_end_position: Point::new(0, 4),
  });
  tree = parser.parse(original, reuse.then_some(&tree)).unwrap();
  assert_eq!(public_nodes(&tree), public_nodes(&original_tree));
}

#[test]
fn changed_included_ranges_preserve_original_offsets_with_fresh_parsing() {
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  let source = "a=\"axb\"";
  let first = tree_sitter::Range {
    start_byte: 0,
    end_byte: 4,
    start_point: Point::new(0, 0),
    end_point: Point::new(0, 4),
  };
  parser.set_included_ranges(&[first]).unwrap();
  let incomplete = parser.parse(source, None).unwrap();
  assert!(incomplete.root_node().has_error());
  parser
    .set_included_ranges(&[
      first,
      tree_sitter::Range {
        start_byte: 5,
        end_byte: 7,
        start_point: Point::new(0, 5),
        end_point: Point::new(0, 7),
      },
    ])
    .unwrap();
  let tree = parser.parse(source, None).unwrap();
  let characters: Vec<_> = public_nodes(&tree)
    .into_iter()
    .filter(|node| node.kind == "basic_unescaped")
    .map(|node| node.range)
    .collect();
  assert_eq!(characters, [3..4, 5..6]);
  let reused = parser.parse(source, Some(&tree)).unwrap();
  assert_eq!(public_nodes(&reused), public_nodes(&tree));
}

#[test]
fn cancelled_normal_parsing_resumes_with_the_same_public_cst() {
  use std::ops::ControlFlow;
  use tree_sitter::ParseOptions;
  const LINE_COUNT: usize = 256;
  let source = "a={b=[1, 07:32],c=\"🌿\"}\n".repeat(LINE_COUNT);
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  let fresh = parser.parse(&source, None).unwrap();
  for stop_at in [1, 2, 4] {
    parser.reset();
    let mut calls = 0;
    let mut progress = |_: &tree_sitter::ParseState| {
      calls += 1;
      if calls == stop_at {
        ControlFlow::Break(())
      } else {
        ControlFlow::Continue(())
      }
    };
    let result = parser.parse_with_options(
      &mut |offset, _| &source.as_bytes()[offset..],
      None,
      Some(ParseOptions::new().progress_callback(&mut progress)),
    );
    assert!(result.is_none());
    let resumed = parser.parse(&source, None).unwrap();
    assert_eq!(public_nodes(&resumed), public_nodes(&fresh));
  }
}
