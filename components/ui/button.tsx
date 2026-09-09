import { Button as HeroButton } from "@heroui/react";
import { forwardRef, type ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

type HeroButtonProps = ComponentProps<typeof HeroButton>;

export interface ButtonProps
  extends Omit<HeroButtonProps, "onPress" | "isDisabled" | "variant" | "size" | "isPending"> {
  variant?: Variant;
  size?: Size;
  /** 原生 disabled,内部映射为 HeroUI 的 isDisabled。 */
  disabled?: boolean;
  /** 兼容旧调用:内部映射为 HeroUI 的 onPress。 */
  onClick?: () => void;
}

/**
 * HeroUI Button 兼容封装:保持旧 API(variant/size/onClick/disabled),
 * 内部转为 HeroUI(React Aria) 的 onPress / isDisabled。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "md", className, disabled, onClick, ...props },
    ref,
  ) => (
    <HeroButton
      ref={ref}
      variant={variant}
      size={size}
      className={className}
      isDisabled={disabled}
      onPress={onClick}
      {...props}
    />
  ),
);
Button.displayName = "Button";