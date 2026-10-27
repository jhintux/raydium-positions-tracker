import assert from "node:assert/strict";
import test from "node:test";
import { comparePositions } from "../lib/present";

test("open positions come before closed positions, newest open date first", () => {
  const rows = [
    { status: "closed" as const, openedAt: 300 },
    { status: "open" as const, openedAt: 100 },
    { status: "open" as const, openedAt: null },
    { status: "closed" as const, openedAt: 50 },
    { status: "open" as const, openedAt: 200 },
  ];
  const sorted = [...rows].sort(comparePositions);
  assert.deepEqual(
    sorted.map((row) => [row.status, row.openedAt]),
    [
      ["open", 200],
      ["open", 100],
      ["open", null],
      ["closed", 300],
      ["closed", 50],
    ],
  );
});
