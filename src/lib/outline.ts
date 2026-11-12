import { z } from "zod";
import type { Section } from "../types/deck";

const rawSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().default(""),
        page_range: z.tuple([z.number().int(), z.number().int()]),
      }),
    )
    .min(1)
    .max(8),
});

export class OutlineError extends Error {}

/**
 * Validates the model's outline for pages [from, to] and repairs small boundary slips
 * (gaps, overlaps, a wrong first or last page) so the sections cover every page exactly once.
 * Throws OutlineError if the outline is unusable.
 */
export function normalizeOutline(input: unknown, from: number, to: number): Section[] {
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) throw new OutlineError("outline does not match the schema");

  const pageCount = to - from + 1;
  const minSections = Math.min(3, pageCount);
  const items = [...parsed.data.sections].sort((a, b) => a.page_range[0] - b.page_range[0]);
  if (items.length < minSections) throw new OutlineError("too few sections");
  if (items.length > pageCount) throw new OutlineError("more sections than pages");

  // Snap each section to start right after the previous one ends.
  let start = from;
  const sections: Section[] = items.map((item, i) => {
    const isLast = i === items.length - 1;
    let end = isLast ? to : Math.min(to, Math.max(item.page_range[1], start));
    // leave at least one page for every later section
    end = Math.min(end, to - (items.length - 1 - i));
    const section: Section = {
      id: `s${i + 1}`,
      title: item.title.trim(),
      summary: item.summary.trim(),
      page_range: [start, end],
    };
    start = end + 1;
    return section;
  });

  if (sections.some((s) => s.page_range[0] > s.page_range[1])) throw new OutlineError("empty section");
  return sections;
}
