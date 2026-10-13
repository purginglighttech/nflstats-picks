import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { withApi } from "@/lib/api/with-api";
import { getPublishedReports, type ReportListRow } from "@/lib/reports";

export function toListItem(r: ReportListRow) {
  return {
    id: r.id,
    report_type: r.report_type as v1.ReportType,
    content_class: r.content_class as v1.ReportContentClass,
    title: r.title,
    summary: r.summary,
    season: r.season,
    week_number: r.week_number,
    week_label: r.week_label,
    reporting_period: r.reporting_period,
    generated_at: r.generated_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

/**
 * GET /api/v1/reports — every published report edition, newest first.
 * Drafts and in-review editions are never exposed. Public read.
 */
export const GET = withApi("reports:list", { auth: "none" }, async () => {
  const rows = await getPublishedReports();
  return NextResponse.json(
    v1.ReportListResponseSchema.parse({ reports: rows.map(toListItem) })
  );
});
