export function splitParts(body: string): string[] {
  const parts: string[][] = [[]];
  for (const line of body.split('\n')) {
    if (/^[ \t]*---[ \t]*$/.test(line)) parts.push([]);
    else parts[parts.length - 1]!.push(line);
  }
  return parts.map((lines) => lines.join('\n').trim());
}
