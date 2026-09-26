import { describe, expect, it } from "vitest";
import {
  OFF_AIR_NOTE,
  REST_NOTE,
  recordFromStatus,
  statusFromRecord,
} from "@/lib/domain/performance/status";

describe("业绩三种情况：由落库字段还原", () => {
  it("no_perf=false 一律为正常流水", () => {
    expect(statusFromRecord(false, null)).toBe("normal");
    expect(statusFromRecord(false, "停播")).toBe("normal");
  });

  it("无绩效且备注为固定「停播」时识别为停播", () => {
    expect(statusFromRecord(true, OFF_AIR_NOTE)).toBe("offair");
    expect(statusFromRecord(true, ` ${OFF_AIR_NOTE} `)).toBe("offair");
  });

  it("其余无绩效记录视为休息（含自定义备注）", () => {
    expect(statusFromRecord(true, REST_NOTE)).toBe("rest");
    expect(statusFromRecord(true, "请假")).toBe("rest");
    expect(statusFromRecord(true, null)).toBe("rest");
  });
});

describe("业绩三种情况：提交时映射为落库字段", () => {
  it("正常不写无绩效字段", () => {
    expect(recordFromStatus("normal")).toEqual({ noPerf: false, noPerfNote: null });
  });

  it("停播使用固定备注，忽略传入的休息备注", () => {
    expect(recordFromStatus("offair", "随便写")).toEqual({ noPerf: true, noPerfNote: OFF_AIR_NOTE });
  });

  it("休息缺省用「休息」，自定义备注去空并截断 20 字", () => {
    expect(recordFromStatus("rest")).toEqual({ noPerf: true, noPerfNote: REST_NOTE });
    expect(recordFromStatus("rest", "  请假  ")).toEqual({ noPerf: true, noPerfNote: "请假" });
    expect(recordFromStatus("rest", "x".repeat(30)).noPerfNote).toHaveLength(20);
  });

  it("往返一致：rest/offair 映射后可原样还原", () => {
    for (const status of ["normal", "rest", "offair"] as const) {
      const record = recordFromStatus(status, "自定义");
      expect(statusFromRecord(record.noPerf, record.noPerfNote)).toBe(status);
    }
  });
});
