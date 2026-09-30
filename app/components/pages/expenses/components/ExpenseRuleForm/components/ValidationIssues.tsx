"use client";

import React from "react";
import type { RuleIssue } from "@/lib/logic/ruleSchedule";

interface IProps {
  issues: RuleIssue[];
}

/**
 * The reasons the rule cannot be saved yet. Shown on the Schedule and Review steps, where the Continue /
 * Create button is disabled while any are listed.
 */
const ValidationIssues: React.FC<IProps> = ({ issues }) => {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="p-4 bg-danger/20 border border-danger/30 rounded-lg text-danger space-y-1"
    >
      <p className="font-medium">Fix these before saving:</p>
      <ul className="list-disc pl-5 text-sm">
        {issues.map((issue) => (
          <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
};

export default ValidationIssues;
