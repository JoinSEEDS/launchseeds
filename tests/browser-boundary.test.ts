import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildClientScript } from "../node_modules/tradjs/src/server/build";

test("browser buffer works while explicit server imports remain blocked", async () => {
  const folder = mkdtempSync(join(tmpdir(), "launchseeds-boundary-"));
  const fixture = (name: string, source: string) => {
    const path = join(folder, `${name}.ts`);
    writeFileSync(path, source);
    return path;
  };
  await expect(
    buildClientScript(
      fixture(
        "buffer",
        'import { Buffer } from "buffer"; export default () => Buffer.from("ok").toString();',
      ),
    ),
  ).resolves.toBeString();
  for (const specifier of ["node:buffer", "node:fs", "fs", "bun:sqlite"])
    await expect(
      buildClientScript(
        fixture(
          specifier.replace(/:/g, "-"),
          `import * as server from ${JSON.stringify(specifier)}; export default () => console.log(server);`,
        ),
      ),
    ).rejects.toThrow("Server-only import");
});
