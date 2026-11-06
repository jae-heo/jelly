// Claude Code draws its prompt between two horizontal rules near the bottom of
// the screen: "❯ text", continuation rows indented by two columns, then a short
// footer. Rows arrive with dim cells (placeholders and hints) blanked.
const rule = /^─{8,}.*─$/;
const prompt = /^[❯>!#][  ]/;
const FOOTER = 6;

export function agentDraft(rows: string[]): string | null {
  let end = rows.length;
  while (end > 0 && !rows[end - 1]!.trim()) end--;
  const rules: number[] = [];
  for (let row = end - 1; row >= 0 && rules.length < 2; row--) {
    if (rule.test(rows[row]!.trim())) rules.push(row);
    else if (!rules.length && end - row > FOOTER) return null;
  }
  const [bottom, top] = rules;
  if (top === undefined || bottom === undefined || !prompt.test(rows[top + 1] ?? '')) return null;
  const lines = rows.slice(top + 1, bottom);
  if (lines.slice(1).some(line => line && !line.startsWith('  '))) return null;
  return lines.map(line => line.slice(2).trimEnd()).join('\n').replace(/^\n+|\n+$/g, '');
}
