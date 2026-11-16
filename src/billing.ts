// Prices are tax-exclusive. Round each line and its tax to paise, half up.
export function lineAmounts(price: number | string, quantity: number, rate: number | string) {
  const scaled = (value: number | string, digits: number) => {
    const [whole, fraction = ""] = String(value).split(".");
    return BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0").slice(0, digits));
  };
  const round = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor;
  const base = round(scaled(price, 2) * scaled(quantity.toFixed(3), 3), 1000n);
  const tax = round(base * scaled(rate, 2), 10000n);
  return { base: Number(base), tax: Number(tax), total: Number(base + tax) };
}
