import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-success/20 text-foreground",
        warn: "border-transparent bg-warn/30 text-foreground",
        error: "border-transparent bg-error/20 text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        mqtt: "border-transparent bg-status-label text-foreground",
        sql: "border-transparent bg-experimental/20 text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
