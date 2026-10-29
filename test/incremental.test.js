import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertIncrementalEqualsFresh,
  assertValidHistory,
  parse,
} from "./support/parser.js";

const histories = [
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
    name: "insert an invalid numeric suffix inside an unclosed array",
    initial: "a=[1 ",
    steps: [
      {
        byte: 4,
        deleteBytes: 0,
        insert: "a",
        source: "a=[1a ",
        valid: false,
      },
      {
        byte: 4,
        deleteBytes: 1,
        insert: "",
        source: "a=[1 ",
        valid: false,
      },
      {
        byte: 5,
        deleteBytes: 0,
        insert: "]",
        source: "a=[1 ]",
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
      {
        byte: 5,
        deleteBytes: 0,
        insert: "x",
        source: "a=[1]x",
        valid: false,
      },
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
      {
        byte: 5,
        deleteBytes: 1,
        insert: "",
        source: "a=[1]x=2",
        valid: false,
      },
      {
        byte: 6,
        deleteBytes: 2,
        insert: "",
        source: "a=[1]x",
        valid: false,
      },
      {
        byte: 5,
        deleteBytes: 1,
        insert: "",
        source: "a=[1]",
        valid: true,
      },
    ],
  },
  {
    name: "repair and restore malformed exponent digits",
    initial: "a=0e",
    steps: [
      {
        byte: 4,
        deleteBytes: 0,
        insert: "e",
        source: "a=0ee",
        valid: false,
      },
      {
        byte: 4,
        deleteBytes: 1,
        insert: "5",
        source: "a=0e5",
        valid: true,
      },
      {
        byte: 4,
        deleteBytes: 1,
        insert: "",
        source: "a=0e",
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
  test(`toml: edits and repair: ${name}`, () =>
    assertValidHistory(initial, steps));
}

const restorationSources = [
  "a = [true, # tail\n]\nb = {c = false, # tail\n}",
  'a . "b" = [2026-09-20 , 2026-09-20 07:32Z ]',
  'a = """\nx\\ \n y"""""\nb = true',
  "a = '''x''y'''''\nb = true",
  '["日本"]\r\na = "🌿\\xFF"\r\n',
  "a = -12.3_4e+0_2\nb = 1E-02\nc = 0.5",
];

for (const source of restorationSources) {
  test(`toml: restoring each character restores the valid CST: ${JSON.stringify(source)}`, () => {
    let byte = 0;
    for (const character of source) {
      const deleteBytes = Buffer.byteLength(character);
      assertIncrementalEqualsFresh(
        source,
        [
          { byte, deleteBytes, insert: "" },
          { byte, deleteBytes: 0, insert: character },
        ],
        source,
      );
      byte += deleteBytes;
    }
  });
}

test("toml: fixed-seed generated histories restore the valid source and CST", () => {
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
  for (const source of restorationSources) {
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
      assert.equal(applyEdits(source, history).toString(), source);
      assertIncrementalEqualsFresh(source, history, source);
    }
  }
});

test("toml: a local edit reuses surrounding valid lines", () => {
  const lineCount = 40;
  const lexedTokenLimit = 100;
  for (const line of ["a=1979-05-27T07:32:00Z", "a=[1,2]", "a={b=true}"]) {
    const source = `${line}\n`.repeat(lineCount);
    const edits = [
      {
        byte: (line.length + 1) * (lineCount / 2),
        deleteBytes: 1,
        insert: "b",
      },
    ];
    const tree = parse(source, edits, { lexes: true });
    const fresh = parse(applyEdits(source, edits));
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.nodes, fresh.nodes);
    assert.ok(tree.lexes < lexedTokenLimit, `${line}: ${tree.lexes} lexes`);
  }
});

test("toml: moving BOM to the start reparses without reusing its former owner", () => {
  assertIncrementalEqualsFresh(
    "#\uFEFFa=1",
    [{ byte: 0, deleteBytes: 1, insert: "" }],
    "\uFEFFa=1",
  );
});
