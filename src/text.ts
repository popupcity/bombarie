export const sentence = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?…]$/.test(trimmed) ? '' : '.'}`;
};

export function folderTitle(folder: string): string {
  const words = folder.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function campaignTitle(folder: string, titles: (string | undefined)[]): string {
  return titles.find((title) => title !== undefined && title.trim() !== '')?.trim() ?? folderTitle(folder);
}
