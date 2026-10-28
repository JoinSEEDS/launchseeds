import { expect, test } from "bun:test";
import { simulationProblem } from "../src/server/coin-trade";

test("failed trade simulations read as plain reasons", () => {
  expect(simulationProblem({ InstructionError: [2, { Custom: 1 }] }, ["Transfer: insufficient lamports 1, need 2"])).toBe("Not enough SOL in this wallet for that trade and its fees.");
  expect(simulationProblem({ InstructionError: [2, { Custom: 6002 }] }, ["Error Code: TooMuchSolRequired"])).toBe("The price moved past your slippage. Try again or raise the slippage.");
  expect(simulationProblem("AccountNotFound", [])).toBe("This wallet has no SOL yet.");
  expect(simulationProblem({ InstructionError: [2, { Custom: 9 }] }, [])).toBe("The trade would fail right now. Try a different amount.");
});
