import { describe, test, expect } from "bun:test";
import {
  NAME_RE,
  parseConfiguredNames,
  validProcessName,
  parseProcessList,
  manageable,
  parseAction,
  redactLogs,
} from "../lib/admin/bgrun";
import { AdminHttpError } from "../lib/admin/security";

const env = {
  LAUNCHSEEDS_ADMIN_CONTROL_PROCESSES: "launchseeds-worker,launchseeds-web",
} as NodeJS.ProcessEnv;

describe("admin bgrun boundaries", () => {
  test("only safe registered process names can be addressed", () => {
    expect(NAME_RE.test("launchseeds-worker")).toBe(true);
    expect(validProcessName("worker_1.2")).toBe(true);
    for (const value of [
      "",
      "--nuke",
      "../etc/passwd",
      "a b",
      "a;rm",
      "a/worker",
      "é",
      "a".repeat(65),
    ]) {
      expect(validProcessName(value)).toBe(false);
    }
  });

  test("allowlist is explicit and does not accept wildcard", () => {
    expect([...parseConfiguredNames("worker, api,../escape,*")]).toEqual([
      "worker",
      "api",
    ]);
    expect(manageable("launchseeds-worker", env)).toBe(true);
    expect(manageable("another-service", env)).toBe(false);
    expect(manageable("launchseeds-worker", {})).toBe(false);
  });

  test("listing exposes curated status rather than commands or secrets", () => {
    const rows = parseProcessList(
      JSON.stringify([
        {
          name: "launchseeds-worker",
          pid: 124,
          status: "running",
          port: 4000,
          restarts: 3,
          command: "bun run worker --secret=do-not-expose",
          env: { KEY: "private" },
        },
        { name: "some-other-process", status: "stopped", pid: 0 },
        { name: "../../invalid", command: "ignored" },
        { name: "launchseeds-worker", pid: 999 },
      ]),
      env,
    );
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("launchseeds-worker");
    expect(rows[0].pid).toBe(124);
    expect(rows[0].manageable).toBe(true);
    expect(rows[1].manageable).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("do-not-expose");
    expect(JSON.stringify(rows)).not.toContain("KEY");
  });

  test("both list envelope formats are supported", () => {
    expect(
      parseProcessList('{"processes":[{"name":"api","running":true}]}')[0]
        .status,
    ).toBe("running");
    expect(() => parseProcessList('{"bad":[]}')).toThrow();
    expect(() => parseProcessList("invalid")).toThrow();
  });

  test("process actions are strictly enumerated", () => {
    expect(parseAction({ name: "launchseeds-worker", action: "stop" })).toEqual({
      name: "launchseeds-worker",
      action: "stop",
    });
    expect(parseAction({ name: "launchseeds-web", action: "restart" }).action).toBe(
      "restart",
    );
    expect(
      parseAction({ name: "launchseeds-worker", action: "delete" }).action,
    ).toBe("delete");
    for (const value of [
      { name: "worker", action: "nuke" },
      { name: "worker", action: "start" },
      { name: "../x", action: "restart" },
      { name: 1, action: "stop" },
    ])
      expect(() => parseAction(value)).toThrow(AdminHttpError);
  });

  test("redaction suppresses common credential shapes and query strings", () => {
    const redacted = redactLogs(
      "Authorization: Bearer ABC123\nAPI_KEY=abc\npassword=hunter2\nhttps://api.example.org/path?token=secret",
    );
    expect(redacted).not.toContain("ABC123");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("?token=secret");
    expect(redacted).toContain("[redacted]");
  });
});
