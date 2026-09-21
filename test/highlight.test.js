import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  createTreeSitter,
  grammars,
  packageName,
  root,
} from "../scripts/tree-sitter.js";

function decodeEntities(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function renderedCaptures(html, source) {
  const start = html.indexOf("<pre><code>");
  const end = html.indexOf("</code></pre>");
  assert.ok(start >= 0 && end >= start, html);
  const content = html.slice(start + "<pre><code>".length, end);
  const stack = [];
  const captures = [];
  let text = "";
  for (const part of content.matchAll(
    /<span class='([^']*)'>|<[/]span>|([^<]+)/g,
  )) {
    if (part[1] !== undefined) stack.push(part[1].replaceAll(" ", "."));
    else if (part[0] === "</span>") assert.notEqual(stack.pop(), undefined);
    else {
      const decoded = decodeEntities(part[2]);
      text += decoded;
      captures.push(
        ...Array(Buffer.byteLength(decoded)).fill(stack.at(-1) ?? ""),
      );
    }
  }
  assert.equal(stack.length, 0, "unclosed highlight span");
  assert.equal(
    text.replace(/\n$/, ""),
    source.replace(/\n$/, ""),
    "rendered source differs from the input",
  );
  return captures;
}

function createHighlighter({ directory, root, run, captureNames }) {
  const parserDirectory = join(directory, "parsers");
  mkdirSync(parserDirectory);
  // CLI discovery requires a tree-sitter-* entry even when the checkout is renamed.
  symlinkSync(root, join(parserDirectory, "tree-sitter-test"), "junction");
  const configPath = join(directory, "highlight.json");
  const capturePath = join(directory, "captures.txt");
  writeFileSync(
    configPath,
    JSON.stringify({
      "parser-directories": [parserDirectory],
      theme: Object.fromEntries(
        captureNames.map((name, index) => [name, index + 17]),
      ),
    }),
  );
  writeFileSync(capturePath, `${captureNames.join("\n")}\n`);

  return (scope, source, valid = true) => {
    const path = join(directory, "highlight.txt");
    writeFileSync(path, source);
    if (valid) {
      const parsed = run(["parse", "--cst", "--scope", scope, path]);
      assert.doesNotMatch(parsed, /^[0-9: \t-]+•/m, parsed);
    }
    const captures = renderedCaptures(
      run([
        "highlight",
        "--check",
        "--captures-path",
        capturePath,
        "--config-path",
        configPath,
        "--html",
        "--layout",
        "fragment",
        "--style",
        "classes",
        "--scope",
        scope,
        path,
      ]),
      source,
    );
    for (const capture of captures) {
      assert.ok(
        capture === "" || captureNames.includes(capture),
        `unexpected final capture: ${capture}`,
      );
    }
    return captures;
  };
}

function assertCaptures(source, actual, ranges) {
  const bytes = Buffer.from(source);
  const expected = Array(bytes.length).fill("");
  let previousEnd = 0;
  for (const [start, end, capture] of ranges) {
    assert.ok(
      Number.isSafeInteger(start) && start >= previousEnd,
      "expected ranges must be ordered and disjoint",
    );
    assert.ok(
      Number.isSafeInteger(end) && end > start && end <= bytes.length,
      "expected range exceeds source bytes",
    );
    expected.fill(capture, start, end);
    previousEnd = end;
  }
  // HTML emits line breaks outside spans.
  for (const [index, byte] of bytes.entries()) {
    if (byte !== 10)
      assert.equal(
        actual[index],
        expected[index],
        `byte ${index} in ${JSON.stringify(source)}`,
      );
  }
}

const captureNames = [
  "boolean",
  "comment",
  "number",
  "number.float",
  "operator",
  "property",
  "punctuation.bracket",
  "punctuation.delimiter",
  "punctuation.special",
  "string",
  "string.escape",
  "string.special",
];
let highlight;

let directory;
let runner;
before(() => {
  directory = mkdtempSync(join(tmpdir(), `${packageName}-highlight-`));
  runner = createTreeSitter();
  highlight = createHighlighter({
    directory,
    root,
    run: assertCommand,
    captureNames,
  });
});
after(() => {
  try {
    runner?.close();
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function assertCommand(arguments_) {
  const result = runner.run(arguments_, {
    timeout: 60_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /Non-standard highlight captures/);
  return result.stdout;
}

const finalCaptureCases = [
  {
    name: "basic strings, escapes and comments",
    source: 'key = "v\\x20\\""  # note\n',
    captures: [
      [0, 3, "property"],
      [4, 5, "operator"],
      [6, 7, "punctuation.delimiter"],
      [7, 8, "string"],
      [8, 14, "string.escape"],
      [14, 15, "punctuation.delimiter"],
      [17, 23, "comment"],
    ],
  },
  {
    name: "quoted dotted keys and literal strings",
    source: '"a\\t"."b" = \'hello\'\n',
    captures: [
      [0, 1, "punctuation.delimiter"],
      [1, 2, "property"],
      [2, 4, "string.escape"],
      [4, 7, "punctuation.delimiter"],
      [7, 8, "property"],
      [8, 9, "punctuation.delimiter"],
      [10, 11, "operator"],
      [12, 13, "punctuation.delimiter"],
      [13, 18, "string"],
      [18, 19, "punctuation.delimiter"],
    ],
  },
  {
    name: "integer bases, signs and separators",
    source: "n = [1, -1_0, 0x1F, 0o7_7, 0b1_0]\n",
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 5, "punctuation.bracket"],
      [5, 6, "number"],
      [6, 7, "punctuation.delimiter"],
      [8, 12, "number"],
      [12, 13, "punctuation.delimiter"],
      [14, 18, "number"],
      [18, 19, "punctuation.delimiter"],
      [20, 25, "number"],
      [25, 26, "punctuation.delimiter"],
      [27, 32, "number"],
      [32, 33, "punctuation.bracket"],
    ],
  },
  {
    name: "float fractions, exponents and special values",
    source: "f = [+1.5e-2_0, 1_0.5, inf, -nan]\n",
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 5, "punctuation.bracket"],
      [5, 14, "number.float"],
      [14, 15, "punctuation.delimiter"],
      [16, 21, "number.float"],
      [21, 22, "punctuation.delimiter"],
      [23, 26, "number.float"],
      [26, 27, "punctuation.delimiter"],
      [28, 32, "number.float"],
      [32, 33, "punctuation.bracket"],
    ],
  },
  {
    name: "booleans, dates and times",
    source:
      "d = [true, 2026-09-20T07:32:00.5Z, 2026-09-20 07:32+07:00, 07:32]\n",
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 5, "punctuation.bracket"],
      [5, 9, "boolean"],
      [9, 10, "punctuation.delimiter"],
      [11, 33, "string.special"],
      [33, 34, "punctuation.delimiter"],
      [35, 57, "string.special"],
      [57, 58, "punctuation.delimiter"],
      [59, 64, "string.special"],
      [64, 65, "punctuation.bracket"],
    ],
  },
  {
    name: "dotted table headers",
    source: '[tbl."q"]\n',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 4, "property"],
      [4, 6, "punctuation.delimiter"],
      [6, 7, "property"],
      [7, 8, "punctuation.delimiter"],
      [8, 9, "punctuation.bracket"],
    ],
  },
  {
    name: "array table headers",
    source: "[[arr]]\n",
    captures: [
      [0, 2, "punctuation.bracket"],
      [2, 5, "property"],
      [5, 7, "punctuation.bracket"],
    ],
  },
  {
    name: "inline table entries",
    source: "t = { a = 1, b = 2 }\n",
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 5, "punctuation.bracket"],
      [6, 7, "property"],
      [8, 9, "operator"],
      [10, 11, "number"],
      [11, 12, "punctuation.delimiter"],
      [13, 14, "property"],
      [15, 16, "operator"],
      [17, 18, "number"],
      [19, 20, "punctuation.bracket"],
    ],
  },
  {
    name: "Unicode escape sequences",
    source: 'u = "\\u0041\\U0001F600"\n',
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 5, "punctuation.delimiter"],
      [5, 21, "string.escape"],
      [21, 22, "punctuation.delimiter"],
    ],
  },
  {
    name: "multiline basic strings and continuations",
    source: 'm = """a\\\n b""x"""\n',
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 7, "punctuation.delimiter"],
      [7, 8, "string"],
      [8, 9, "punctuation.special"],
      [11, 15, "string"],
      [15, 18, "punctuation.delimiter"],
    ],
  },
  {
    name: "multiline literal strings and content quotes",
    source: "l = '''\na''b'''\n",
    captures: [
      [0, 1, "property"],
      [2, 3, "operator"],
      [4, 7, "punctuation.delimiter"],
      [8, 12, "string"],
      [12, 15, "punctuation.delimiter"],
    ],
  },
];

for (const grammar of grammars) {
  for (const { name, source, captures } of finalCaptureCases) {
    test(`${grammar.name}: ${name}`, () => {
      assertCaptures(source, highlight(grammar.scope, source), captures);
    });
  }

  test(`${grammar.name}: query captures exclude LF and CRLF inside strings and continuations`, () => {
    const source = "a = \"\"\"x\ny\\\r\n z\"\"\"\r\nb = '''u\r\nv'''\n";
    const path = join(directory, "newlines.toml");
    writeFileSync(path, source);
    const output = assertCommand([
      "query",
      "--scope",
      grammar.scope,
      "--captures",
      join(root, "queries", "highlights.scm"),
      path,
    ]);
    const ranges = [
      ...output.matchAll(
        /capture: [0-9]+ - ([a-z_.]+), start: \(([0-9]+), ([0-9]+)\), end: \(([0-9]+), ([0-9]+)\)/g,
      ),
    ].map((match) => [match[1], ...match.slice(2).map(Number)]);
    assert.ok(ranges.length > 0, output);
    for (const [capture, startRow, startColumn, endRow, endColumn] of ranges) {
      assert.equal(startRow, endRow, `${capture}: capture contains a newline`);
      const line = source.split("\n")[startRow];
      const contentEnd = Buffer.byteLength(line.replace(/\r$/, ""));
      assert.ok(startColumn < endColumn && endColumn <= contentEnd, output);
    }
  });
}
