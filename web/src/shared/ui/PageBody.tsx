import React from "react";
import { cn } from "@/shared/lib/cn";

export interface PageContentProps {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  headerClassName?: string;
}

export function PageBody({
  children,
  className,
  title,
  headerClassName,
}: PageContentProps) {
  return (
    <section
      className={cn(
        "flex flex-1 flex-col rounded-xl border border-border bg-surface text-foreground shadow-sm overflow-hidden",
        className,
      )}
    >
      {title && (
        <div
          className={cn(
            "px-6 py-4 border-b border-border bg-muted/50",
            headerClassName,
          )}
        >
          {typeof title === "string" ? (
            <h3 className="text-md font-semibold">{title}</h3>
          ) : (
            title
          )}
        </div>
      )}
      {children}
    </section>
  );
}
