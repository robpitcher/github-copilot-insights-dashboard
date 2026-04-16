import type { ReactNode } from "react";
import { Breadcrumb } from "@/components/layout/breadcrumb";
import type { BreadcrumbItem } from "@/types/filters";

interface PageHeaderProps {
  /** Main page title. */
  title: string;
  /** Subtitle/description shown below the title. */
  subtitle?: ReactNode;
  /** Optional breadcrumb trail shown above the title. */
  breadcrumb?: BreadcrumbItem[];
  /** Right-aligned actions (buttons, filters, PdfButton, etc.). */
  actions?: ReactNode;
}

/**
 * Unified page header used by every dashboard page.
 *
 * Layout: breadcrumb (optional) → title (h1) → subtitle on the left;
 * actions on the right. Stacks on narrow viewports, wraps responsively.
 */
export function PageHeader({ title, subtitle, breadcrumb, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
