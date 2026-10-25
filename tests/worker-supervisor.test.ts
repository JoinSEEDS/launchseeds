import { expect, test } from "bun:test";
import { ensureWorker, WORKER_COMMAND, WORKER_PROCESS } from "../src/server/worker-supervisor";

test("web startup ensures the single detached worker through bgrun", async () => {
  const calls: unknown[] = [];
  const result = await ensureWorker(
    { LAUNCHSEEDS_WORKER_ENABLED: "true" },
    async (options) => {
      calls.push(options);
      return { status: "running", pid: 42 };
    },
    "/app",
  );
  expect(result).toEqual({ status: "running", pid: 42 });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    name: WORKER_PROCESS,
    command: WORKER_COMMAND,
    detached: true,
  });
  expect(String((calls[0] as { config: string }).config)).toEndWith(".config.toml");
});

test("worker autostart is skipped unless workers are enabled", async () => {
  let called = false;
  const result = await ensureWorker({}, async () => {
    called = true;
    return { status: "running", pid: 1 };
  });
  expect(result).toBeNull();
  expect(called).toBe(false);
});
