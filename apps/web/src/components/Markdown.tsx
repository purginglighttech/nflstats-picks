import type { ReactNode } from 'react';

/**
 * Minimal markdown renderer for report entry bodies.
 *
 * Deliberately a subset — the pipeline authors entries in this dialect:
 * headings (# to ####), paragraphs, bold (**), italic (*), inline code,
 * links [text](https://...) (http/https only), unordered (- or *) and
 * ordered (1.) lists, blockquotes (>), horizontal rules (---), fenced
 * code blocks, and pipe tables with a --- separator row.
 *
 * Everything renders as React nodes, so raw HTML in a body is shown as
 * text, never injected. No external dependency: the dialect is ours,
 * the renderer is auditable in one file.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize on the inline constructs we support.
  const pattern =
    /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith('**')) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded px-1 py-0.5 text-[0.9em]"
          style={{ background: 'var(--surface-raised, var(--surface))' }}
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      const linkMatch = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(tok);
      if (linkMatch) {
        nodes.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s:|-]+\|?$/.test(line.trim()) && line.includes('-');
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockIdx = 0;
  const key = () => `md-${blockIdx++}`;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <pre
          key={key()}
          className="overflow-x-auto rounded-lg border p-3 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          {buf.join('\n')}
        </pre>
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], key());
      if (level === 1) {
        blocks.push(
          <h2 key={key()} className="mt-6 text-2xl font-bold tracking-tight">
            {content}
          </h2>
        );
      } else if (level === 2) {
        blocks.push(
          <h3 key={key()} className="mt-6 text-xl font-bold tracking-tight">
            {content}
          </h3>
        );
      } else {
        blocks.push(
          <h4 key={key()} className="mt-5 text-lg font-semibold">
            {content}
          </h4>
        );
      }
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(
        <hr key={key()} style={{ borderColor: 'var(--border)' }} className="my-6" />
      );
      i++;
      continue;
    }

    // Pipe table: header row followed by a separator row
    if (
      line.trim().startsWith('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key()} className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {headers.map((h, hi) => (
                  <th
                    key={hi}
                    className="border-b px-3 py-2 text-left font-semibold"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {renderInline(h, `th-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {headers.map((_, ci) => (
                    <td
                      key={ci}
                      className="border-b px-3 py-2 align-top"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {renderInline(row[ci] ?? '', `td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote (consecutive > lines)
    if (line.trimStart().startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote
          key={key()}
          className="my-4 border-l-4 pl-4"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          {renderInline(buf.join(' '), key())}
        </blockquote>
      );
      continue;
    }

    // Lists (consecutive items of the same kind)
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    const olMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const itemRe = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length) {
        const im = itemRe.exec(lines[i]);
        if (!im) break;
        items.push(im[1]);
        i++;
      }
      const listItems = items.map((item, ii) => (
        <li key={ii}>{renderInline(item, `li-${ii}`)}</li>
      ));
      blocks.push(
        ordered ? (
          <ol key={key()} className="my-4 list-decimal space-y-1 pl-6">
            {listItems}
          </ol>
        ) : (
          <ul key={key()} className="my-4 list-disc space-y-1 pl-6">
            {listItems}
          </ul>
        )
      );
      continue;
    }

    // Paragraph: consecutive plain lines joined with spaces
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith('>') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].trimStart().startsWith('```')
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key()} className="my-4 leading-relaxed">
        {renderInline(buf.join(' '), key())}
      </p>
    );
  }

  return <div>{blocks}</div>;
}
