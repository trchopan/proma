import { expect, test } from "bun:test";

test("prints greeting", () => {
  expect("Hello via Bun!").toBe("Hello via Bun!");
});
