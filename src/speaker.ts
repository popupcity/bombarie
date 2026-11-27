import type { Channels } from './channels.ts';
import type { Channel, Credentials, Speaker } from './types.ts';

export const isPerson = (channel: Channel | undefined): boolean => channel?.platform === 'linkedin' && channel.kind !== 'organization' && Boolean(channel.urn?.startsWith('urn:li:person:'));

export const speakers =
  (channels: Channels, credentials: (channel: string) => Promise<Credentials | null>) =>
  async (key: string): Promise<Speaker> => {
    const channel = channels[key];
    if (!channel || !isPerson(channel)) throw new Error(`${key} is not a connected personal LinkedIn channel`);
    const found = await credentials(key);
    if (!found) throw new Error(`${channel.name ?? key} is not connected`);
    return { urn: channel.urn as string, credentials: found };
  };
