import { describe, expect, it } from "vitest";
import {
  buildPerformanceCopyText,
  toHoursText,
  type PerfCopyMember,
} from "@/app/(user)/user/performance/performanceCopy";

const member = (extra: Partial<PerfCopyMember> = {}): PerfCopyMember => ({
  name: "甲",
  noPerf: false,
  note: null,
  pointsAmount: 0,
  pointId: "p1",
  pointName: "音浪",
  ...extra,
});

describe("业绩汇总文案（提交汇总与卡片复制共用格式）", () => {
  it("单一绩效点：个人不带单位，合计用「总{点}」", () => {
    const text = buildPerformanceCopyText({
      perfDate: "2026-09-06",
      teamName: "水晶之恋",
      broadcastMinutes: 367,
      members: [
        member({ name: "甲", pointsAmount: 12345 }),
        member({ name: "乙", pointsAmount: 100 }),
      ],
    });

    expect(text).toBe([
      "9月6日 水晶之恋",
      "开播情况汇总",
      "总开播时 6.1",
      "个人业绩",
      "甲：12,345",
      "乙：100",
      "总音浪 12,445",
    ].join("\n"));
  });

  it("多个绩效点：个人带单位，逐点合计", () => {
    const text = buildPerformanceCopyText({
      perfDate: "2026-09-06",
      teamName: "水晶之恋",
      broadcastMinutes: 120,
      members: [
        member({ name: "甲", pointsAmount: 10, pointId: "a", pointName: "音浪" }),
        member({ name: "乙", pointsAmount: 5, pointId: "b", pointName: "人气" }),
      ],
    });

    expect(text).toContain("甲：10（音浪）");
    expect(text).toContain("乙：5（人气）");
    expect(text).toContain("总音浪 10");
    expect(text).toContain("总人气 5");
  });

  it("休息/停播成员显示备注，缺省「休息」", () => {
    const text = buildPerformanceCopyText({
      perfDate: "2026-09-06",
      teamName: "T",
      broadcastMinutes: 0,
      members: [
        member({ name: "甲", noPerf: true, note: "停播" }),
        member({ name: "乙", noPerf: true, note: null }),
      ],
    });

    expect(text).toContain("甲：停播");
    expect(text).toContain("乙：休息");
    expect(text).toContain("总音浪 0");
  });
});

describe("toHoursText：分钟 → 小时文本", () => {
  it("整点去小数，否则保留一位", () => {
    expect(toHoursText(360)).toBe("6");
    expect(toHoursText(367)).toBe("6.1");
    expect(toHoursText(0)).toBe("0");
  });
});
