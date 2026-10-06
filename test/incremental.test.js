import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parse } from "./support/parser.js";

const histories = [
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
];

for (const { name, initial, steps } of histories) {
  test(`toml: ${name}`, () => {
    let source = Buffer.from(initial);
    const edits = [];
    for (const {
      byte,
      deleteBytes,
      insert,
      source: expected,
      valid,
    } of steps) {
      const edit = { byte, deleteBytes, insert };
      source = applyEdits(source, [edit]);
      assert.equal(
        source.toString(),
        expected,
        "edit fixture must produce the explicit expected input",
      );
      edits.push(edit);
      const incremental = parse(initial, edits);
      assert.equal(incremental.hasError, false, incremental.cst);
      assert.equal(incremental.issues.length === 0, valid, incremental.cst);
      const fresh = parse(expected);
      assert.deepEqual(incremental.nodes, fresh.nodes, expected);
    }
  });
}

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
    const fresh = parse(expected);
    assert.equal(fresh.hasError, false, fresh.cst);
    assert.deepEqual(fresh.issues, issues);
    const incremental = parse(source, edits);
    assert.equal(incremental.hasError, false, incremental.cst);
    assert.deepEqual(incremental.issues, issues);
    assert.deepEqual(incremental.nodes, fresh.nodes);
  });
}

const restorationSources = [
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
];

for (const [name, source] of restorationSources) {
  test(`toml: ${name}`, () => {
    const fresh = parse(source);
    assert.equal(fresh.hasError, false, fresh.cst);
    let position = 0;
    for (const character of source) {
      const length = Buffer.byteLength(character);
      const removed = applyEdits(source, [
        { byte: position, deleteBytes: length, insert: "" },
      ]);
      assert.deepEqual(
        parse(source, [{ byte: position, deleteBytes: length, insert: "" }])
          .nodes,
        parse(removed).nodes,
        `deleting byte ${position}`,
      );
      const restored = parse(source, [
        { byte: position, deleteBytes: length, insert: "" },
        { byte: position, deleteBytes: 0, insert: character },
      ]);
      assert.equal(restored.hasError, false, `${position}\n${restored.cst}`);
      assert.equal(
        restored.cst,
        fresh.cst,
        `restoring byte ${position} must restore the original CST`,
      );
      position += length;
    }
  });
}

test("toml: fixed-seed generated histories preserve every intermediate source structure", () => {
  let state = 0x6e34ab19;
  const next = (maximum) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
  for (const [, source] of restorationSources) {
    const fresh = parse(source);
    assert.equal(fresh.hasError, false, fresh.cst);
    for (let sample = 0; sample < 12; sample++) {
      const characters = [...source];
      const edits = [];
      const restores = [];
      for (let step = 0; step < 5 && characters.length > 0; step++) {
        const start = next(characters.length);
        const count = 1 + next(Math.min(4, characters.length - start));
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
      for (let count = 1; count <= history.length; count++) {
        const prefix = history.slice(0, count);
        const current = applyEdits(source, prefix);
        const description = JSON.stringify({
          seed: "0x6e34ab19",
          source,
          prefix,
        });
        try {
          assert.deepEqual(
            parse(source, prefix).nodes,
            parse(current).nodes,
            description,
          );
        } catch (error) {
          throw new Error(description, { cause: error });
        }
      }
      const restored = parse(source, history);
      const description = JSON.stringify({ source, edits, restores });
      assert.equal(restored.hasError, false, description);
      assert.equal(restored.cst, fresh.cst, description);
    }
  }
});

test("toml: fixed-seed generated histories with insertions preserve issue recovery", () => {
  let state = 0x9e3779b9;
  const next = (limit) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
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
    for (let sample = 0; sample < 12; sample++) {
      let current = source;
      const edits = [];
      for (let step = 0; step < 8; step++) {
        const byte = next(current.length + 1);
        const deleteBytes =
          next(3) === 0 ? 0 : Math.min(1 + next(3), current.length - byte);
        const insert =
          deleteBytes && next(3) === 0 ? "" : inserts[next(inserts.length)];
        edits.push({ byte, deleteBytes, insert });
        current = applyEdits(current, [edits.at(-1)]).toString();
        const description = JSON.stringify({
          seed: "0x9e3779b9",
          source,
          edits,
          current,
        });
        const fresh = parse(current);
        const incremental = parse(source, edits);
        assert.equal(fresh.hasError, false, `${description}\n${fresh.cst}`);
        assert.equal(
          incremental.hasError,
          false,
          `${description}\n${incremental.cst}`,
        );
        assert.deepEqual(incremental.nodes, fresh.nodes, description);
      }
    }
  }
});

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
    for (let count = 1; count <= edits.length; count++) {
      const history = edits.slice(0, count);
      const result = parse(source, history);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.nodes, parse(applyEdits(source, history)).nodes);
    }
  });
}

const cases = [
  [
    "adjacent forbidden bare key characters form one issue",
    "a@@b=1",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 3]],
  ],
  [
    "different forbidden bare key characters share their cause",
    "a\u0001@b=1",
    [["simple_key", "invalid_syntax", "invalid_key_character", 1, 3]],
  ],
  [
    "normal bare key characters separate issues",
    "a@b@c=1",
    [
      ["simple_key", "invalid_syntax", "invalid_key_character", 1, 2],
      ["simple_key", "invalid_syntax", "invalid_key_character", 3, 4],
    ],
  ],
  [
    "adjacent forbidden string characters form one issue",
    'a="x\u0001\u0002y"',
    [["basic_string", "invalid_syntax", "invalid_character", 4, 6]],
  ],
  [
    "adjacent forbidden comment characters form one issue",
    "# x\u0001\u0002y",
    [["comment", "invalid_syntax", "invalid_character", 3, 5]],
  ],
  [
    "numeric violations stop before normal digits",
    "a=1?!2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "numeric violations stop before the exponent",
    "a=1??e2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "numeric violations stop before the fraction",
    "a=1??.2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "repeated digit separators cannot be completed at EOF",
    "a=1__",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "repeated digit separators retain the valid trailing separator",
    "a=1___2",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "repeated leading digit separators form one issue",
    "a=0x__1",
    [["hex_int", "invalid_syntax", "invalid_number", 4, 6]],
  ],
  [
    "adjacent escapes remain independent",
    'a="\\q\\z"',
    [
      ["basic_string", "invalid_syntax", "invalid_escape", 3, 5],
      ["basic_string", "invalid_syntax", "invalid_escape", 5, 7],
    ],
  ],
  [
    "adjacent separators remain independent",
    "a=[1,,,2]",
    [
      ["array_values", "invalid_syntax", "unexpected_separator", 5, 6],
      ["array_values", "invalid_syntax", "unexpected_separator", 6, 7],
    ],
  ],
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
test("toml issues: editing a normal key character splits and rejoins an invalid run", () => {
  const initial = "a@@b=1";
  const edits = [{ byte: 2, deleteBytes: 0, insert: "c" }];
  const split = parse(initial, edits);
  assert.deepEqual(split.issues, [
    ["simple_key", "invalid_syntax", "invalid_key_character", 1, 2],
    ["simple_key", "invalid_syntax", "invalid_key_character", 3, 4],
  ]);
  assert.deepEqual(split.nodes, parse("a@c@b=1").nodes);
  edits.push({ byte: 2, deleteBytes: 1, insert: "" });
  const joined = parse(initial, edits);
  assert.deepEqual(joined.issues, [
    ["simple_key", "invalid_syntax", "invalid_key_character", 1, 3],
  ]);
  assert.deepEqual(joined.nodes, parse(initial).nodes);
});
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
      ["time_hour", "incomplete_syntax", "invalid_date_time", 15, 16],
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
    [["toml", "incomplete_syntax", "invalid_line_ending", 3, 4]],
  ],
  [
    "short boolean at EOF",
    "a = tru",
    [["val", "incomplete_syntax", "invalid_value", 4, 7]],
  ],
  [
    "short boolean before closing",
    "a=[tru]",
    [["val", "invalid_syntax", "invalid_value", 3, 6]],
  ],
  [
    "signed special float prefix",
    "a = +in",
    [["special_float", "incomplete_syntax", "invalid_value", 5, 7]],
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
    [["unsigned_dec_int", "incomplete_syntax", "invalid_number", 5, 6]],
  ],
  [
    "trailing separator before closing",
    "a=[1_]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 5]],
  ],
  [
    "unsigned leading-zero digits at EOF await a date or time",
    "a = 01",
    [["val", "incomplete_syntax", "invalid_value", 4, 6]],
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
      ["time_hour", "incomplete_syntax", "invalid_date_time", 15, 16],
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
      ["basic_string", "incomplete_syntax", "invalid_escape", 5, 9],
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
      ["ml_basic_body", "incomplete_syntax", "invalid_escape", 7, 10],
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
    [["array_table", "incomplete_syntax", "invalid_delimiter", 3, 4]],
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
    [["val", "incomplete_syntax", "invalid_value", 2, 6]],
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
      ["val", "incomplete_syntax", "invalid_value", 3, 5],
      ["array", "incomplete_syntax", "missing_array_close", 5, 5],
    ],
  ],
  [
    "inline table at EOF preserves an unfinished numeric value",
    "a={b=01",
    [
      ["val", "incomplete_syntax", "invalid_value", 5, 7],
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
  [
    "dash run keeps an exponent letter after other numeric junk",
    "a=[1-:e]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 7]],
  ],
  [
    "integer junk continues through a dot and an exponent letter",
    "a=1x.e",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "signed junk continues through a dot",
    "a=-a.",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "fraction junk continues through a second decimal point",
    "a=1.5?.",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "exponent junk continues through a second exponent letter",
    "a=1e5?e",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "a dash later in a junk run keeps the exponent letter in the integer",
    "a=1?-e5",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "an underscore after a dash keeps the exponent letter in the integer",
    "a=1-_e",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "separator junk continues through a dot",
    "a=1_x.",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "a leading fraction separator continues through a second decimal point",
    "a=1._.",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 6]],
  ],
  [
    "a signed leading separator continues through an exponent letter",
    "a=+_e=",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 6]],
  ],
  [
    "signed junk continues through the separator before digits",
    "a=+?_1",
    [["dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "fraction junk ending at a dot keeps the following exponent",
    "a=1.5x.e5",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
];
const recoveryCases = [
  ...["key", "e", "E", "key .x"].map((key) => [
    `numeric word junk yields to a confirmed assignment: ${key}`,
    `a=1x?${key}=2`,
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["toml", "invalid_syntax", "missing_newline", 5, 5],
    ],
  ]),
  ...["a=1.5x?e=2", "a=1e5x?e=2"].map((source) => [
    `fraction or exponent word junk yields to an assignment: ${source}`,
    source,
    [
      ["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7],
      ["toml", "invalid_syntax", "missing_newline", 7, 7],
    ],
  ]),
  ...["a=1.5x?e5", "a=1e5x?e5"].map((source) => [
    `unconfirmed exponent-letter key stays in the numeric run: ${source}`,
    source,
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 8]],
  ]),
  ...["hex_int", "oct_int", "bin_int"].map((owner, index) => [
    `${owner} word junk yields to an assignment after punctuation`,
    `a=0${["x", "o", "b"][index]}1x?key=2`,
    [
      [owner, "invalid_syntax", "invalid_number", 5, 7],
      ["toml", "invalid_syntax", "missing_newline", 7, 7],
    ],
  ]),
  [
    "array word junk retains assignment-like text in the number",
    "a=[1x?e=2]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 8]],
  ],
  [
    "inline numeric word junk preserves a confirmed key",
    "a={b=1x?key=2}",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 8],
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
    "inline glued text without an assignment remains junk",
    "a={b=truex}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 10]],
  ],
  [
    "inline glued text becomes a key only with a confirmed assignment",
    "a={b=truex=2}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        9,
        9,
      ],
    ],
  ],
  [
    "inline glued junk ends before a confirmed assignment",
    "a={b=truex?key=2}",
    [
      ["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 11],
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        11,
        11,
      ],
    ],
  ],
  [
    "inline glued junk preserves the comma and following keyval",
    "a={b=truex,x=2}",
    [["inline_table_keyvals", "invalid_syntax", "invalid_character", 9, 10]],
  ],
  ...["a={x", "a={b=true,x"].map((source) => [
    `a key at the start of an inline item retains its missing syntax: ${source}`,
    source,
    [
      [
        "keyval",
        "incomplete_syntax",
        "missing_assignment_operator",
        source.length,
        source.length,
      ],
      [
        "keyval",
        "incomplete_syntax",
        "missing_value",
        source.length,
        source.length,
      ],
      [
        "inline_table",
        "incomplete_syntax",
        "missing_inline_table_close",
        source.length,
        source.length,
      ],
    ],
  ]),
  [
    "missing fractional digits preserve the following real exponent",
    "a=1.e5",
    [["frac", "invalid_syntax", "missing_digits", 4, 4]],
  ],

  [
    "numeric junk stops before an adjacent bare key",
    "a=1?key=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "numeric junk stops before an adjacent exponent-letter key",
    "a=1?e=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "numeric junk stops before a confirmed dotted key with whitespace",
    "a=1?key .x=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  [
    "unconfirmed numeric key text stays in one issue",
    "a=1?key",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 7]],
  ],
  [
    "numeric junk stops before an adjacent quoted key",
    'a=1?"key"=2',
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 4],
      ["toml", "invalid_syntax", "missing_newline", 4, 4],
    ],
  ],
  ...["hex_int", "oct_int", "bin_int"].map((owner, index) => [
    `${owner} junk stops before an adjacent key`,
    `a=0${["x", "o", "b"][index]}1?key=2`,
    [
      [owner, "invalid_syntax", "invalid_number", 5, 6],
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
    ],
  ]),
  [
    "inline numeric junk keeps the next real key",
    "a={b=1?key=2}",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 7],
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
    "array numeric junk does not create key-value pairs",
    "a=[1?key=2]",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 4, 9]],
  ],
  [
    "fraction junk before its first normal digit retains assignment text",
    "a=1.?key=2",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 9]],
  ],
  [
    "exponent junk before its first normal digit retains assignment text",
    "a=1e?key=2",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 9]],
  ],
  ...["a=1.5?key=2", "a=1e5?key=2"].map((source) => [
    `numeric junk after a real fractional or exponent digit recovers a key: ${source}`,
    source,
    [
      ["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 6],
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
    ],
  ]),
  ...["a=1..5", "a=1e.5"].map((source) => [
    `invalid dot before the first digit stays in its numeric element: ${source}`,
    source,
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 4, 5]],
  ]),

  [
    "adjacent date delimiter becomes a key",
    "a=1979-05-27T=1",
    [["toml", "invalid_syntax", "missing_newline", 12, 12]],
  ],
  [
    "adjacent local time offset becomes a key",
    "a=07:32Z=1",
    [["toml", "invalid_syntax", "missing_newline", 7, 7]],
  ],
  [
    "adjacent datetime offset becomes a key",
    "a=1979-05-27T07:32Z=1",
    [["toml", "invalid_syntax", "missing_newline", 18, 18]],
  ],
  [
    "adjacent numeric time offset becomes a key",
    "a=07:32-01=1",
    [["toml", "invalid_syntax", "missing_newline", 7, 7]],
  ],
  [
    "dotted time suffix becomes a key",
    "a=07:32Z.x=1",
    [["toml", "invalid_syntax", "missing_newline", 7, 7]],
  ],
  [
    "array date delimiter stays a delimiter before an assignment",
    "a=[1979-05-27T=1]",
    [
      ["local_date_time", "invalid_syntax", "missing_digits", 14, 14],
      ["val", "invalid_syntax", "invalid_character", 14, 15],
      ["array_values", "invalid_syntax", "missing_array_separator", 15, 15],
    ],
  ],
  [
    "inline date delimiter becomes a key",
    "a={b=1979-05-27T=1}",
    [
      [
        "inline_table_keyvals",
        "invalid_syntax",
        "missing_inline_table_separator",
        15,
        15,
      ],
    ],
  ],
  [
    "one issue owns contiguous expression junk",
    "a=truex.;}]",
    [["expression", "invalid_syntax", "invalid_character", 6, 11]],
  ],
  [
    "expression junk stops before a confirmed key",
    "a=truex..key=2",
    [
      ["expression", "invalid_syntax", "invalid_character", 6, 9],
      ["toml", "invalid_syntax", "missing_newline", 9, 9],
    ],
  ],
  [
    "expression junk keeps a quoted key whole before a confirmed key",
    'a=true"a b" c=1',
    [
      ["expression", "invalid_syntax", "invalid_character", 6, 11],
      ["toml", "invalid_syntax", "missing_newline", 12, 12],
    ],
  ],
  [
    "whitespace separates expression junk",
    "a=true]} ;,",
    [
      ["expression", "invalid_syntax", "invalid_character", 6, 8],
      ["expression", "invalid_syntax", "invalid_character", 9, 11],
    ],
  ],
  [
    "one issue owns contiguous value junk",
    "a==\0=1",
    [["val", "invalid_syntax", "invalid_character", 2, 5]],
  ],
  [
    "header junk preserves the real key",
    "[{{a]",
    [
      ["std_table", "invalid_syntax", "missing_key", 1, 1],
      ["std_table", "invalid_syntax", "invalid_character", 1, 3],
      ["std_table", "invalid_syntax", "unexpected_key", 3, 4],
    ],
  ],
  [
    "header junk stops before its closing delimiter",
    "[a{},}]",
    [["std_table", "invalid_syntax", "invalid_character", 2, 6]],
  ],
  [
    "separator and invalid digit share one issue",
    "a=1_x",
    [["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5]],
  ],
  [
    "leading separator and invalid base digit share one issue",
    "a=0x_g",
    [["hex_int", "invalid_syntax", "invalid_number", 4, 6]],
  ],
  [
    "invalid numeric run stops before normal digits",
    "a=1_x2y_",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 6, 8],
    ],
  ],
  [
    "numeric junk preserves the following exponent",
    "a=1.2_x3e4",
    [["zero_prefixable_int", "invalid_syntax", "invalid_number", 5, 7]],
  ],
  [
    "numeric junk stops at a normal digit before an adjacent key",
    "a=1x?1y=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 3, 5],
      ["toml", "invalid_syntax", "missing_newline", 6, 6],
    ],
  ],
  [
    "a missing inline table close ends rejected numeric key text",
    "a=[{b=1x ]c=2",
    [
      ["unsigned_dec_int", "invalid_syntax", "invalid_number", 7, 8],
      ["inline_table", "invalid_syntax", "missing_inline_table_close", 9, 9],
      ["toml", "invalid_syntax", "missing_newline", 10, 10],
    ],
  ],
  ...[
    ["hex_int", "a=0x1_:ga", 8],
    ["oct_int", "a=0o1_:8", 8],
    ["bin_int", "a=0b1_:2", 8],
    ["hex_int", "a=0x1__ab", 6],
  ].map(([owner, source, end]) => [
    `separator junk follows the digit rules of ${source}`,
    source,
    [[owner, "invalid_syntax", "invalid_number", 5, end]],
  ]),
];
for (const [name, source, expected] of [
  ...cases,
  ...boundaryCases,
  ...recoveryCases,
]) {
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
    for (let byte = 2; byte <= source.length; byte++) {
      for (const insert of ["=1", " ", "\n"]) {
        const edit = { byte, deleteBytes: 0, insert };
        const changed = applyEdits(source, [edit]);
        const result = parse(source, [edit]);
        const fresh = parse(changed);
        assert.equal(result.hasError, false, result.cst);
        assert.deepEqual(
          result.nodes,
          fresh.nodes,
          JSON.stringify({ source, edit }),
        );
        const restored = parse(source, [
          edit,
          { byte, deleteBytes: insert.length, insert: "" },
        ]);
        assert.deepEqual(
          restored.nodes,
          parse(source).nodes,
          JSON.stringify({ source, edit }),
        );
      }
    }
  }
});

test("toml: edits to spaced dotted junk invalidate failed key lookahead", () => {
  for (const prefix of ["a=true", "a=1?", "a=1x?", "a={b=true", "a={b=1x?"]) {
    const initial = `${prefix}x .x .x`;
    const completed = `${initial}=2`;
    const repaired = parse(initial, [
      { byte: Buffer.byteLength(initial), deleteBytes: 0, insert: "=2" },
    ]);
    assert.equal(repaired.hasError, false, repaired.cst);
    assert.deepEqual(repaired.nodes, parse(completed).nodes);
    const restored = parse(completed, [
      { byte: Buffer.byteLength(initial), deleteBytes: 2, insert: "" },
    ]);
    assert.equal(restored.hasError, false, restored.cst);
    assert.deepEqual(restored.nodes, parse(initial).nodes);
  }
});

test("toml: rejected dotted junk ends before a later key or another expression", () => {
  for (const [source, lastKeyval] of [
    ["a=truex .x key=2", "key=2"],
    ["a=truex .x\nb=2", "b=2"],
    ["a=truex .x\nb=1key=2", "key=2"],
    ['a=truex .x ."k"=2', 'x .x ."k"=2'],
    ['a=truex .x ."k\nkey=2', "key=2"],
    ["a=1?x .x key=2", "key=2"],
    ["a={b=1?x .x}\nnext=2", "next=2"],
    ["a=1x?key=2", "key=2"],
    ["a=1x?e=2", "e=2"],
    ["a={b=truex?key=2}", "key=2"],
  ]) {
    const fresh = parse(source);
    const edited = parse(`\n${source}`, [
      { byte: 0, deleteBytes: 1, insert: "" },
    ]);
    assert.equal(fresh.hasError, false, fresh.cst);
    assert.deepEqual(edited.nodes, fresh.nodes);
    const keyval = fresh.nodes.filter((node) => node.kind === "keyval").at(-1);
    assert.ok(keyval, fresh.cst);
    assert.equal(source.slice(keyval.start, keyval.end), lastKeyval, fresh.cst);
  }
});
