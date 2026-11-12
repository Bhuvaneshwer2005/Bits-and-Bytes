import type { Section } from "../types/deck";

export default function OutlineList({ sections }: { sections: Section[] }) {
  return (
    <ol className="list" aria-label="Sections">
      {sections.map((s) => (
        <li key={s.id} className="card-box stack">
          <strong>
            {s.id.replace("s", "")} · {s.title}
          </strong>
          <span className="muted">
            {s.page_range[0] === s.page_range[1] ? `Page ${s.page_range[0]}` : `Pages ${s.page_range[0]}-${s.page_range[1]}`}
          </span>
          {s.summary && <span>{s.summary}</span>}
        </li>
      ))}
    </ol>
  );
}
