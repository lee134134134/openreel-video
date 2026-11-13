import * as React from "react"

import { cn } from "../lib/utils"

export interface ToolcraftButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled">,
    Pick<
      React.AnchorHTMLAttributes<HTMLAnchorElement>,
      "download" | "target" | "rel"
    > {
  as?: React.ElementType
  disabled?: boolean
  endContent?: React.ReactNode
  href?: string
  icon?: React.ReactNode
  isDisabled?: boolean
  isLoading?: boolean
  label?: React.ReactNode
  size?: "sm" | "md" | "lg" | string
  variant?: string
}

export const ToolcraftButton = React.forwardRef<HTMLElement, ToolcraftButtonProps>(
  (
    {
      as,
      children,
      className,
      disabled,
      endContent,
      icon,
      isDisabled = false,
      isLoading = false,
      label,
      size = "md",
      type,
      variant = "secondary",
      ...props
    },
    ref,
  ) => {
    const Component = as ?? (props.href ? "a" : "button")
    const isButton = Component === "button"
    const resolvedDisabled = disabled || isDisabled || isLoading
    const labelText = getReactNodeText(label).trim()

    return React.createElement(
      Component,
      {
        ref,
        "aria-disabled": !isButton && resolvedDisabled ? true : undefined,
        "aria-label": props["aria-label"] ?? (labelText !== "" ? labelText : undefined),
        className: cn(
          "inline-flex min-w-0 items-center justify-center gap-1.5 font-semibold outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          buttonSizeClassName[size] ?? buttonSizeClassName.md,
          buttonVariantClassName[variant] ?? buttonVariantClassName.secondary,
          resolvedDisabled && !isButton && "pointer-events-none opacity-50",
          className,
        ),
        disabled: isButton ? resolvedDisabled : undefined,
        type: isButton ? type ?? "button" : undefined,
        ...props,
      },
      children ?? (
        <>
          {isLoading ? (
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80"
            />
          ) : icon ? (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {icon}
            </span>
          ) : null}
          {label ? <span className="truncate">{label}</span> : null}
          {endContent ? (
            <span className="flex shrink-0 items-center justify-center">
              {endContent}
            </span>
          ) : null}
        </>
      ),
    )
  },
)

ToolcraftButton.displayName = "ToolcraftButton"

const buttonSizeClassName: Record<string, string> = {
  lg: "h-10 px-4 text-[13px]",
  md: "h-8 px-3 text-[12px]",
  sm: "h-7 px-2.5 text-[12px]",
}

const buttonVariantClassName: Record<string, string> = {
  // DESIGN.md: primary CTA = Apple pill button (9999px), hover #0077ED,
  // pressed #0066CC, with the scale(0.95) tap feedback via active:scale.
  primary:
    "rounded-full bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-strong active:scale-[0.97]",
  secondary:
    "rounded-lg border border-border bg-bg-2 text-fg-2 hover:bg-bg-3 hover:text-fg",
  destructive:
    "rounded-full bg-status-error text-white hover:bg-status-error/90",
  ghost: "rounded-lg bg-transparent text-fg-2 hover:bg-bg-2 hover:text-fg",
}

function getReactNodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getReactNodeText).join("")
  }

  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getReactNodeText(node.props.children)
  }

  return ""
}
