// Markdown renderer for module READMEs.
// Handles: headings, paragraphs, lists, blockquotes, fenced code, inline
// bold / italic / code / links. Images are dropped (shown in the gallery).
// HTML blocks and inline HTML are rendered via dangerouslySetInnerHTML
// (script tags and event handlers stripped).

const HTML_TAG_RE = /<[a-zA-Z/][^>]*>/;

function sanitize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
}

function inline(text, key) {
  // Drop image syntax entirely (gallery handles images).
  let t = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // If text contains HTML tags, hand off to the browser parser.
  if (HTML_TAG_RE.test(t)) {
    return [<span key={key} dangerouslySetInnerHTML={{ __html: sanitize(t) }} />];
  }

  const nodes = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(t)) !== null) {
    if (m.index > last) nodes.push(t.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      nodes.push(<code key={`${key}-${i}`}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={`${key}-${i}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={`${key}-${i}`}>{tok.slice(1, -1)}</em>);
    } else {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      nodes.push(
        <a key={`${key}-${i}`} href={mm[2]} target="_blank" rel="noreferrer">
          {mm[1]}
        </a>
      );
    }
    last = m.index + tok.length;
    i += 1;
  }
  if (last < t.length) nodes.push(t.slice(last));
  return nodes;
}

export default function Markdown({ source }) {
  if (!source) return null;
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    let line = lines[i];

    // fenced code
    if (line.trim().startsWith("```")) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(
        <pre key={key++} className="md-code">
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // HTML block (line starts with an HTML tag)
    if (/^<[a-zA-Z/!]/.test(line.trim())) {
      const buf = [line];
      i += 1;
      while (i < lines.length && lines[i].trim()) {
        buf.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <div key={key++} dangerouslySetInnerHTML={{ __html: sanitize(buf.join("\n")) }} />
      );
      continue;
    }

    // heading
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length + 1, 6);
      const Tag = `h${lvl}`;
      blocks.push(<Tag key={key++}>{inline(h[2], key)}</Tag>);
      i += 1;
      continue;
    }

    // list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push(
        <ul key={key++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={key++}>{inline(buf.join(" "), key)}</blockquote>
      );
      continue;
    }

    // blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // paragraph (gather until blank)
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*+>]\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !/^<[a-zA-Z/!]/.test(lines[i].trim())
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    const text = buf.join(" ");
    if (text.trim()) blocks.push(<p key={key++}>{inline(text, key)}</p>);
  }

  return <div className="md">{blocks}</div>;
}
