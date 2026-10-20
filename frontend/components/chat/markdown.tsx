import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown subset for assistant replies: paragraphs, bulleted and
 * numbered lists, headings (shown as bold lines), **bold**, *italic* and `code`.
 *
 * Safety: everything is rendered as React text nodes. Raw HTML, images and links in the
 * model's text are never interpreted (sources are shown separately, from validated
 * citations only), so a reply can't inject markup or a link to an arbitrary site.
 */

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number };

const BULLET = /^\s*(?:[-*•‣·]|–)\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] ?? "" });
    } else if (bullet) {
      if (current?.kind !== "ul") {
        flush();
        current = { kind: "ul", items: [] };
      }
      current.items.push(bullet[1] ?? "");
    } else if (numbered) {
      if (current?.kind !== "ol") {
        flush();
        current = { kind: "ol", items: [], start: Number(numbered[1]) || 1 };
      }
      current.items.push(numbered[2] ?? "");
    } else if (current && (current.kind === "ul" || current.kind === "ol")) {
      // A wrapped continuation of the previous list item.
      const items = current.items;
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    } else {
      if (current?.kind !== "p") {
        flush();
        current = { kind: "p", lines: [] };
      }
      current.lines.push(line.trim());
    }
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-surface-muted px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.length > 2 && ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_")))) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-3 leading-7" dir="auto">
      {parseBlocks(text).map((block, i) => {
        if (block.kind === "h") {
          return (
            <p key={i} className="font-semibold">
              {inline(block.text)}
            </p>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 ps-6 marker:text-primary">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={i} start={block.start} className="list-decimal space-y-1 ps-6 marker:text-primary">
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
