import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";
import { parseCst } from "./cst.js";

const buildTimeoutMs = 60_000;
const parseTimeoutMs = 30_000;

let runner;
let runtime;
let library;

before(() => {
  runner = createTreeSitter();
  runtime = runner.directory;
  library = join(
    runtime,
    process.platform === "win32" ? "parser.dll" : "parser",
  );
  const result = runner.run(["build", "--output", library, root], {
    timeout: buildTimeoutMs,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

after(() => {
  runner?.close();
});

function trees(stdout, path) {
  const parsed = [];
  let lines = [];
  for (const line of stdout.split("\n")) {
    if (
      line.startsWith(path) &&
      /^[ \t]+Parse:[ \t]/.test(line.slice(path.length))
    ) {
      parsed.push(lines.join("\n"));
      lines = [];
    } else if (!/^[ \t]*Edit:[ \t]/.test(line)) {
      lines.push(line);
    }
  }
  return parsed;
}

function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const edit of edits) {
    const { byte, deleteBytes, insert } = edit;
    const description = JSON.stringify(edit);
    assert.ok(
      Number.isSafeInteger(byte) && byte >= 0,
      `invalid byte offset: ${description}`,
    );
    assert.ok(
      Number.isSafeInteger(deleteBytes) && deleteBytes >= 0,
      `invalid deletion length: ${description}`,
    );
    assert.equal(typeof insert, "string", `invalid insertion: ${description}`);
    assert.ok(
      byte <= bytes.length && deleteBytes <= bytes.length - byte,
      `edit exceeds ${bytes.length} source bytes: ${description}`,
    );
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes;
}

function editedLexes(log) {
  const [, edited] = log.split(/^parse_after_edit$/m);
  assert.notEqual(
    edited,
    undefined,
    "the debug log must mark the edited parse",
  );
  return edited.match(/^lex_(external|internal) /gm)?.length ?? 0;
}

function parse(source, edits = [], { lexes = false } = {}) {
  const directory = mkdtempSync(join(runtime, "input-"));
  try {
    const path = join(directory, "input.toml");
    writeFileSync(path, source);
    const args = [
      "parse",
      "--encoding",
      "utf8",
      "--cst",
      "--time",
      "--lib-path",
      library,
      "--lang-name",
      "toml",
      ...(lexes ? ["--debug", "normal"] : []),
      path,
    ];
    let bytes = Buffer.from(source);
    for (const { byte, deleteBytes, insert } of edits) {
      bytes = applyEdits(bytes, [{ byte, deleteBytes, insert }]);
      args.push("--edits", `${byte} ${deleteBytes} ${insert}`);
    }
    const repeated = edits.length === 0;
    if (repeated) args.push(path);
    const result = runner.run(args, { timeout: parseTimeoutMs });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const parsed = trees(result.stdout, path);
    assert.equal(
      parsed.length,
      repeated ? 2 : 1,
      result.stdout + result.stderr,
    );
    if (repeated) {
      assert.equal(parsed[1], parsed[0], "a repeated fresh parse must match");
    }
    return {
      ...parseCst(parsed[0], bytes),
      ...(lexes && { lexes: editedLexes(result.stderr) }),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertIncrementalEqualsFresh(initial, edits, source) {
  try {
    const incremental = parse(initial, edits);
    const fresh = parse(source);
    assert.equal(incremental.hasError, false, incremental.cst);
    assert.equal(fresh.hasError, false, fresh.cst);
    assert.deepEqual(incremental.nodes, fresh.nodes);
    return incremental;
  } catch (error) {
    if (error instanceof Error)
      error.message += `\n${JSON.stringify({ initial, edits, source })}`;
    throw error;
  }
}

function assertEditHistory({ source, edits }) {
  let result;
  for (let count = 1; count <= edits.length; count++) {
    const history = edits.slice(0, count);
    result = assertIncrementalEqualsFresh(
      source,
      history,
      applyEdits(source, history),
    );
  }
  return result;
}

function assertValidHistory(initial, steps) {
  let source = Buffer.from(initial);
  const edits = [];
  for (const { byte, deleteBytes, insert, source: expected, valid } of steps) {
    const edit = { byte, deleteBytes, insert };
    source = applyEdits(source, [edit]);
    assert.equal(
      source.toString(),
      expected,
      "edit fixture must produce the explicit expected input",
    );
    edits.push(edit);
    const incremental = assertIncrementalEqualsFresh(initial, edits, expected);
    assert.equal(incremental.issues.length === 0, valid, incremental.cst);
  }
}

export {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  assertValidHistory,
  parse,
};
