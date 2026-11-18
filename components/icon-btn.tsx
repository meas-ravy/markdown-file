"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function IconBtn({ label, active, className, ...props }: ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className={cn("text-muted-foreground hover:text-foreground", active && "bg-accent text-sky-600 dark:text-sky-400", className)}
            {...props}
          />
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
