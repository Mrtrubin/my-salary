"use client";

import { Button, DatePicker, Flex, Space } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { getPresetRange } from "@/lib/domain/settlement/cycle";
import type { DateRangePreset, PeriodRange } from "@/lib/domain/settlement/cycle";

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "当日" },
  { key: "yesterday", label: "昨日" },
  { key: "thisWeek", label: "本周" },
  { key: "thisMonth", label: "本月" },
];

interface PeriodRangeFilterProps {
  /** 已应用的区间（点击「查询」后生效）。 */
  value: PeriodRange;
  onChange: (range: PeriodRange) => void;
  disabled?: boolean;
}

/**
 * 自定义起止日期筛选：快捷区间与日期选择都只改「草稿」，
 * 点击「查询」后才通过 onChange 应用；符合「点击查询按钮后才应用」的约定。
 */
export function PeriodRangeFilter({ value, onChange, disabled }: PeriodRangeFilterProps) {
  const [draft, setDraft] = useState<PeriodRange>(value);

  const activePreset = PRESETS.find((preset) => {
    const range = getPresetRange(preset.key);
    return range.start === draft.start && range.end === draft.end;
  })?.key;

  function applyPreset(preset: DateRangePreset) {
    setDraft(getPresetRange(preset));
  }

  const dirty = draft.start !== value.start || draft.end !== value.end;

  return (
    <Flex align="center" gap={8} wrap>
      <Space.Compact>
        {PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type={activePreset === preset.key ? "primary" : "default"}
            disabled={disabled}
            onClick={() => applyPreset(preset.key)}
          >
            {preset.label}
          </Button>
        ))}
      </Space.Compact>
      <DatePicker.RangePicker
        aria-label="结算日期区间"
        allowClear={false}
        disabled={disabled}
        value={[dayjs(draft.start), dayjs(draft.end)]}
        onChange={(dates) => {
          if (dates?.[0] && dates?.[1]) {
            setDraft({
              start: dates[0].format("YYYY-MM-DD"),
              end: dates[1].format("YYYY-MM-DD"),
            });
          }
        }}
      />
      <Button type="primary" disabled={disabled || !dirty} onClick={() => onChange(draft)}>
        查询
      </Button>
    </Flex>
  );
}
