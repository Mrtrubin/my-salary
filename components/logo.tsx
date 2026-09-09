import Image from "next/image";

type LogoProps = {
  /** 整体尺寸（含留白），单位 px。默认 40 */
  size?: number;
  /** logo 图片相对容器的内边距比例（0-0.5），默认 0.16，用于防止圆角裁剪 */
  padding?: number;
  /** 圆角类名，默认 rounded-lg */
  rounded?: string;
  /** 图片替代文本 */
  alt?: string;
  /** 是否优先加载 */
  priority?: boolean;
  /** 附加类名（作用于外层容器） */
  className?: string;
};

/**
 * 站点 Logo 组件。
 *
 * 由于 logo 图案几乎铺满整个画布，直接对图片使用圆角会裁掉四角内容。
 * 这里在外层容器加上留白（padding）与背景色，圆角只裁剪留白区域，
 * 从而保证 logo 主体完整显示。
 */
export function Logo({
  size = 40,
  padding = 0.16,
  rounded = "rounded-lg",
  alt = "MY SALARY",
  priority = false,
  className = "",
}: LogoProps) {
  const pad = Math.round(size * padding);
  const inner = size - pad * 2;

  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden bg-white ${rounded} ${className}`}
      style={{ width: size, height: size, padding: pad }}
    >
      <Image
        src="/logo.svg"
        alt={alt}
        width={inner}
        height={inner}
        priority={priority}
        style={{ width: inner, height: inner }}
      />
    </span>
  );
}