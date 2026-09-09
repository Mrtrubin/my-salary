import { Input as HeroInput } from "@heroui/react";
import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * HeroUI Input 兼容封装：保持原生 input 属性透传（含 RHF register 展开）。
 */
export const Input = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
    size?: "sm" | "md" | "lg";
  }
>(({ className, size, ...props }, ref) => (
  <HeroInput
    ref={ref}
    fullWidth
    size={size as never}
    className={className}
    {...props}
  />
));
Input.displayName = "Input";

export function FormField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

type SelectOption = { id: string; name: string };

/**
 * 轻量自定义下拉：显示选中文字 + 下拉箭头，点击展开选项，点击外部关闭。
 * 与页面内其他自定义下拉保持一致的视觉风格。
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "请选择",
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-sm"
      >
        <span className={selected ? "" : "text-slate-400"}>
          {selected ? selected.name : placeholder}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open ? (
        <ul className="absolute z-20 mt-1 max-h-60 w-max min-w-full max-w-[16rem] overflow-auto rounded border bg-white py-1 shadow-lg">
          {options.map((o) => {
            const active = o.id === value;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm whitespace-nowrap hover:bg-slate-100 ${active ? "bg-indigo-50 text-indigo-600" : ""}`}
                >
                  <span>{o.name}</span>
                  {active ? (
                    <svg
                      className="h-4 w-4 shrink-0"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}