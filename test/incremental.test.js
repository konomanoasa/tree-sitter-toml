import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  assertValidHistory,
  parse,
} from "./support/parser.js";

const histories = [
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

const restorationSources = [
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
        throw new Error(JSON.stringify({ seed, source, edits, restores }), {
          cause: error,
        });
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
          throw new Error(JSON.stringify({ seed, source, edits, current }), {
            cause: error,
          });
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
