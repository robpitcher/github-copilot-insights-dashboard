import type { ReactNode } from "react";
import { Info } from "lucide-react";

interface ReportBannerProps {
  /** Short heading, e.g. "About this report". */
  title: string;
  /** One or two sentences summarizing what the report is for. */
  body: ReactNode;
}

/**
 * Unified "About this report" banner shown near the top of every dashboard
 * report/page. It gives readers a short, consistent summary of what the report
 * is for and where its data comes from.
 */
export function ReportBanner({ title, body }: ReportBannerProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500 dark:text-blue-400" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">{body}</p>
      </div>
    </div>
  );
}
