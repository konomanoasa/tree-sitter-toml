import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "./support/parser.js";

const cases = [
  [
    "value at EOF",
    "a =",
    [["keyval", "incomplete_syntax", "missing_value", 3, 3]],
  ],
  [
    "value before a newline",
    "a =\nb = 2",
    [["keyval", "invalid_syntax", "missing_value", 3, 3]],
  ],
  [
    "basic quote at EOF",
    'a = "x',
    [["basic_string", "incomplete_syntax", "missing_basic_string_close", 6, 6]],
  ],
  [
    "array closing at EOF",
    "a = [1",
    [["array", "incomplete_syntax", "missing_array_close", 6, 6]],
  ],
  [
    "bad escape between normal characters",
    'a = "x\\qy"',
    [["basic_string", "invalid_syntax", "invalid_escape", 6, 8]],
  ],
  [
    "nested closings at EOF",
    "a = [[1",
    [
      ["array", "incomplete_syntax", "missing_array_close", 7, 7],
      ["array", "incomplete_syntax", "missing_array_close", 7, 7],
    ],
  ],
];
for (const [initial, insert] of [
  ["a =", "1"],
  ['a = "x', '"'],
  ["a = [1", "]"],
  ["a=07", ":32"],
  ["a=07", " "],
  ["a=[07", "]"],
  ["a=01", "00-01-01"],
  ["a=0e", "e"],
  ["a=0e+", "e"],
  ["a=1e5", "e"],
  ["a=[1]", "x=2"],
  ['a="""x"""""', '"'],
]) {
  test(`toml issues: append and remove ${JSON.stringify(insert)} at ${JSON.stringify(initial)}`, () => {
    const byte = Buffer.byteLength(initial);
    const edits = [{ byte, deleteBytes: 0, insert }];
    assert.deepEqual(
      parse(initial, edits).nodes,
      parse(initial + insert).nodes,
    );
    edits.push({ byte, deleteBytes: Buffer.byteLength(insert), insert: "" });
    assert.deepEqual(parse(initial, edits).nodes, parse(initial).nodes);
  });
}

const boundaryCases = [
  [
    "quoted key immediately followed by a numeric value",
    '""0',
    [["keyval", "invalid_syntax", "missing_assignment_operator", 2, 2]],
  ],
  [
    "header missing its key before an invalid delimiter",
    "[{",
    [
      ["std_table", "invalid_syntax", "missing_key", 1, 1],
      ["std_table", "invalid_syntax", "invalid_character", 1, 2],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 2, 2],
    ],
  ],
  [
    "signed fraction without digits",
    "a=+.",
    [
      ["dec_int", "invalid_syntax", "missing_digits", 3, 3],
      ["frac", "incomplete_syntax", "missing_digits", 4, 4],
    ],
  ],
  [
    "space terminates a base prefix before another expression",
    "a=0x 1",
    [
      ["hex_int", "invalid_syntax", "missing_digits", 4, 4],
      ["toml", "invalid_syntax", "missing_newline", 5, 5],
      ["keyval", "incomplete_syntax", "missing_assignment_operator", 6, 6],
      ["keyval", "incomplete_syntax", "missing_value", 6, 6],
    ],
  ],
  [
    "space terminates a fraction before a stray character",
    "a=. \\",
    [
      ["float", "invalid_syntax", "missing_digits", 2, 2],
      ["frac", "invalid_syntax", "missing_digits", 3, 3],
      ["expression", "invalid_syntax", "invalid_character", 4, 5],
    ],
  ],
  [
    "colon after a broken numeric prefix does not start a date",
    "a=2+01:00",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7],
    ],
  ],
  [
    "empty time fraction before a numeric offset",
    "a=2026-01-01T12:34:56.+01:00",
    [["time_secfrac", "invalid_syntax", "missing_digits", 22, 22]],
  ],
  [
    "leading inline table comma before a newline",
    "a={,\nx=1}",
    [["inline_table_keyvals", "invalid_syntax", "unexpected_separator", 3, 4]],
  ],
  [
    "leading array comma before a space",
    "a=[, 1]",
    [["array_values", "invalid_syntax", "unexpected_separator", 3, 4]],
  ],
  [
    "repeated array comma before a newline",
    "a=[1,,\n2]",
    [["array_values", "invalid_syntax", "unexpected_separator", 5, 6]],
  ],
  [
    "header retains a dotted key after an unexpected comma",
    "[1,.",
    [
      ["std_table", "invalid_syntax", "invalid_character", 2, 3],
      ["std_table", "invalid_syntax", "unexpected_key", 3, 4],
      ["dotted_key", "invalid_syntax", "missing_key", 3, 3],
      ["dotted_key", "incomplete_syntax", "missing_key", 4, 4],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 4, 4],
    ],
  ],
  [
    "nested recovery retains every keyval and array owner",
    "a={b[1,2=3}",
    [
      ["keyval", "invalid_syntax", "missing_assignment_operator", 4, 4],
      ["val", "invalid_syntax", "invalid_character", 8, 9],
      ["array_values", "invalid_syntax", "missing_array_separator", 9, 9],
      ["array", "invalid_syntax", "missing_array_close", 10, 10],
    ],
  ],
  [
    "numeric array element after a newline without a comma",
    "a=[1\n2]",
    [["array_values", "invalid_syntax", "missing_array_separator", 5, 5]],
  ],
  [
    "numeric array element adjacent to a string",
    'a=["x"1]',
    [["array_values", "invalid_syntax", "missing_array_separator", 6, 6]],
  ],
  [
    "unknown array value after a missing comma",
    "a=[1 a]",
    [
      ["array_values", "invalid_syntax", "missing_array_separator", 5, 5],
      ["val", "invalid_syntax", "invalid_value", 5, 6],
    ],
  ],
  [
    "numeric inline table key after a newline without a comma",
    "a={b=1\n2=3}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "numeric inline table key adjacent to a container",
    "a={b=[]1=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "leading separator after a negative sign",
    "a=-_1",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "leading separator after a positive sign at EOF",
    "a=+_",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "leading separator in a signed float",
    "a=-_1.2",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "single space introduces an hour prefix at EOF",
    "a = 2026-01-01 0",
    [
      ["time_hour", "incomplete_syntax", "incomplete_date_time", 15, 16],
      ["partial_time", "incomplete_syntax", "missing_time_separator", 16, 16],
      ["partial_time", "incomplete_syntax", "missing_digits", 16, 16],
    ],
  ],
  [
    "inline table keeps a value without a key",
    "a={[1]}",
    [["inline_table_keyvals", "invalid_syntax", "unexpected_value", 3, 6]],
  ],
  [
    "mismatched closing stays with the enclosing inline table",
    "a={b=1[}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        6,
        6,
      ],
      ["inline_table_keyvals", "invalid_syntax", "unexpected_value", 6, 7],
      ["array", "invalid_syntax", "missing_array_close", 7, 7],
    ],
  ],
  [
    "extra closing before comment keeps one expression",
    "a=1] # tail\nb=2",
    [["expression", "invalid_syntax", "invalid_character", 3, 4]],
  ],
  [
    "adjacent scalar and nested array retain both values",
    "a=[1[2]]",
    [["array_values", "invalid_syntax", "missing_array_separator", 4, 4]],
  ],
  [
    "adjacent boolean and string retain both values",
    'a=[true"x"]',
    [["array_values", "invalid_syntax", "missing_array_separator", 7, 7]],
  ],
  [
    "CR waiting for LF at EOF",
    "a=1\r",
    [["toml", "incomplete_syntax", "incomplete_line_ending", 3, 4]],
  ],
  [
    "short boolean at EOF",
    "a = tru",
    [["val", "incomplete_syntax", "incomplete_value", 4, 7]],
  ],
  [
    "short boolean before closing",
    "a=[tru]",
    [["val", "invalid_syntax", "invalid_value", 3, 6]],
  ],
  [
    "signed special float prefix",
    "a = +in",
    [["special_float", "incomplete_syntax", "incomplete_value", 5, 7]],
  ],
  [
    "bare numeric sign",
    "a = -",
    [["dec_int", "incomplete_syntax", "missing_digits", 5, 5]],
  ],
  [
    "base prefix without digits",
    "a = 0x",
    [["hex_int", "incomplete_syntax", "missing_digits", 6, 6]],
  ],
  [
    "leading base separator",
    "a = 0x_",
    [["hex_int", "invalid_syntax", "invalid_number", 6, 7]],
  ],
  [
    "bad binary digit",
    "a = 0b2",
    [["bin_int", "invalid_syntax", "invalid_number", 6, 7]],
  ],
  [
    "trailing separator at EOF",
    "a = 1_",
    [["unsigned_dec_int", "incomplete_syntax", "incomplete_number", 5, 6]],
  ],
  [
    "trailing separator before closing",
    "a=[1_]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 5]],
  ],
  [
    "unsigned leading-zero digits at EOF await a date or time",
    "a = 01",
    [["val", "incomplete_syntax", "incomplete_value", 4, 6]],
  ],
  [
    "fraction missing integer digits",
    "a = .5",
    [["float", "invalid_syntax", "missing_digits", 4, 4]],
  ],
  [
    "exponent missing signed digits",
    "a = 1e+",
    [["float_exp_part", "incomplete_syntax", "missing_digits", 7, 7]],
  ],
  [
    "out of range month",
    "a = 2026-13-01",
    [["date_month", "invalid_syntax", "invalid_date_time", 9, 11]],
  ],
  [
    "appendable hour prefix",
    "a = 2026-01-01T0",
    [
      ["time_hour", "incomplete_syntax", "incomplete_date_time", 15, 16],
      ["partial_time", "incomplete_syntax", "missing_time_separator", 16, 16],
      ["partial_time", "incomplete_syntax", "missing_digits", 16, 16],
    ],
  ],
  [
    "unappendable hour prefix",
    "a = 2026-01-01T9",
    [
      ["time_hour", "invalid_syntax", "invalid_date_time", 15, 16],
      ["partial_time", "incomplete_syntax", "missing_time_separator", 16, 16],
      ["partial_time", "incomplete_syntax", "missing_digits", 16, 16],
    ],
  ],
  [
    "offset without date",
    "a = 12:34Z",
    [["local_time", "invalid_syntax", "unexpected_time_offset", 9, 10]],
  ],
  [
    "fraction without seconds",
    "a = 12:34.5",
    [["partial_time", "invalid_syntax", "unexpected_time_fraction", 9, 11]],
  ],
  [
    "invalid escape at EOF",
    'a = "\\q',
    [
      ["basic_string", "invalid_syntax", "invalid_escape", 5, 7],
      ["basic_string", "incomplete_syntax", "missing_basic_string_close", 7, 7],
    ],
  ],
  [
    "short escape at EOF",
    'a = "\\u12',
    [
      ["basic_string", "incomplete_syntax", "incomplete_escape", 5, 9],
      ["basic_string", "incomplete_syntax", "missing_basic_string_close", 9, 9],
    ],
  ],
  [
    "short escape before quote",
    'a = "\\u12"',
    [["basic_string", "invalid_syntax", "invalid_escape", 5, 9]],
  ],
  [
    "multiline continuation prefix",
    'a = """\\  ',
    [
      ["ml_basic_body", "incomplete_syntax", "incomplete_escape", 7, 10],
      [
        "ml_basic_string",
        "incomplete_syntax",
        "missing_ml_basic_string_close",
        10,
        10,
      ],
    ],
  ],
  [
    "bare CR after multiline backslash",
    'a = """x\\\ry"""',
    [
      ["ml_basic_body", "invalid_syntax", "invalid_escape", 8, 9],
      ["ml_basic_body", "invalid_syntax", "invalid_line_ending", 9, 10],
    ],
  ],
  [
    "empty string before CRLF",
    'a = "\r\n',
    [["basic_string", "invalid_syntax", "missing_basic_string_close", 5, 5]],
  ],
  [
    "literal string before CRLF",
    "a = '\r\n",
    [
      [
        "literal_string",
        "invalid_syntax",
        "missing_literal_string_close",
        5,
        5,
      ],
    ],
  ],
  [
    "CR in array layout",
    "a = [\r]",
    [["array", "invalid_syntax", "invalid_line_ending", 5, 6]],
  ],
  [
    "CR in inline table layout",
    "a = {\r}",
    [["inline_table", "invalid_syntax", "invalid_line_ending", 5, 6]],
  ],
  [
    "NUL before a definite value",
    "a = \0true",
    [["val", "invalid_syntax", "invalid_character", 4, 5]],
  ],
  [
    "NUL between key fragments",
    "a\0b = true",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 2]],
  ],
  [
    "NUL within a number",
    "a = [1\0,2]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7]],
  ],
  [
    "NUL in a comment",
    "# a\0b",
    [["comment", "invalid_syntax", "invalid_character", 3, 4]],
  ],
  [
    "UTF8 bare key character",
    "a🌿b=1",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 5]],
  ],
  [
    "missing first dotted key",
    ".a=1",
    [["dotted_key", "invalid_syntax", "missing_key", 0, 0]],
  ],
  [
    "missing middle dotted key",
    "a..b=1",
    [["dotted_key", "invalid_syntax", "missing_key", 2, 2]],
  ],
  [
    "empty table name",
    "[]",
    [["std_table", "invalid_syntax", "missing_key", 1, 1]],
  ],
  [
    "extra header key",
    "[a b]",
    [["std_table", "invalid_syntax", "unexpected_key", 3, 4]],
  ],
  [
    "partial header closing at EOF",
    "[[a]",
    [["array_table", "incomplete_syntax", "incomplete_delimiter", 3, 4]],
  ],
  [
    "partial header closing before newline",
    "[[a]\nx=1",
    [["array_table", "invalid_syntax", "invalid_delimiter", 3, 4]],
  ],
  [
    "missing array separator",
    "a=[true false]",
    [["array_values", "invalid_syntax", "missing_array_separator", 8, 8]],
  ],
  [
    "missing inline table separator",
    "a={b=1 c=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        7,
        7,
      ],
    ],
  ],
  [
    "missing document newline",
    "a=1 b=2",
    [["toml", "invalid_syntax", "missing_newline", 4, 4]],
  ],
  [
    "nested incomplete entries",
    "a={b={c=",
    [
      ["keyval", "incomplete_syntax", "missing_value", 8, 8],
      ["inline_table", "incomplete_syntax", "missing_inline_table_close", 8, 8],
      ["inline_table", "incomplete_syntax", "missing_inline_table_close", 8, 8],
    ],
  ],
  [
    "control character after a quoted key",
    "'a'\0",
    [
      ["keyval", "invalid_syntax", "missing_assignment_operator", 3, 3],
      ["val", "invalid_syntax", "invalid_character", 3, 4],
    ],
  ],
  [
    "control character after whitespace following a value",
    "a = 1 \v",
    [["expression", "invalid_syntax", "invalid_character", 6, 7]],
  ],
  [
    "control character in array layout after a newline",
    "a = [1\n\0]",
    [
      ["array_values", "invalid_syntax", "missing_array_separator", 7, 7],
      ["val", "invalid_syntax", "invalid_character", 7, 8],
    ],
  ],
  [
    "inline table open after whitespace in a header",
    "[a {",
    [
      ["std_table", "invalid_syntax", "invalid_character", 3, 4],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 4, 4],
    ],
  ],
  [
    "control character after an invalid header character",
    "[{\0",
    [
      ["std_table", "invalid_syntax", "missing_key", 1, 1],
      ["std_table", "invalid_syntax", "invalid_character", 1, 2],
      ["std_table", "invalid_syntax", "unexpected_key", 2, 3],
      ["simple_key", "invalid_syntax", "invalid_key_character", 2, 3],
      ["std_table", "incomplete_syntax", "missing_std_table_close", 3, 3],
    ],
  ],
  [
    "four leading-zero digits at EOF await a date",
    "a=0100",
    [["val", "incomplete_syntax", "incomplete_value", 2, 6]],
  ],
  [
    "five leading-zero digits cannot become a date",
    "a=01000",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "signed leading-zero digits cannot become a date",
    "a=+07",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "space terminates leading-zero digits",
    "a=07 ",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "newline terminates leading-zero digits",
    "a=07\n",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "comment terminates leading-zero digits",
    "a=07# end",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 2, 3]],
  ],
  [
    "closing bracket terminates leading-zero digits",
    "a=[07]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4]],
  ],
  [
    "array at EOF preserves an unfinished numeric value",
    "a=[07",
    [
      ["val", "incomplete_syntax", "incomplete_value", 3, 5],
      ["array", "incomplete_syntax", "missing_array_close", 5, 5],
    ],
  ],
  [
    "inline table at EOF preserves an unfinished numeric value",
    "a={b=01",
    [
      ["val", "incomplete_syntax", "incomplete_value", 5, 7],
      ["inline_table", "incomplete_syntax", "missing_inline_table_close", 7, 7],
    ],
  ],
  [
    "array suffix stays in its expression",
    "a=[1]x",
    [["expression", "invalid_syntax", "invalid_character", 5, 6]],
  ],
  [
    "contiguous junk stays in one expression issue",
    "a=[1]junk",
    [["expression", "invalid_syntax", "invalid_character", 5, 9]],
  ],
  [
    "invalid numeric letters preserve the following digit",
    "a=1xy2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "date suffix stays in its expression",
    "a=1979-05-27x",
    [["expression", "invalid_syntax", "invalid_character", 12, 13]],
  ],
  [
    "complete boolean survives an invalid suffix",
    "a=truex",
    [["expression", "invalid_syntax", "invalid_character", 6, 7]],
  ],
  [
    "adjacent assignment after an array preserves its key",
    "a=[1]x=2",
    [["toml", "invalid_syntax", "missing_newline", 5, 5]],
  ],
  [
    "adjacent dotted assignment after a date preserves its key",
    "a=1979-05-27x.y=2",
    [["toml", "invalid_syntax", "missing_newline", 12, 12]],
  ],
  [
    "adjacent quoted assignment after a string preserves its key",
    'a="s""x"=2',
    [["toml", "invalid_syntax", "missing_newline", 5, 5]],
  ],
  [
    "adjacent assignment after an integer preserves its key",
    "a=1x=2",
    [["toml", "invalid_syntax", "missing_newline", 3, 3]],
  ],
  [
    "exponent without digits remains incomplete at EOF",
    "a=0e",
    [["exp", "incomplete_syntax", "missing_digits", 4, 4]],
  ],
  [
    "second exponent marker stays in the exponent",
    "a=0ee",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 5]],
  ],
  [
    "bad signed exponent stays in the exponent",
    "a=0e+e",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 6]],
  ],
  [
    "bad exponent stays inside an array value",
    "a=[0ee]",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 6]],
  ],
  [
    "bad exponent stays inside an inline table value",
    "a={b=0ee}",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 7, 8]],
  ],
  [
    "six closing quotes retain the longest multiline string",
    'a="""x""""""',
    [["expression", "invalid_syntax", "invalid_character", 11, 12]],
  ],
  [
    "space after a date before a stray key starts another expression",
    "a=2026-01-01 x",
    [
      ["toml", "invalid_syntax", "missing_newline", 13, 13],
      ["keyval", "incomplete_syntax", "missing_assignment_operator", 14, 14],
      ["keyval", "incomplete_syntax", "missing_value", 14, 14],
    ],
  ],
  [
    "dash before an exponent letter stays in the integer",
    "a=4-e2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "dash run after a sign keeps the exponent letter",
    "a=--e",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "digit separator before a stray equals sign stays in the number",
    "a=1_2=3",
    [
      ["val", "invalid_syntax", "invalid_character", 5, 6],
      ["expression", "invalid_syntax", "invalid_character", 6, 7],
    ],
  ],
];
for (const [name, source, expected] of [...cases, ...boundaryCases]) {
  test(`toml issues: ${name}`, () => {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, expected, result.cst);
    const edited = parse(`\n${source}`, [
      { byte: 0, deleteBytes: 1, insert: "" },
    ]);
    assert.deepEqual(edited.nodes, result.nodes);
  });
}

test("toml issues: unfinished numeric values preserve digits without assigning a date kind", () => {
  const result = parse("a=0100");
  assert.deepEqual(
    result.nodes
      .filter((node) => result.nodes[node.parent]?.kind === "incomplete_value")
      .map((node) => [node.kind, node.start, node.end]),
    [
      ["digit", 2, 3],
      ["digit", 3, 4],
      ["digit", 4, 5],
      ["digit", 5, 6],
    ],
  );
  assert.equal(
    result.nodes.some((node) => ["integer", "date_time"].includes(node.kind)),
    false,
  );
});

test("toml issues: real digits and delimiters remain inside their reason and owner", () => {
  const result = parse("a=[01,2026-13-01,12:34Z]");
  const retained = result.nodes.filter(
    (node) =>
      node.named &&
      [
        "invalid_number",
        "invalid_date_time",
        "unexpected_time_offset",
      ].includes(result.nodes[node.parent]?.kind),
  );
  assert.deepEqual(
    retained.map((node) => [
      node.kind,
      node.start,
      node.end,
      result.nodes[node.parent].kind,
    ]),
    [
      ["digit", 3, 4, "invalid_number"],
      ["digit", 11, 12, "invalid_date_time"],
      ["digit", 12, 13, "invalid_date_time"],
      ["time_offset", 22, 23, "unexpected_time_offset"],
    ],
  );
  assert.deepEqual(
    result.nodes
      .filter((node) => !node.named && ["[", "]", ","].includes(node.kind))
      .map((node) => [
        node.kind,
        result.nodes[node.parent].kind,
        node.start,
        node.end,
      ]),
    [
      ["[", "array", 2, 3],
      [",", "array_values", 5, 6],
      [",", "array_values", 16, 17],
      ["]", "array", 23, 24],
    ],
  );
});

test("toml issues: separator-only lists leave trailing layout with the container", () => {
  for (const [source, list, container] of [
    ["a=[,\n]", "array_values", "array"],
    ["a={,\n}", "inline_table_keyvals", "inline_table"],
  ]) {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, [
      [list, "invalid_syntax", "unexpected_separator", 3, 4],
    ]);
    const values = result.nodes.find((node) => node.kind === list);
    assert.deepEqual([values.start, values.end], [3, 4]);
    const newline = result.nodes.find((node) => node.kind === "newline");
    assert.equal(result.nodes[newline.parent].kind, container);
    assert.deepEqual([newline.start, newline.end], [4, 5]);
  }
});

test("toml issues: deep nesting keeps every missing closing at EOF", () => {
  const source = `a=${"[".repeat(256)}0`;
  const result = parse(source);
  assert.equal(result.hasError, false, result.cst);
  assert.equal(result.issues.length, 256);
  assert.deepEqual(
    result.issues,
    Array.from({ length: 256 }, () => [
      "array",
      "incomplete_syntax",
      "missing_array_close",
      259,
      259,
    ]),
  );
  assert.equal(
    result.nodes.filter((node) => node.kind === "array").length,
    256,
  );
  const closed = parse(source, [
    { byte: 259, deleteBytes: 0, insert: "]".repeat(256) },
  ]);
  assert.deepEqual(closed.issues, []);
  assert.deepEqual(closed.nodes, parse(source + "]".repeat(256)).nodes);
});

test("toml issues: long tokens retain every normal digit and character", () => {
  for (const [source, leaf, owner, end] of [
    [`a=${"1".repeat(4096)}_`, "digit", "unsigned_dec_int", 4099],
    [`a="${"🌿".repeat(1024)}`, "basic_unescaped", "basic_string", 4099],
  ]) {
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.equal(
      result.nodes.filter((node) => node.kind === leaf).length,
      leaf === "digit" ? 4095 : 1024,
    );
    assert.deepEqual(result.issues, [
      [
        owner,
        "incomplete_syntax",
        leaf === "digit" ? "incomplete_number" : "missing_basic_string_close",
        leaf === "digit" ? end - 1 : end,
        end,
      ],
    ]);
  }
});
