import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  assertValidHistory,
  parse,
} from "./support/parser.js";

function assertByteRestoration(source) {
  for (let byte = 0; byte < source.length; byte++) {
    const remove = { byte, deleteBytes: 1, insert: "" };
    assertIncrementalEqualsFresh(
      source,
      [remove],
      applyEdits(source, [remove]),
    );
    assertIncrementalEqualsFresh(
      source,
      [remove, { byte, deleteBytes: 0, insert: source[byte] }],
      source,
    );
  }
}

const histories = [
  {
    name: "change the year delimiter between date and decimal number",
    initial: "a = 2026\nb=1",
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: "-01-01",
        source: "a = 2026-01-01\nb=1",
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 6,
        insert: ".5",
        source: "a = 2026.5\nb=1",
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 2,
        insert: "-01-01",
        source: "a = 2026-01-01\nb=1",
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 1,
        insert: ":",
        source: "a = 2026:01-01\nb=1",
        valid: false,
      },
      {
        byte: 8,
        deleteBytes: 1,
        insert: "-",
        source: "a = 2026-01-01\nb=1",
        valid: true,
      },
    ],
  },
  {
    name: "replace a dotted key with a simple key after shared whitespace",
    initial: "a . b = 1\nz=2",
    steps: [
      {
        byte: 2,
        deleteBytes: 4,
        insert: "",
        source: "a = 1\nz=2",
        valid: true,
      },
      {
        byte: 2,
        deleteBytes: 0,
        insert: ". b ",
        source: "a . b = 1\nz=2",
        valid: true,
      },
    ],
  },

  {
    name: "break the keyval after a reused unmatched closing",
    initial: "a={b=1]yyy=2}",
    steps: [
      {
        byte: 12,
        deleteBytes: 0,
        insert: "x",
        source: "a={b=1]yyy=2x}",
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 1,
        insert: "",
        source: "a={b=1]yyy=2}",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 1,
        insert: ":",
        source: "a={b=1]yyy:2}",
        valid: false,
      },
    ],
  },
  {
    name: "replace scalar categories",
    initial: "a = true",
    steps: [
      {
        byte: 4,
        deleteBytes: 4,
        insert: "1234",
        source: "a = 1234",
        valid: true,
      },
      {
        byte: 4,
        deleteBytes: 4,
        insert: "2026-09-20",
        source: "a = 2026-09-20",
        valid: true,
      },
      {
        byte: 4,
        deleteBytes: 10,
        insert: '"x"',
        source: 'a = "x"',
        valid: true,
      },
    ],
  },
  {
    name: "type key and array from empty input",
    initial: "",
    steps: [
      {
        byte: 0,
        deleteBytes: 0,
        insert: "a = [",
        source: "a = [",
        valid: false,
      },
      {
        byte: 5,
        deleteBytes: 0,
        insert: "true,",
        source: "a = [true,",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 0,
        insert: "]",
        source: "a = [true,]",
        valid: true,
      },
    ],
  },
  {
    name: "edit another line after a date followed by a spaced stray key",
    initial: "a=2026-01-01 x\nb=1",
    steps: [
      {
        byte: 17,
        deleteBytes: 1,
        insert: "2",
        source: "a=2026-01-01 x\nb=2",
        valid: false,
      },
    ],
  },
  {
    name: "edit the integer part before a fraction glued to an assignment",
    initial: "a = 1.5e = 1",
    steps: [
      {
        byte: 4,
        deleteBytes: 1,
        insert: "2",
        source: "a = 2.5e = 1",
        valid: false,
      },
    ],
  },
  {
    name: "remove the assignment glued to a number in an inline table",
    initial: ":{t +0a=",
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: " ",
        source: ":{t +0a= ",
        valid: false,
      },
      { byte: 7, deleteBytes: 2, insert: "", source: ":{t +0a", valid: false },
    ],
  },
  {
    name: "edit the integer before rejected junk that ends at a glued key",
    initial: "a=1x..y=2",
    steps: [
      {
        byte: 2,
        deleteBytes: 0,
        insert: "1",
        source: "a=11x..y=2",
        valid: false,
      },
    ],
  },
  {
    name: "edit a fraction before word junk, then break the key glued to it",
    initial: "a=1.5x?e5=1",
    steps: [
      {
        byte: 5,
        deleteBytes: 0,
        insert: "0",
        source: "a=1.50x?e5=1",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 1,
        insert: "}",
        source: "a=1.50x?e5}1",
        valid: false,
      },
    ],
  },
  {
    name: "edit after a glued inline key, then break the key",
    initial: '={x y =""_. e = .c\n',
    steps: [
      {
        byte: 15,
        deleteBytes: 2,
        insert: "{",
        source: '={x y =""_. e ={c\n',
        valid: false,
      },
      {
        byte: 16,
        deleteBytes: 2,
        insert: "",
        source: '={x y =""_. e ={',
        valid: false,
      },
      {
        byte: 11,
        deleteBytes: 3,
        insert: "=1",
        source: '={x y =""_.=1={',
        valid: false,
      },
    ],
  },
  ...["Z", "-"].map((offset) => ({
    name: `edit an inline key, then break the key glued to time offset ${offset}`,
    initial: `a={b=1,c=07:32${offset} .y=`,
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: "k",
        source: `a={b=1,ck=07:32${offset} .y=`,
        valid: false,
      },
      {
        byte: 19,
        deleteBytes: 0,
        insert: "?",
        source: `a={b=1,ck=07:32${offset} .y?=`,
        valid: false,
      },
    ],
  })),
  {
    name: "insert trailing array comment and remove comma",
    initial: "a = [true,]",
    steps: [
      {
        byte: 10,
        deleteBytes: 0,
        insert: "# tail\n",
        source: "a = [true,# tail\n]",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "a = [true# tail\n]",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 0,
        insert: ",",
        source: "a = [true,# tail\n]",
        valid: true,
      },
    ],
  },
  {
    name: "move trailing array layout between array and values",
    initial: "a = [true ]",
    steps: [
      {
        byte: 9,
        deleteBytes: 0,
        insert: ",",
        source: "a = [true, ]",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "a = [true ]",
        valid: true,
      },
      {
        byte: 10,
        deleteBytes: 0,
        insert: ",",
        source: "a = [true ,]",
        valid: true,
      },
    ],
  },
  {
    name: "move trailing inline table layout by inserting a comma",
    initial: "a = {b = 1 }",
    steps: [
      {
        byte: 11,
        deleteBytes: 0,
        insert: ",",
        source: "a = {b = 1 ,}",
        valid: true,
      },
      {
        byte: 11,
        deleteBytes: 1,
        insert: "",
        source: "a = {b = 1 }",
        valid: true,
      },
    ],
  },
  {
    name: "edit line ending without losing statement boundary",
    initial: "a = true\nb = false",
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: "\r",
        source: "a = true\r\nb = false",
        valid: true,
      },
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "a = true\rb = false",
        valid: false,
      },
      {
        byte: 9,
        deleteBytes: 0,
        insert: "\n",
        source: "a = true\r\nb = false",
        valid: true,
      },
    ],
  },
  {
    name: "replace Unicode string content by byte range",
    initial: 'a = "🌿"',
    steps: [
      {
        byte: 5,
        deleteBytes: 4,
        insert: "日本",
        source: 'a = "日本"',
        valid: true,
      },
      {
        byte: 11,
        deleteBytes: 1,
        insert: "",
        source: 'a = "日本',
        valid: false,
      },
      {
        byte: 11,
        deleteBytes: 0,
        insert: '"',
        source: 'a = "日本"',
        valid: true,
      },
    ],
  },
  {
    name: "delete a quote after a key that follows rejected fraction junk",
    initial: '=.1_.5 x="',
    steps: [
      {
        byte: 9,
        deleteBytes: 1,
        insert: "",
        source: "=.1_.5 x=",
        valid: false,
      },
    ],
  },
  {
    name: "insert an invalid numeric suffix inside an unclosed array",
    initial: "a=[1 ",
    steps: [
      { byte: 4, deleteBytes: 0, insert: "a", source: "a=[1a ", valid: false },
      { byte: 4, deleteBytes: 1, insert: "", source: "a=[1 ", valid: false },
      { byte: 5, deleteBytes: 0, insert: "]", source: "a=[1 ]", valid: true },
    ],
  },
  {
    name: "extend date with time and restore separator",
    initial: "a = 2026-09-20",
    steps: [
      {
        byte: 14,
        deleteBytes: 0,
        insert: " 07:32",
        source: "a = 2026-09-20 07:32",
        valid: true,
      },
      {
        byte: 14,
        deleteBytes: 1,
        insert: "\t",
        source: "a = 2026-09-20\t07:32",
        valid: false,
      },
      {
        byte: 14,
        deleteBytes: 1,
        insert: "T",
        source: "a = 2026-09-20T07:32",
        valid: true,
      },
    ],
  },
  {
    name: "cross month bounds and restore a valid date",
    initial: "a = 2026-12-01",
    steps: [
      {
        byte: 9,
        deleteBytes: 2,
        insert: "13",
        source: "a = 2026-13-01",
        valid: false,
      },
      {
        byte: 9,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-00-01",
        valid: false,
      },
      {
        byte: 9,
        deleteBytes: 2,
        insert: "01",
        source: "a = 2026-01-01",
        valid: true,
      },
    ],
  },
  {
    name: "cross day bounds and restore a valid date",
    initial: "a = 2026-01-31",
    steps: [
      {
        byte: 12,
        deleteBytes: 2,
        insert: "32",
        source: "a = 2026-01-32",
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-01-00",
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 2,
        insert: "01",
        source: "a = 2026-01-01",
        valid: true,
      },
    ],
  },
  {
    name: "cross time element bounds and restore a valid time",
    initial: "a = 23:59:60",
    steps: [
      {
        byte: 4,
        deleteBytes: 2,
        insert: "24",
        source: "a = 24:59:60",
        valid: false,
      },
      {
        byte: 4,
        deleteBytes: 2,
        insert: "00",
        source: "a = 00:59:60",
        valid: true,
      },
      {
        byte: 7,
        deleteBytes: 2,
        insert: "60",
        source: "a = 00:60:60",
        valid: false,
      },
      {
        byte: 7,
        deleteBytes: 2,
        insert: "00",
        source: "a = 00:00:60",
        valid: true,
      },
      {
        byte: 10,
        deleteBytes: 2,
        insert: "61",
        source: "a = 00:00:61",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 2,
        insert: "00",
        source: "a = 00:00:00",
        valid: true,
      },
    ],
  },
  {
    name: "cross offset bounds and restore a valid date-time",
    initial: "a = 2026-01-01T00:00+23:59",
    steps: [
      {
        byte: 21,
        deleteBytes: 2,
        insert: "24",
        source: "a = 2026-01-01T00:00+24:59",
        valid: false,
      },
      {
        byte: 21,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-01-01T00:00+00:59",
        valid: true,
      },
      {
        byte: 24,
        deleteBytes: 2,
        insert: "60",
        source: "a = 2026-01-01T00:00+00:60",
        valid: false,
      },
      {
        byte: 24,
        deleteBytes: 2,
        insert: "00",
        source: "a = 2026-01-01T00:00+00:00",
        valid: true,
      },
    ],
  },
  {
    name: "edit whitespace before dotted key separator",
    initial: "a.b = true",
    steps: [
      {
        byte: 1,
        deleteBytes: 0,
        insert: " \t",
        source: "a \t.b = true",
        valid: true,
      },
      {
        byte: 3,
        deleteBytes: 1,
        insert: "",
        source: "a \tb = true",
        valid: false,
      },
      {
        byte: 3,
        deleteBytes: 0,
        insert: ".",
        source: "a \t.b = true",
        valid: true,
      },
    ],
  },
  {
    name: "extend multiline closing quote run",
    initial: 'a = """x"""',
    steps: [
      {
        byte: 8,
        deleteBytes: 0,
        insert: '"',
        source: 'a = """x""""',
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 0,
        insert: '"',
        source: 'a = """x"""""',
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 0,
        insert: '"',
        source: 'a = """x""""""',
        valid: false,
      },
      {
        byte: 8,
        deleteBytes: 1,
        insert: "",
        source: 'a = """x"""""',
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 2,
        insert: "",
        source: 'a = """x"""',
        valid: true,
      },
    ],
  },
  {
    name: "restore multiline literal closing delimiter",
    initial: "a = '''x'''",
    steps: [
      {
        byte: 8,
        deleteBytes: 1,
        insert: "",
        source: "a = '''x''",
        valid: false,
      },
      {
        byte: 8,
        deleteBytes: 0,
        insert: "''",
        source: "a = '''x''''",
        valid: true,
      },
      {
        byte: 8,
        deleteBytes: 1,
        insert: "",
        source: "a = '''x'''",
        valid: true,
      },
    ],
  },
  {
    name: "change multiline string kind",
    initial: 'a = """x\ny"""',
    steps: [
      {
        byte: 4,
        deleteBytes: 3,
        insert: "'''",
        source: "a = '''x\ny\"\"\"",
        valid: false,
      },
      {
        byte: 10,
        deleteBytes: 3,
        insert: "'''",
        source: "a = '''x\ny'''",
        valid: true,
      },
    ],
  },
  {
    name: "restore inline table after incomplete comment",
    initial: "a = {b = true,}",
    steps: [
      {
        byte: 14,
        deleteBytes: 1,
        insert: "# tail",
        source: "a = {b = true,# tail",
        valid: false,
      },
      {
        byte: 20,
        deleteBytes: 0,
        insert: "\n}",
        source: "a = {b = true,# tail\n}",
        valid: true,
      },
    ],
  },
  {
    name: "change table header kind",
    initial: "[a]\nx = true",
    steps: [
      {
        byte: 0,
        deleteBytes: 0,
        insert: "[",
        source: "[[a]\nx = true",
        valid: false,
      },
      {
        byte: 4,
        deleteBytes: 0,
        insert: "]",
        source: "[[a]]\nx = true",
        valid: true,
      },
    ],
  },
  {
    name: "recover a suffix into an adjacent assignment and restore it",
    initial: "a=[1]",
    steps: [
      { byte: 5, deleteBytes: 0, insert: "x", source: "a=[1]x", valid: false },
      {
        byte: 6,
        deleteBytes: 0,
        insert: "=2",
        source: "a=[1]x=2",
        valid: false,
      },
      {
        byte: 5,
        deleteBytes: 0,
        insert: "\n",
        source: "a=[1]\nx=2",
        valid: true,
      },
      { byte: 5, deleteBytes: 1, insert: "", source: "a=[1]x=2", valid: false },
      { byte: 6, deleteBytes: 2, insert: "", source: "a=[1]x", valid: false },
      { byte: 5, deleteBytes: 1, insert: "", source: "a=[1]", valid: true },
    ],
  },
  {
    name: "repair and restore malformed exponent digits",
    initial: "a=0e",
    steps: [
      { byte: 4, deleteBytes: 0, insert: "e", source: "a=0ee", valid: false },
      { byte: 4, deleteBytes: 1, insert: "5", source: "a=0e5", valid: true },
      { byte: 4, deleteBytes: 1, insert: "", source: "a=0e", valid: false },
    ],
  },
  {
    name: "complete and break a time after a date and a space",
    initial: "a=2026-01-01 0x:32",
    steps: [
      {
        byte: 14,
        deleteBytes: 1,
        insert: "7",
        source: "a=2026-01-01 07:32",
        valid: true,
      },
      {
        byte: 14,
        deleteBytes: 1,
        insert: "x",
        source: "a=2026-01-01 0x:32",
        valid: false,
      },
    ],
  },
  {
    name: "extend and restore the longest multiline closing prefix",
    initial: 'a="""x"""""',
    steps: [
      {
        byte: 11,
        deleteBytes: 0,
        insert: '"',
        source: 'a="""x""""""',
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 0,
        insert: '"=2',
        source: 'a="""x"""""""=2',
        valid: false,
      },
      {
        byte: 12,
        deleteBytes: 3,
        insert: "",
        source: 'a="""x""""""',
        valid: false,
      },
      {
        byte: 11,
        deleteBytes: 1,
        insert: "",
        source: 'a="""x"""""',
        valid: true,
      },
    ],
  },
];

for (const { name, initial, steps } of histories) {
  test(`toml: ${name}`, () => {
    assertValidHistory(initial, steps);
  });
}

test("toml: an edit after a finished date-time or junk run reuses the following lines", () => {
  const lineCount = 40;
  const editedLine = lineCount / 2;
  const lexedTokenLimit = 100;
  for (const { line, column, deleteBytes, insert } of [
    ...[
      "a = 1979-05-27T07:32:00Z",
      "a = 1979-05-27 07:32:00z # c",
      "a = 1979-05-27 x",
      "a = 1 x # c",
      "a = true=2",
      "a = 1.5e",
      "a = 1x.",
      "a = 1__2",
      "a = 1.5x?e5",
      "a = 0b102",
    ].map((line) => ({ line, column: 0, deleteBytes: 0, insert: "b" })),
    {
      line: "a = 1x?key=2",
      column: Buffer.byteLength("a = 1x?"),
      deleteBytes: 1,
      insert: "x",
    },
  ]) {
    const source = `${line}\n`.repeat(lineCount);
    const edits = [
      {
        byte: Buffer.byteLength(`${line}\n`) * editedLine + column,
        deleteBytes,
        insert,
      },
    ];
    const incremental = parse(source, edits, { lexes: true });
    assert.deepEqual(
      incremental.nodes,
      parse(applyEdits(source, edits)).nodes,
      line,
    );
    assert.ok(
      incremental.lexes < lexedTokenLimit,
      `${line}: ${incremental.lexes} tokens lexed after the edit`,
    );
  }
});

test("toml: a local edit reuses surrounding valid lines", () => {
  const lineCounts = [40, 1000];
  const lexedTokenLimit = 100;
  for (const lineCount of lineCounts) {
    for (const { line, column } of [
      { line: "a=1979-05-27T07:32:00Z", column: 0 },
      { line: "a=[1,2]", column: 0 },
      { line: "a={b=true}", column: 0 },
      { line: "a=1234", column: 3 },
      { line: "a = 1234", column: 5 },
      { line: "a . b = 1234", column: 9 },
      { line: "a = 12.34e+5", column: 5 },
      { line: "a = 1979-05-27T07:32:00Z", column: 7 },
      { line: "a=07:32", column: 6 },
      { line: "a=[12,34]", column: 4 },
      { line: "a={b=123}", column: 7 },
      { line: 'a="abc"', column: 4 },
    ]) {
      const source = `${line}\n`.repeat(lineCount);
      const edits = [
        {
          byte: (line.length + 1) * (lineCount / 2) + column,
          deleteBytes: 1,
          insert: column === 0 ? "b" : "9",
        },
      ];
      const tree = parse(source, edits, { lexes: true });
      const fresh = parse(applyEdits(source, edits));
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.nodes, fresh.nodes);
      assert.ok(
        tree.lexes < lexedTokenLimit,
        `${lineCount} lines of ${line}: ${tree.lexes} lexes`,
      );
    }
  }
});

const restorationSources = [
  [
    "restore date and numeric boundaries with CRLF and collection comments",
    'a . "b" = 2026-01-01\r\nc = 07:32\r\nd = [1234, # date\r\n2026-01-01]\r\n',
  ],
  [
    "restore every character around unmatched and enclosing closing delimiters",
    "a=[1}]\nb={c=1]}\nd=[{e=1]\nf={g=[2}",
  ],
  [
    "restore every character around collection comments",
    "a = [true, # tail\n]\nb = {c = false, # tail\n}",
  ],
  [
    "restore every character around date and dotted key layout",
    'a . "b" = [2026-09-20 , 2026-09-20 07:32Z ]',
  ],
  [
    "restore every character around basic multiline delimiters",
    'a = """\nx\\ \n y"""""\nb = true',
  ],
  [
    "restore every character around literal multiline delimiters",
    "a = '''\nx''y'''''\nb = true",
  ],
  [
    "restore every character around Unicode and CRLF",
    '["日本"]\r\na = "🌿\\xFF"\r\n',
  ],
  [
    "restore exponent after reusing a fractional subtree",
    "a = -12.3_4e+0_2\nb = 1E-02\nc = 0.5",
  ],
  [
    "restore every character around value suffixes and recovered assignments",
    "a=true=2\nb={c=1 ;d=2 .e=3}\nf=0_",
  ],
  [
    "restore every character around missing dotted segments and invalid numeric runs",
    "a=1 x..y=2\nb={c=truex.=2}\nd=1?=2",
  ],
];

for (const [name, source] of restorationSources) {
  test(`toml: ${name}`, () => {
    const fresh = parse(source);
    assert.equal(fresh.hasError, false, fresh.cst);
    let byte = 0;
    for (const character of source) {
      const deleteBytes = Buffer.byteLength(character);
      const restored = assertEditHistory({
        source,
        edits: [
          { byte, deleteBytes, insert: "" },
          { byte, deleteBytes: 0, insert: character },
        ],
      });
      assert.equal(
        restored.cst,
        fresh.cst,
        `restoring byte ${byte} must restore the original CST`,
      );
      byte += deleteBytes;
    }
  });
}

test("toml: fixed-seed generated histories preserve every intermediate source structure", () => {
  const seed = 0x6e34ab19;
  const sampleCount = 12;
  const deletionCount = 5;
  const maxDeletedCharacters = 4;
  const lcgMultiplier = 1664525;
  const lcgIncrement = 1013904223;
  let state = seed;
  const next = (maximum) => {
    state = (Math.imul(state, lcgMultiplier) + lcgIncrement) >>> 0;
    return state % maximum;
  };
  for (const [, source] of restorationSources) {
    const fresh = parse(source);
    assert.equal(fresh.hasError, false, fresh.cst);
    for (let sample = 0; sample < sampleCount; sample++) {
      state = (seed + sample) >>> 0;
      const characters = [...source];
      const edits = [];
      const restores = [];
      for (
        let step = 0;
        step < deletionCount && characters.length > 0;
        step++
      ) {
        const start = next(characters.length);
        const count =
          1 + next(Math.min(maxDeletedCharacters, characters.length - start));
        const byte = Buffer.byteLength(characters.slice(0, start).join(""));
        const removed = characters.splice(start, count).join("");
        edits.push({
          byte,
          deleteBytes: Buffer.byteLength(removed),
          insert: "",
        });
        restores.unshift({ byte, deleteBytes: 0, insert: removed });
      }
      const history = [...edits, ...restores];
      try {
        const restored = assertEditHistory({ source, edits: history });
        assert.equal(
          restored.cst,
          fresh.cst,
          "restoring all deletions must restore the original CST",
        );
      } catch (error) {
        throw new Error(
          JSON.stringify({ seed, sample, source, edits, restores }),
          {
            cause: error,
          },
        );
      }
    }
  }
});

test("toml: fixed-seed generated histories with insertions preserve issue recovery", () => {
  const seed = 0x9e3779b9;
  const sampleCount = 12;
  const editCount = 8;
  const maxDeletedBytes = 3;
  const operationChoiceCount = 3;
  const shifts = { left: 13, right: 17, final: 5 };
  let state = seed;
  const next = (limit) => {
    state ^= state << shifts.left;
    state ^= state >>> shifts.right;
    state ^= state << shifts.final;
    return (state >>> 0) % limit;
  };
  const inserts = [
    " ",
    "\n",
    "\r",
    "\t",
    ",",
    "_",
    "[",
    "]",
    "{",
    "}",
    "'",
    '"',
    "+",
    "-",
    "0",
    "1",
    ":",
    ".",
    "#",
    "=",
    "\\",
    "t",
    "e",
    "a",
  ];
  for (const source of [
    "a=[1,\n2]",
    "a={b=1,\n2=3}",
    "a=2026-01-01T12:34:56.12+01:00",
    'a=["x",0x1]',
    "a={b=[1],c={d=2}}",
    '[["a".b]]\nx=true\n',
  ]) {
    for (let sample = 0; sample < sampleCount; sample++) {
      state = (seed + sample) >>> 0;
      let current = source;
      const edits = [];
      for (let step = 0; step < editCount; step++) {
        const byte = next(current.length + 1);
        const deleteBytes =
          next(operationChoiceCount) === 0
            ? 0
            : Math.min(1 + next(maxDeletedBytes), current.length - byte);
        const insert =
          deleteBytes && next(operationChoiceCount) === 0
            ? ""
            : inserts[next(inserts.length)];
        edits.push({ byte, deleteBytes, insert });
        current = applyEdits(current, [edits.at(-1)]).toString();
        try {
          assertIncrementalEqualsFresh(source, edits, current);
        } catch (error) {
          throw new Error(
            JSON.stringify({ seed, sample, source, edits, current }),
            {
              cause: error,
            },
          );
        }
      }
    }
  }
});

test("toml: edits across junk, assignment, and datetime boundaries match fresh parses", () => {
  for (const source of [
    "a=1x2x3",
    "a=1x2e3x4",
    "a=1x2.x4",
    "a=1.2x3e4x5e6",
    "a=truex.x.x",
    "a=1979-05-27T",
    "a=07:32Z",
    "a=0x_g2h",
    "a=1.2_x3e4",
    "a=1x?key=2",
    "a=1.5x?e5",
    "a={b=truex}",
    "a={b=1x?e=2}",
  ]) {
    const valueStartByte = Buffer.byteLength("a=");
    for (let byte = valueStartByte; byte <= source.length; byte++) {
      for (const insert of ["=1", " ", "\n"]) {
        assertEditHistory({
          source,
          edits: [
            { byte, deleteBytes: 0, insert },
            { byte, deleteBytes: Buffer.byteLength(insert), insert: "" },
          ],
        });
      }
    }
  }
});

const lookaheadByteEdits = [
  {
    name: "two-byte character after an integer",
    source: "a=1 é\n",
    byte: 5,
    expected: Buffer.concat([
      Buffer.from("a=1 "),
      Buffer.from([0xc3]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 4, 5]],
  },
  {
    name: "two-byte character after a date",
    source: "a=2020-01-01 é\n",
    byte: 14,
    expected: Buffer.concat([
      Buffer.from("a=2020-01-01 "),
      Buffer.from([0xc3]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 13, 14]],
  },
  {
    name: "three-byte character after an array",
    source: "a=[] あ\n",
    byte: 7,
    expected: Buffer.concat([
      Buffer.from("a=[] "),
      Buffer.from([0xe3, 0x81]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 5, 7]],
  },
  {
    name: "four-byte character after a string",
    source: 'a="x" 😀\n',
    byte: 9,
    expected: Buffer.concat([
      Buffer.from('a="x" '),
      Buffer.from([0xf0, 0x9f, 0x98]),
      Buffer.from("\n"),
    ]),
    issues: [["expression", "invalid_syntax", "invalid_encoding", 6, 9]],
  },
];

for (const { name, source, byte, expected, issues } of lookaheadByteEdits) {
  test(`toml: deleting the final byte of a ${name} preserves fresh parsing`, () => {
    const edits = [{ byte, deleteBytes: 1, insert: "" }];
    assert.deepEqual(applyEdits(source, edits), expected);
    const result = assertIncrementalEqualsFresh(source, edits, expected);
    assert.deepEqual(result.issues, issues);
  });
}

for (const { name, source, edits } of [
  {
    name: "merge a decoding run after splitting a Unicode character",
    source: Buffer.from([97, 61, 34, 255, 195, 169, 34]),
    edits: [{ byte: 5, deleteBytes: 1, insert: "" }],
  },
  {
    name: "repair a decoding run after a backslash",
    source: Buffer.from([97, 61, 34, 92, 255, 254, 128, 34]),
    edits: [{ byte: 4, deleteBytes: 3, insert: "n" }],
  },
]) {
  test(`toml: ${name}`, () => {
    assertEditHistory({ source, edits });
  });
}

for (const { name, source, edits } of [
  {
    name: "change a scalar escape to a surrogate and restore it",
    source: String.raw`a="\uD7FF"`,
    edits: [
      { byte: 5, deleteBytes: 4, insert: "D800" },
      { byte: 5, deleteBytes: 4, insert: "D7FF" },
    ],
  },
  {
    name: "complete an impossible scalar prefix",
    source: String.raw`a="\U1`,
    edits: [{ byte: 6, deleteBytes: 0, insert: '0000000"' }],
  },
]) {
  test(`toml: ${name}`, () => {
    assertEditHistory({ source, edits });
  });
}

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
  ["a=1-2.5", " = 3"],
  ['a="""x"""""', '"'],
]) {
  test(`toml issues: append and remove ${JSON.stringify(insert)} at ${JSON.stringify(initial)}`, () => {
    const byte = Buffer.byteLength(initial);
    const edits = [{ byte, deleteBytes: 0, insert }];
    assertIncrementalEqualsFresh(initial, edits, initial + insert);
    edits.push({ byte, deleteBytes: Buffer.byteLength(insert), insert: "" });
    assertIncrementalEqualsFresh(initial, edits, initial);
  });
}

test("toml: edits to spaced dotted junk invalidate failed key lookahead", () => {
  for (const prefix of ["a=true", "a=1?", "a=1x?", "a={b=true", "a={b=1x?"]) {
    const initial = `${prefix}x .x .x`;
    const completed = `${initial}=2`;
    assertIncrementalEqualsFresh(
      initial,
      [{ byte: Buffer.byteLength(initial), deleteBytes: 0, insert: "=2" }],
      completed,
    );
    assertIncrementalEqualsFresh(
      completed,
      [
        {
          byte: Buffer.byteLength(initial),
          deleteBytes: Buffer.byteLength("=2"),
          insert: "",
        },
      ],
      initial,
    );
  }
});

for (const [name, source] of [
  ["a spaced standard header follows a completed value", "a=1 [b]"],
  ["an adjacent standard header follows a completed value", "a=1[b]"],
  ["a spaced array table header follows a completed value", "a=true [[b]]"],
  ["an adjacent array table header follows a completed value", "a=true[[b]]"],
  ["an empty header follows a completed array", "a=[][]"],
  ["an unfinished header follows a completed value", "a=1 [b"],
  ["a header opening alone follows a completed value", "a=1 ["],
  ["a bracket inside an array starts another array value", "a=[1 [2]]"],
  [
    "a bracket inside an inline table retains an unexpected array value",
    "a={b=1 [2]}",
  ],
]) {
  test(`toml header recovery: ${name}`, () => {
    assertByteRestoration(source);
  });
}

for (const [name, source] of [
  ["inline junk and an unmatched closing form one issue", "a={b=1 x]}"],
  ["junk after an unexpected value joins the unmatched closing", "a={[]a]}"],
  ["junk between unmatched closings stays in one issue", "a={b=1]x]}"],
  ["whitespace separates junk from an unmatched closing", "a={b=1 x ]}"],
  [
    "a comma after joined junk still separates the next keyval",
    "a={b=1 x],c=2}",
  ],
  ["junk stops before the enclosing array's closing", "a=[{b=1 x]"],
  [
    "a confirmed key after an unmatched closing starts a new keyval",
    "a={b=1]c=2}",
  ],
  ["spaced text after an unmatched closing stays junk", "a={b=1] x}"],
  [
    "a spaced confirmed key after an unmatched closing starts a new keyval",
    "a={b=1] c=2}",
  ],
  [
    "a completed array does not supply an opening to a later table",
    "a=[{}]\nb={x=1]}",
  ],
  [
    "a completed table does not supply an opening to a later array",
    "a={x=[]}\nb=[1}]",
  ],
  ["a closing brace unwinds the innermost array only", "a=[{x=[1}]"],
  ["a closing bracket unwinds the innermost table only", "a={x=[{y=1]}"],
  [
    "a leading unmatched closing does not supply an item before a comma",
    "a={],b=1}",
  ],
  ["consecutive unmatched closings form one issue", "a=[1}}]"],
  ["a table header does not supply an array opening", "[x]\na={b=1]}"],
  ["an unmatched bracket stays inside the inline table", "a={b=1]}"],
  ["an unmatched brace stays inside the array", "a=[1}]"],
  ["an enclosing array closes after the table's missing brace", "a=[{b=1]"],
  ["an enclosing table closes after the array's missing bracket", "a={b=[1}"],
  ["an unmatched brace stays in the innermost array", "a=[[1}]]"],
  ["an unmatched bracket does not synthesize a keyval", "a={]}"],
  ["an unmatched brace does not synthesize a value", "a=[}]"],
  [
    "an unmatched brace after a comma preserves the following value",
    "a=[1,}2]",
  ],
  [
    "an unmatched brace after a trailing comma stays inside the array",
    "a=[1,}]",
  ],
  [
    "an unmatched bracket after a comma preserves the following keyval",
    "a={b=1,]c=2}",
  ],
  [
    "a newline after a trailing comma and an unmatched brace stays with the array",
    "a=[1,}\n]",
  ],
  [
    "a comment after a trailing comma and an unmatched bracket stays with the table",
    "a={b=1,]#c\n}",
  ],
]) {
  test(`closing recovery edits: ${name}`, () => {
    assertByteRestoration(source);
  });
}

test("toml issues: editing a normal key character splits and rejoins an invalid run", () => {
  const initial = "a@@b=1";
  const edits = [{ byte: 2, deleteBytes: 0, insert: "c" }];
  const split = assertIncrementalEqualsFresh(initial, edits, "a@c@b=1");
  assert.deepEqual(split.issues, [
    ["simple_key", "invalid_syntax", "invalid_key_character", 1, 2],
    ["simple_key", "invalid_syntax", "invalid_key_character", 3, 4],
  ]);
  edits.push({ byte: 2, deleteBytes: 1, insert: "" });
  const joined = assertIncrementalEqualsFresh(initial, edits, initial);
  assert.deepEqual(joined.issues, [
    ["simple_key", "invalid_syntax", "invalid_key_character", 1, 3],
  ]);
});
