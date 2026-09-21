import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "./support/parser.js";

const histories = [
  [
    "replace scalar categories",
    "a = true",
    [
      [4, 4, "1234", "a = 1234", true],
      [4, 4, "2026-09-20", "a = 2026-09-20", true],
      [4, 10, '"x"', 'a = "x"', true],
    ],
  ],
  [
    "extend date with time and restore separator",
    "a = 2026-09-20",
    [
      [14, 0, " 07:32", "a = 2026-09-20 07:32", true],
      [14, 1, "\t", "a = 2026-09-20\t07:32", false],
      [14, 1, "T", "a = 2026-09-20T07:32", true],
    ],
  ],
  [
    "cross month bounds and restore a valid date",
    "a = 2026-12-01",
    [
      [9, 2, "13", "a = 2026-13-01", false],
      [9, 2, "00", "a = 2026-00-01", false],
      [9, 2, "01", "a = 2026-01-01", true],
    ],
  ],
  [
    "cross day bounds and restore a valid date",
    "a = 2026-01-31",
    [
      [12, 2, "32", "a = 2026-01-32", false],
      [12, 2, "00", "a = 2026-01-00", false],
      [12, 2, "01", "a = 2026-01-01", true],
    ],
  ],
  [
    "cross time element bounds and restore a valid time",
    "a = 23:59:60",
    [
      [4, 2, "24", "a = 24:59:60", false],
      [4, 2, "00", "a = 00:59:60", true],
      [7, 2, "60", "a = 00:60:60", false],
      [7, 2, "00", "a = 00:00:60", true],
      [10, 2, "61", "a = 00:00:61", false],
      [10, 2, "00", "a = 00:00:00", true],
    ],
  ],
  [
    "cross offset bounds and restore a valid date-time",
    "a = 2026-01-01T00:00+23:59",
    [
      [21, 2, "24", "a = 2026-01-01T00:00+24:59", false],
      [21, 2, "00", "a = 2026-01-01T00:00+00:59", true],
      [24, 2, "60", "a = 2026-01-01T00:00+00:60", false],
      [24, 2, "00", "a = 2026-01-01T00:00+00:00", true],
    ],
  ],
  [
    "edit whitespace before dotted key separator",
    "a.b = true",
    [
      [1, 0, " \t", "a \t.b = true", true],
      [3, 1, "", "a \tb = true", false],
      [3, 0, ".", "a \t.b = true", true],
    ],
  ],
  [
    "insert trailing array comment and remove comma",
    "a = [true,]",
    [
      [10, 0, "# tail\n", "a = [true,# tail\n]", true],
      [9, 1, "", "a = [true# tail\n]", true],
      [9, 0, ",", "a = [true,# tail\n]", true],
    ],
  ],
  [
    "move trailing array layout between array and values",
    "a = [true ]",
    [
      [9, 0, ",", "a = [true, ]", true],
      [9, 1, "", "a = [true ]", true],
      [10, 0, ",", "a = [true ,]", true],
    ],
  ],
  [
    "move trailing inline table layout by inserting a comma",
    "a = {b = 1 }",
    [
      [11, 0, ",", "a = {b = 1 ,}", true],
      [11, 1, "", "a = {b = 1 }", true],
    ],
  ],
  [
    "extend multiline closing quote run",
    'a = """x"""',
    [
      [8, 0, '"', 'a = """x""""', true],
      [8, 0, '"', 'a = """x"""""', true],
      [8, 0, '"', 'a = """x""""""', false],
      [8, 1, "", 'a = """x"""""', true],
      [8, 2, "", 'a = """x"""', true],
    ],
  ],
  [
    "restore multiline literal closing delimiter",
    "a = '''x'''",
    [
      [8, 1, "", "a = '''x''", false],
      [8, 0, "''", "a = '''x''''", true],
      [8, 1, "", "a = '''x'''", true],
    ],
  ],
  [
    "change multiline string kind",
    'a = """x\ny"""',
    [
      [4, 3, "'''", "a = '''x\ny\"\"\"", false],
      [10, 3, "'''", "a = '''x\ny'''", true],
    ],
  ],
  [
    "restore inline table after incomplete comment",
    "a = {b = true,}",
    [
      [14, 1, "# tail", "a = {b = true,# tail", false],
      [20, 0, "\n}", "a = {b = true,# tail\n}", true],
    ],
  ],
  [
    "edit line ending without losing statement boundary",
    "a = true\nb = false",
    [
      [8, 0, "\r", "a = true\r\nb = false", true],
      [9, 1, "", "a = true\rb = false", false],
      [9, 0, "\n", "a = true\r\nb = false", true],
    ],
  ],
  [
    "replace Unicode string content by byte range",
    'a = "🌿"',
    [
      [5, 4, "日本", 'a = "日本"', true],
      [11, 1, "", 'a = "日本', false],
      [11, 0, '"', 'a = "日本"', true],
    ],
  ],
  [
    "change table header kind",
    "[a]\nx = true",
    [
      [0, 0, "[", "[[a]\nx = true", false],
      [4, 0, "]", "[[a]]\nx = true", true],
    ],
  ],
  [
    "type key and array from empty input",
    "",
    [
      [0, 0, "a = [", "a = [", false],
      [5, 0, "true,", "a = [true,", false],
      [10, 0, "]", "a = [true,]", true],
    ],
  ],
];

for (const [name, initial, steps] of histories) {
  test(`toml: ${name}`, () => {
    let source = Buffer.from(initial);
    const edits = [];
    for (const [position, removed, inserted, expected, valid] of steps) {
      source = Buffer.concat([
        source.subarray(0, position),
        Buffer.from(inserted),
        source.subarray(position + removed),
      ]);
      assert.equal(
        source.toString(),
        expected,
        "edit fixture must produce the explicit expected input",
      );
      edits.push({ byte: position, deleteBytes: removed, insert: inserted });
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
