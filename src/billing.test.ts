import { test } from "node:test";
import assert from "node:assert/strict";
import { lineAmounts } from "./billing";

test("decimal prices do not accumulate floating point errors", () => {
  assert.deepEqual(lineAmounts("0.10", 3, "0"), { base: 30, tax: 0, total: 30 });
});
test("fractional quantities round half up to paise", () => {
  assert.deepEqual(lineAmounts("19.99", 0.125, "5"), { base: 250, tax: 13, total: 263 });
});
test("tax rounds per line and adds to rounded subtotal", () => {
  assert.deepEqual(lineAmounts("99.99", 3, "18"), { base: 29997, tax: 5399, total: 35396 });
});
test("tax disabled and free products", () => {
  assert.deepEqual(lineAmounts("100", 2.5, 0), { base: 25000, tax: 0, total: 25000 });
  assert.deepEqual(lineAmounts(0, 1, 18), { base: 0, tax: 0, total: 0 });
});
test("smallest supported quantity", () => {
  assert.deepEqual(lineAmounts("1000", 0.001, "0"), { base: 100, tax: 0, total: 100 });
});
