export interface Message {
  text: string;
  bold?: string;
  view?: string;
}

export type Notify = (message: Message) => Promise<void>;

const MAX_TEXT = 4096;

export function telegram(token: string, chat: string, fetchImpl: typeof fetch = fetch): Notify {
  return async ({ text, bold, view }) => {
    const button = view?.startsWith('https://') ? view : undefined;
    const full = view && !button ? `${text}\n\n${view}` : text;
    const body = full.length > MAX_TEXT ? `${full.slice(0, MAX_TEXT - 1)}…` : full;
    const at = bold ? body.indexOf(bold) : -1;
    let res: Response;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: body,
          disable_web_page_preview: true,
          ...(bold && at >= 0 && { entities: [{ type: 'bold', offset: at, length: bold.length }] }),
          ...(button && { reply_markup: { inline_keyboard: [[{ text: 'View', url: button }]] } })
        })
      });
    } catch {
      throw new Error('Telegram request failed');
    }
    if (!res.ok) throw new Error(`Telegram sendMessage failed (${res.status})`);
  };
}
