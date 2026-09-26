import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, parse } from "./support/parser.js";

const histories = [
  [
    "replace scalar categories",
    "a = true",
    [
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
  ],
  [
    "extend date with time and restore separator",
    "a = 2026-09-20",
    [
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
  ],
  [
    "cross month bounds and restore a valid date",
    "a = 2026-12-01",
    [
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
  ],
  [
    "cross day bounds and restore a valid date",
    "a = 2026-01-31",
    [
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
  ],
  [
    "cross time element bounds and restore a valid time",
    "a = 23:59:60",
    [
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
  ],
  [
    "cross offset bounds and restore a valid date-time",
    "a = 2026-01-01T00:00+23:59",
    [
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
  ],
  [
    "edit whitespace before dotted key separator",
    "a.b = true",
    [
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
  ],
  [
    "insert trailing array comment and remove comma",
    "a = [true,]",
    [
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
  ],
  [
    "move trailing array layout between array and values",
    "a = [true ]",
    [
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
  ],
  [
    "move trailing inline table layout by inserting a comma",
    "a = {b = 1 }",
    [
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
  ],
  [
    "extend multiline closing quote run",
    'a = """x"""',
    [
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
  ],
  [
    "restore multiline literal closing delimiter",
    "a = '''x'''",
    [
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
  ],
  [
    "change multiline string kind",
    'a = """x\ny"""',
    [
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
  ],
  [
    "restore inline table after incomplete comment",
    "a = {b = true,}",
    [
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
  ],
  [
    "edit line ending without losing statement boundary",
    "a = true\nb = false",
    [
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
  ],
  [
    "replace Unicode string content by byte range",
    'a = "🌿"',
    [
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
  ],
  [
    "change table header kind",
    "[a]\nx = true",
    [
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
  ],
  [
    "type key and array from empty input",
    "",
    [
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
  ],
];

for (const [name, initial, steps] of histories) {
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
      assert.equal(
        incremental.hasError,
        !valid,
        `${expected}\n${incremental.cst}`,
      );
      if (valid) {
        const fresh = parse(expected);
        assert.equal(fresh.hasError, false, fresh.cst);
        assert.equal(incremental.cst, fresh.cst, expected);
      }
    }
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
];

for (const [name, source] of restorationSources) {
  test(`toml: ${name}`, () => {
    const fresh = parse(source);
    assert.equal(fresh.hasError, false, fresh.cst);
    let position = 0;
    for (const character of source) {
      const length = Buffer.byteLength(character);
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

test("toml: fixed-seed generated histories restore valid source structure", () => {
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
      const restored = parse(source, [...edits, ...restores]);
      const description = JSON.stringify({ source, edits, restores });
      assert.equal(restored.hasError, false, description);
      assert.equal(restored.cst, fresh.cst, description);
    }
  }
});
