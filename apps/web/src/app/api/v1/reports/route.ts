import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { withApi } from "@/lib/api/with-api";
import { getPublishedReports, toReportListItem } from "@/lib/reports";

/**
 * GET /api/v1/reports — every published report edition, newest first.
 * Drafts and in-review editions are never exposed. Public read.
 */
export const GET = withApi("reports:list", { auth: "none" }, async () => {
  const rows = await getPublishedReports();
  return NextResponse.json(
    v1.ReportListResponseSchema.parse({ reports: rows.map(toReportListItem) })
  );
});
