import { expect, test } from "bun:test";
import { oneLaunchAtATime } from "../src/server/launch-gate";

test("launch requests pass the gate one at a time, so the second sees the first's launch", async () => {
  let busy = false;
  const outcomes: string[] = [];
  const request = (name: string) => oneLaunchAtATime(async () => {
    if (busy) { outcomes.push(`${name}: another coin is launching`); return; }
    await Bun.sleep(20); // RPC calls between the check and the saved launch
    busy = true;
    outcomes.push(`${name}: launched`);
  });
  await Promise.all([request("a"), request("b"), request("c")]);
  expect(outcomes).toEqual(["a: launched", "b: another coin is launching", "c: another coin is launching"]);
});

test("a failed request does not block the next one", async () => {
  await expect(oneLaunchAtATime(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(await oneLaunchAtATime(async () => "ok")).toBe("ok");
});
