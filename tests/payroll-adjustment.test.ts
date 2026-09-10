import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/contracts/errors";
import {
  applyAdjustments,
  sumAdjustments,
  type AnchorPayrollResult,
  type PayrollAdjustment,
} from "@/lib/domain/payroll";

/**
 * 基准工资结果：总工资 10000 元（1000000 分），服务费 3% = 30000 分，实发 970000 分。
 * 用于验证调整项叠加后的重算口径。
 */
const base: AnchorPayrollResult = {
  baseGuaranteeInCents: 800000,
  thresholdInCents: 2120000,
  commissionStartInCents: 4000000,
  commissionRateBps: 2000,
  isQualified: true,
  isGracefulPeriod: false,
  guaranteedComponentInCents: 800000,
  performanceComponentInCents: 200000,
  grossSalaryInCents: 1000000,
  serviceFeeInCents: 30000,
  netSalaryInCents: 970000,
};

describe("sumAdjustments 合计调整项", () => {
  it("空数组返回 0", () => {
    expect(sumAdjustments()).toBe(0);
    expect(sumAdjustments([])).toBe(0);
  });

  it("正负混合求和：评优 +200 元、迟到 -100 元、缺勤 -200 元 = -100 元", () => {
    const list: PayrollAdjustment[] = [
      { name: "评优", amountCents: 20000 },
      { name: "迟到", amountCents: -10000 },
      { name: "缺勤", amountCents: -20000 },
    ];
    expect(sumAdjustments(list)).toBe(-10000);
  });

  it("名称为空抛 ApiError", () => {
    expect(() => sumAdjustments([{ name: "  ", amountCents: 100 }])).toThrow(ApiError);
  });

  it("金额非整数抛 ApiError", () => {
    expect(() => sumAdjustments([{ name: "迟到", amountCents: 1.5 }])).toThrow(ApiError);
  });
});

describe("applyAdjustments 叠加调整项并重算", () => {
  it("无调整项：金额不变，附带空调整项元数据", () => {
    const r = applyAdjustments(base);
    expect(r.grossSalaryInCents).toBe(1000000);
    expect(r.serviceFeeInCents).toBe(30000);
    expect(r.netSalaryInCents).toBe(970000);
    expect(r.adjustments).toEqual([]);
    expect(r.adjustmentTotalInCents).toBe(0);
    expect(r.grossBeforeAdjustmentInCents).toBe(1000000);
  });

  it("正向调整 +200 元：总工资 1020000，服务费按含调整项重算 ceil(1020000×3%)=30600，实发 989400", () => {
    const r = applyAdjustments(base, [{ name: "评优", amountCents: 20000 }]);
    expect(r.grossSalaryInCents).toBe(1020000);
    expect(r.serviceFeeInCents).toBe(30600);
    expect(r.netSalaryInCents).toBe(989400);
    expect(r.adjustmentTotalInCents).toBe(20000);
    expect(r.grossBeforeAdjustmentInCents).toBe(1000000);
  });

  it("负向调整 -300 元：总工资 970000，服务费 ceil(970000×3%)=29100，实发 940900", () => {
    const r = applyAdjustments(base, [
      { name: "迟到", amountCents: -10000 },
      { name: "缺勤", amountCents: -20000 },
    ]);
    expect(r.grossSalaryInCents).toBe(970000);
    expect(r.serviceFeeInCents).toBe(29100);
    expect(r.netSalaryInCents).toBe(940900);
    expect(r.adjustmentTotalInCents).toBe(-30000);
  });

  it("调整项名称去除首尾空白后落库", () => {
    const r = applyAdjustments(base, [{ name: "  评优  ", amountCents: 20000 }]);
    expect(r.adjustments[0].name).toBe("评优");
  });

  it("大额扣减致总工资为负：实发允许为负、不归零", () => {
    const r = applyAdjustments(base, [{ name: "赔付", amountCents: -1100000 }]);
    expect(r.grossSalaryInCents).toBe(-100000);
    // ceil(-100000 × 3% / 1) = ceil(-3000) = -3000
    expect(r.serviceFeeInCents).toBe(-3000);
    expect(r.netSalaryInCents).toBe(-97000);
  });

  it("自定义服务费率 500bps=5%", () => {
    const r = applyAdjustments(base, [{ name: "评优", amountCents: 20000 }], 500);
    expect(r.grossSalaryInCents).toBe(1020000);
    expect(r.serviceFeeInCents).toBe(51000);
    expect(r.netSalaryInCents).toBe(969000);
  });
});