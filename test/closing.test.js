import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parse } from "./support/parser.js";

const cases = [
  [
    "inline junk and an unmatched closing form one issue",
    "a={b=1 x]}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 9]],
  ],
  [
    "junk after an unexpected value joins the unmatched closing",
    "a={[]a]}",
    [
      ["inline_table_keyvals", "invalid_syntax", "unexpected_value", 3, 5],
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 5, 7],
    ],
  ],
  [
    "junk between unmatched closings stays in one issue",
    "a={b=1]x]}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 6, 9]],
  ],
  [
    "whitespace separates junk from an unmatched closing",
    "a={b=1 x ]}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 8],
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 10],
    ],
  ],
  [
    "a comma after joined junk still separates the next keyval",
    "a={b=1 x],c=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 9]],
  ],
  [
    "junk stops before the enclosing array's closing",
    "a=[{b=1 x]",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 8, 9],
      ["inline_table", "invalid_syntax", "missing_inline_table_close", 9, 9],
    ],
  ],
  [
    "a confirmed key after an unmatched closing starts a new keyval",
    "a={b=1]c=2}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 6, 7],
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
    "spaced text after an unmatched closing stays junk",
    "a={b=1] x}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 6, 7],
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 8, 9],
    ],
  ],
  [
    "a spaced confirmed key after an unmatched closing starts a new keyval",
    "a={b=1] c=2}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 6, 7],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        8,
        8,
      ],
    ],
  ],
  [
    "a completed array does not supply an opening to a later table",
    "a=[{}]\nb={x=1]}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 13, 14]],
  ],
  [
    "a completed table does not supply an opening to a later array",
    "a={x=[]}\nb=[1}]",
    [["array_values", "invalid_syntax", "invalid_character", 13, 14]],
  ],
  [
    "a closing brace unwinds the innermost array only",
    "a=[{x=[1}]",
    [["array", "invalid_syntax", "missing_array_close", 8, 8]],
  ],
  [
    "a closing bracket unwinds the innermost table only",
    "a={x=[{y=1]}",
    [["inline_table", "invalid_syntax", "missing_inline_table_close", 10, 10]],
  ],
  [
    "a leading unmatched closing does not supply an item before a comma",
    "a={],b=1}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 3, 4],
      ["inline_table_keyvals", "invalid_syntax", "unexpected_separator", 4, 5],
    ],
  ],
  [
    "consecutive unmatched closings form one issue",
    "a=[1}}]",
    [["array_values", "invalid_syntax", "invalid_character", 4, 6]],
  ],
  [
    "a table header does not supply an array opening",
    "[x]\na={b=1]}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 10, 11]],
  ],
  [
    "an unmatched bracket stays inside the inline table",
    "a={b=1]}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 6, 7]],
  ],
  [
    "an unmatched brace stays inside the array",
    "a=[1}]",
    [["array_values", "invalid_syntax", "invalid_character", 4, 5]],
  ],
  [
    "an enclosing array closes after the table's missing brace",
    "a=[{b=1]",
    [["inline_table", "invalid_syntax", "missing_inline_table_close", 7, 7]],
  ],
  [
    "an enclosing table closes after the array's missing bracket",
    "a={b=[1}",
    [["array", "invalid_syntax", "missing_array_close", 7, 7]],
  ],
  [
    "an unmatched brace stays in the innermost array",
    "a=[[1}]]",
    [["array_values", "invalid_syntax", "invalid_character", 5, 6]],
  ],
  [
    "an unmatched bracket does not synthesize a keyval",
    "a={]}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 3, 4]],
  ],
  [
    "an unmatched brace does not synthesize a value",
    "a=[}]",
    [["array_values", "invalid_syntax", "invalid_character", 3, 4]],
  ],
  [
    "an unmatched brace after a comma preserves the following value",
    "a=[1,}2]",
    [["array_values", "invalid_syntax", "invalid_character", 5, 6]],
  ],
  [
    "an unmatched brace after a trailing comma stays inside the array",
    "a=[1,}]",
    [["array_values", "invalid_syntax", "invalid_character", 5, 6]],
  ],
  [
    "an unmatched bracket after a comma preserves the following keyval",
    "a={b=1,]c=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 8]],
  ],
  [
    "a newline after a trailing comma and an unmatched brace stays with the array",
    "a=[1,}\n]",
    [["array_values", "invalid_syntax", "invalid_character", 5, 6]],
  ],
  [
    "a comment after a trailing comma and an unmatched bracket stays with the table",
    "a={b=1,]#c\n}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 8]],
  ],
];

test("closing recovery keeps decoding failures separate from adjacent junk", () => {
  const result = parse(Buffer.from("a={b=1 x]\xff]}", "latin1"));
  assert.equal(result.hasError, false, result.cst);
  assert.deepEqual(result.issues, [
    ["inline_table_keyvals", "invalid_syntax", "invalid_character", 7, 9],
    ["inline_table_keyvals", "invalid_syntax", "invalid_encoding", 9, 10],
    ["inline_table_keyvals", "invalid_syntax", "invalid_character", 10, 11],
  ]);
});

for (const [name, source, expected] of cases) {
  test(`closing recovery: ${name}`, () => {
    const fresh = parse(source);
    assert.equal(fresh.hasError, false, fresh.cst);
    assert.deepEqual(fresh.issues, expected, fresh.cst);
    for (let byte = 0; byte < source.length; byte++) {
      const remove = { byte, deleteBytes: 1, insert: "" };
      const edited = parse(source, [remove]);
      assert.deepEqual(edited.nodes, parse(applyEdits(source, [remove])).nodes);
      const restored = parse(source, [
        remove,
        { byte, deleteBytes: 0, insert: source[byte] },
      ]);
      assert.deepEqual(restored.nodes, fresh.nodes);
    }
  });
}

test("closing recovery across 128 arrays without an outer inline table", () => {
  const source = `a=${"[".repeat(128)}1}${"]".repeat(128)}`;
  const result = parse(source);
  assert.equal(result.hasError, false, result.cst);
  assert.deepEqual(result.issues, [
    ["array_values", "invalid_syntax", "invalid_character", 131, 132],
  ]);
  assert.equal(
    result.nodes.filter((node) => node.kind === "array").length,
    128,
  );
});

test("closing recovery unwinds 128 alternating containers at an outer closing", () => {
  const source = `a=${"[{b=".repeat(128)}1${"]".repeat(128)}`;
  const result = parse(source);
  assert.equal(result.hasError, false, result.cst);
  assert.equal(
    result.nodes.filter((node) => node.kind === "array").length,
    128,
  );
  assert.deepEqual(
    result.issues,
    Array.from({ length: 128 }, (_, index) => [
      "inline_table",
      "invalid_syntax",
      "missing_inline_table_close",
      515 + index,
      515 + index,
    ]),
  );
});
