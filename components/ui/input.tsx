import { Input as HeroInput } from "@heroui/react";
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * HeroUI Input 兼容封装：保持原生 input 属性透传（含 RHF register 展开）。
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <HeroInput ref={ref} fullWidth className={className} {...props} />
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