import { VARIANT_TYPES } from '../../src/campaign.ts';
import { FEED_ONLY } from '../../src/types.ts';
import type { ChannelInfo } from '../../src/types.ts';

export type VariantOption = ChannelInfo & { type: string | null; base: string };

export const variantOptions = (infos: ChannelInfo[]): VariantOption[] =>
  infos
    .filter((info) => !FEED_ONLY.includes(info.platform))
    .flatMap((info) => [null, ...(VARIANT_TYPES[info.platform] ?? [])].map((type) => ({ ...info, type, base: type ? `${info.name}-${type}` : info.name })));
