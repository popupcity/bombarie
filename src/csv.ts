export type Row = Record<string, string>;

const cell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const toCsv = (columns: string[], rows: Row[]): string => `${[columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))].map((line) => line.map(cell).join(',')).join('\n')}\n`;

export function fromCsv(text: string): Row[] {
  const lines: string[][] = [];
  let line: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[i + 1] === '"') value += text[++i]!;
      else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      line.push(value);
      value = '';
    } else if (char === '\n') {
      lines.push([...line, value]);
      line = [];
      value = '';
    } else if (char !== '\r') value += char;
  }
  if (value !== '' || line.length > 0) lines.push([...line, value]);
  const [columns = [], ...rest] = lines;
  return rest.map((cells) => Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? ''])));
}
