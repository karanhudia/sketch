import type { ComponentProps } from "react";

import { cn } from "@sketch/ui/lib/utils";

export function TabContentContainer({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-4xl", className)} {...props} />;
}
