/**
 * Report read queries: published editions for the archive and reader.
 *
 * Server-only. Public reads expose ONLY status='published' editions —
 * drafts and in-review editions never leave through these queries; the
 * review gate (migration 003 status flow) decides what becomes public.
 * Everything traces to report_editions / report_entries /
 * source_citations; nothing is derived here.
 */
import { query, queryOne } from "@/lib/db";

export interface ReportListRow {
  id: string;
  report_type: string;
  content_class: string;
  title: string;
  summary: string | null;
  season: number | null;
  week_number: number | null;
  week_label: string | null;
  reporting_period: string | null;
  generated_at: Date;
  updated_at: Date;
}

const LIST_COLUMNS = `
  e.id, e.report_type, e.content_class, e.title, e.summary,
  s.year AS season, w.week_number, w.label AS week_label,
  e.reporting_period, e.generated_at, e.updated_at`;

/** Every published edition, newest generated first. */
export async function getPublishedReports(): Promise<ReportListRow[]> {
  const { rows } = await query<ReportListRow>(
    `SELECT ${LIST_COLUMNS}
       FROM report_editions e
       LEFT JOIN seasons s ON s.id = e.season_id
       LEFT JOIN weeks w ON w.id = e.week_id
      WHERE e.status = 'published'
      ORDER BY e.generated_at DESC, e.title ASC`
  );
  return rows;
}

export interface ReportDetailRow extends ReportListRow {
  revision: number;
  methodology_version: string | null;
  dataset_revision: string | null;
  pdf_asset_ref: string | null;
}

export interface ReportEntryRow {
  entry_key: string;
  position: number;
  block_type: string;
  heading: string | null;
  body: string;
}

export interface ReportCitationRow {
  claim_key: string | null;
  url: string;
  publisher: string | null;
  corroboration_status: string | null;
  limitation_note: string | null;
}

/** One published edition by id; null when missing or not published. */
export async function getPublishedReport(
  id: string
): Promise<ReportDetailRow | null> {
  const row = await queryOne<ReportDetailRow>(
    `SELECT ${LIST_COLUMNS},
            e.revision, e.methodology_version, e.dataset_revision,
            e.pdf_asset_ref
       FROM report_editions e
       LEFT JOIN seasons s ON s.id = e.season_id
       LEFT JOIN weeks w ON w.id = e.week_id
      WHERE e.id = $1 AND e.status = 'published'`,
    [id]
  );
  return row ?? null;
}

/** Ordered blocks of an edition. */
export async function getReportEntries(
  editionId: string
): Promise<ReportEntryRow[]> {
  const { rows } = await query<ReportEntryRow>(
    `SELECT entry_key, position, block_type, heading, body
       FROM report_entries
      WHERE report_edition_id = $1
      ORDER BY position ASC`,
    [editionId]
  );
  return rows;
}

/** Citations attached to an edition (entry-specific first, then edition-wide). */
export async function getReportCitations(
  editionId: string
): Promise<ReportCitationRow[]> {
  const { rows } = await query<ReportCitationRow>(
    `SELECT claim_key, url, publisher, corroboration_status, limitation_note
       FROM source_citations
      WHERE report_edition_id = $1
      ORDER BY report_entry_id NULLS LAST, created_at ASC`,
    [editionId]
  );
  return rows;
}
