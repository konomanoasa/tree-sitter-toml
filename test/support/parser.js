import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";

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
    timeout: 60000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

after(() => {
  runner?.close();
});

// The CLI exit status ignores hidden missing tokens; use the root --cst error
// marker.
function parse(source, edits = []) {
  const directory = mkdtempSync(join(runtime, "input-"));
  try {
    const path = join(directory, "input.toml");
    writeFileSync(path, source);
    const args = [
      "parse",
      "--cst",
      "--lib-path",
      library,
      "--lang-name",
      "toml",
      path,
    ];
    let bytes = Buffer.from(source);
    for (const { byte, deleteBytes, insert } of edits) {
      assert.ok(Number.isSafeInteger(byte) && byte >= 0);
      assert.ok(Number.isSafeInteger(deleteBytes) && deleteBytes >= 0);
      assert.ok(byte <= bytes.length && deleteBytes <= bytes.length - byte);
      assert.equal(typeof insert, "string");
      bytes = Buffer.concat([
        bytes.subarray(0, byte),
        Buffer.from(insert),
        bytes.subarray(byte + deleteBytes),
      ]);
      args.push("--edits", `${byte} ${deleteBytes} ${insert}`);
    }
    const result = runner.run(args, { timeout: 30000 });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    assert.ok(result.stdout.length > 0, result.stderr);
    const root =
      /^[0-9]+:[0-9]+ +- +([0-9]+):([0-9]+) +•?(toml|ERROR)( |\n|$)/.exec(
        result.stdout,
      );
    assert.notEqual(root, null, result.stdout);
    let row = 0;
    for (const byte of bytes) if (byte === 10) row += 1;
    assert.deepEqual(
      root.slice(1, 3).map(Number),
      [row, bytes.length - bytes.lastIndexOf(10) - 1],
      "root must reach the edited source end",
    );
    return {
      cst: result.stdout,
      hasError: /^\S+\s+-\s+\S+\s+•/.test(result.stdout),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export { parse };
