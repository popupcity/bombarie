import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadChannels } from './channels.ts';
import { providers } from './connect.ts';
import type { RunDeps } from './run.ts';
import { appsPath, credentialsFrom, readSetting, tokensPath } from './secrets.ts';
import { signingSecret } from './auth.ts';
import { publicPath } from './public-media.ts';
import { ProviderError } from './types.ts';
import { setProgress } from './progress.ts';
import { fileStore } from './state.ts';

export function localDeps(root: string, now: Date): RunDeps {
  return {
    store: fileStore(root),
    channels: loadChannels(root),
    providers,
    credentials: credentialsFrom(tokensPath(), now),
    context: (post) => ({
      fetch,
      publicImage: async (path, options) => {
        const base = await readSetting(appsPath(), 'publicUrl');
        if (!base) throw new ProviderError('set the public address of this app on the Instagram channel page; Instagram fetches the image from there', 'invalid');
        return `${base.replace(/\/+$/, '')}/public/${publicPath(signingSecret(), options?.story ? 'story' : 'jpg', dirname(post.id), path)}`;
      },
      publicVideo: async (path) => {
        const base = await readSetting(appsPath(), 'publicUrl');
        if (!base) throw new ProviderError('set the public address of this app on the Instagram channel page; Instagram fetches the video from there', 'invalid');
        return `${base.replace(/\/+$/, '')}/public/${publicPath(signingSecret(), 'mp4', dirname(post.id), path)}`;
      },
      readMedia: (path) => readFile(join(root, 'posts', dirname(post.id), path)),
      progress: (text) => setProgress(post.id, text)
    }),
    now
  };
}
