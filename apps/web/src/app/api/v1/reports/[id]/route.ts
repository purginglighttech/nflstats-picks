import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import {
  getPublishedReport,
  getReportCitations,
  getReportEntries,
} from "@/lib/reports";
import { toListItem } from "../route";

/**
 * GET /api/v1/reports/[id] — one published edition with its ordered
 * entries and source citations. Unpublished editions read as 404.
 * Public read.
 */
export const GET = withApi(
  "reports:detail",
  {
    auth: "none",
    params: z.object({ id: z.string().uuid() }),
  },
  async (_req, ctx) => {
    const report = await getPublishedReport(ctx.params.id);
    if (!report) {
      throw new ApiErrorException(
        404,
        "report_not_found",
        `No published report: ${ctx.params.id}.`
      );
    }
    const [entries, citations] = await Promise.all([
      getReportEntries(report.id),
      getReportCitations(report.id),
    ]);
    return NextResponse.json(
      v1.ReportDetailResponseSchema.parse({
        report: {
          ...toListItem(report),
          revision: report.revision,
          methodology_version: report.methodology_version,
          dataset_revision: report.dataset_revision,
          pdf_asset_ref: report.pdf_asset_ref,
        },
        entries: entries.map((e) => ({
          entry_key: e.entry_key,
          position: e.position,
          block_type: e.block_type as v1.ReportBlockType,
          heading: e.heading,
          body: e.body,
        })),
        citations: citations.map((c) => ({
          claim_key: c.claim_key,
          url: c.url,
          publisher: c.publisher,
          corroboration_status: c.corroboration_status as
            | v1.ReportCitation["corroboration_status"],
          limitation_note: c.limitation_note,
        })),
      })
    );
  }
);
