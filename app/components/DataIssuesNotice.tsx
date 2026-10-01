"use client";

import React from "react";
import { Alert } from "@/components/common";
import { useFinancial } from "@/contexts/FinancialContext";
import { describeDataIssues } from "@/lib/utils/sanitizeData";

/**
 * Non-blocking notice for documents that failed validation at the ingestion boundary
 * (null / NaN / non-numeric money; see lib/utils/sanitizeData.ts). The records stay visible with their bad
 * numbers set to 0 and rules switched off, so the user can open and fix them; nothing is dropped silently.
 */
const DataIssuesNotice: React.FC = () => {
  const { dataIssues } = useFinancial();
  const summary = describeDataIssues(dataIssues);
  if (!summary) return null;

  return (
    <div className="relative z-10 px-4 pt-4 md:px-8" data-testid="data-issues-notice">
      <Alert variant="warning" title={summary.title} dismissible>
        {summary.names.join(", ")}
        {summary.more > 0 ? ` and ${summary.more} more` : ""}. A missing or unreadable amount is shown as
        0 and the item is switched off so it cannot distort your totals. Open it under Income or Expenses
        to correct the amount, then switch it back on.
      </Alert>
    </div>
  );
};

export default DataIssuesNotice;
