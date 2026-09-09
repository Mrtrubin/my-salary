import { describe, expect, it } from "vitest";
import { isWithinGracePeriod } from "@/lib/domain/payroll/money";

describe("isWithinGracePeriod 无责期边界", () => {
  it("第1~3月均在无责期内", () => {
    expect(isWithinGracePeriod(1, 3)).toBe(true);
    expect(isWithinGracePeriod(2, 3)).toBe(true);
    expect(isWithinGracePeriod(3, 3)).toBe(true);
  });

  it("第4月起脱离无责期", () => {
    expect(isWithinGracePeriod(4, 3)).toBe(false);
    expect(isWithinGracePeriod(12, 3)).toBe(false);
  });

  it("非整数月序抛错", () => {
    expect(() => isWithinGracePeriod(1.5, 3)).toThrow();
  });
});
