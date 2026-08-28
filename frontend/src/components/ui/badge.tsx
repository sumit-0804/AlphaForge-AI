import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Badges stay quiet by design; only up and down are allowed to carry colour.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-muted text-ink-2",
        outline: "border border-border text-ink-2",
        accent: "bg-accent-soft text-primary",
        up: "bg-up/12 text-up",
        down: "bg-down/12 text-down",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      { className: cn(badgeVariants({ variant }), className) },
      props
    ),
    render,
    state: { slot: "badge", variant },
  })
}

export { Badge, badgeVariants }
