import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "glow-accent bg-primary text-primary-foreground hover:opacity-90",
        outline: "border-border bg-transparent hover:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        tinted: "glow-accent border-primary/45 bg-tint-accent text-primary hover:bg-primary/12",
        buy: "glow-up border-up/40 bg-tint-up text-up hover:bg-up/12",
        sell: "glow-down border-down/40 bg-tint-down text-down hover:bg-down/12",
        ghost: "text-ink-2 hover:bg-muted hover:text-foreground",
        destructive: "bg-transparent text-destructive hover:bg-destructive/10",
        link: "h-auto p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        // 44px is the smallest comfortable touch target, so it is the default rather than the exception.
        default: "h-11 px-4",
        sm: "h-9 rounded-md px-3 text-[13px]",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
        "icon-sm": "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
