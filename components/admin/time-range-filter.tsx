"use client";

import { DownOutlined } from "@ant-design/icons";
import { Button, DatePicker, Dropdown, Flex } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { getPresetRange } from "@/lib/domain/settlement/cycle";
import type { DateRangePreset, PeriodRange } from "@/lib/domain/settlement/cycle";

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "last7Days", label: "近7天" },
  { key: "last30Days", label: "近30天" },
  { key: "thisMonth", label: "本月" },
  { key: "lastMonth", label: "上月" },
];

const ALL = "all";
const CUSTOM = "custom";

interface TimeRangeFilterProps {
  value: PeriodRange | null;
  onChange: (range: PeriodRange | null) => void;
  /** 是否提供「全部时间」选项，选中时为 null。 */
  allowAll?: boolean;
  disabled?: boolean;
}

/**
 * 统一时间维度选择器：触发器仅显示当前选项，点击后竖排展开快捷区间。
 * 点击「自定义」或当前为自定义时，在右侧展开起止日期选择器。
 * 快捷项点击立即应用；近 N 天均含当天。`allowAll` 时额外提供「全部时间」。
 */
export function TimeRangeFilter({ value, onChange, allowAll = false, disabled }: TimeRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  // 外部把区间复位为「全部时间」（value=null）时退出自定义模式，
  // 避免残留的日期选择器。用户从「全部时间」点击自定义不会改变 value，故不受影响。
  useEffect(() => {
    if (value === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部「全部时间」复位，非派生状态
      setCustomOpen(false);
    }
  }, [value]);

  const isAll = value === null;
  const matched = value
    ? PRESETS.find((preset) => {
        const range = getPresetRange(preset.key);
        return range.start === value.start && range.end === value.end;
      })?.key
    : undefined;
  // customOpen 优先：从「全部时间」切到自定义时 value 仍为 null，
  // 不能因 isAll 而判定为非自定义，否则日期选择器无法展开。
  const isCustom = customOpen || (!isAll && matched === undefined);
  const activeKey = isCustom ? CUSTOM : isAll ? ALL : (matched ?? CUSTOM);
  const activeLabel = isCustom
    ? "自定义"
    : isAll
      ? "全部时间"
      : (PRESETS.find((preset) => preset.key === matched)?.label ?? "自定义");

  function handleSelect(key: string) {
    setOpen(false);
    if (key === ALL) {
      setCustomOpen(false);
      onChange(null);
      return;
    }
    if (key === CUSTOM) {
      setCustomOpen(true);
      return;
    }
    setCustomOpen(false);
    onChange(getPresetRange(key as DateRangePreset));
  }

  return (
    <Flex align="center" gap={8} wrap>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        disabled={disabled}
        trigger={["click"]}
        menu={{
          selectedKeys: [activeKey],
          onClick: ({ key }) => handleSelect(key),
          items: [
            ...PRESETS.map((preset) => ({ key: preset.key, label: preset.label })),
            ...(allowAll ? [{ key: ALL, label: "全部时间" }] : []),
            { key: CUSTOM, label: "自定义" },
          ],
        }}
      >
        <Button disabled={disabled}>
          {activeLabel}
          <DownOutlined style={{ fontSize: 10, marginInlineStart: 6 }} />
        </Button>
      </Dropdown>
      {isCustom ? (
        <DatePicker.RangePicker
          aria-label="自定义日期区间"
          allowClear={false}
          disabled={disabled}
          value={value ? [dayjs(value.start), dayjs(value.end)] : null}
          onChange={(dates) => {
            if (dates?.[0] && dates?.[1]) {
              onChange({
                start: dates[0].format("YYYY-MM-DD"),
                end: dates[1].format("YYYY-MM-DD"),
              });
            }
          }}
        />
      ) : null}
    </Flex>
  );
}
