const WIDTH = 800;

export async function videoCover(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = url;
    await new Promise<void>((done, fail) => {
      video.onloadedmetadata = () => done();
      video.onerror = () => fail(new Error('unreadable'));
    });
    const seeked = new Promise<void>((done) => (video.onseeked = () => done()));
    video.currentTime = Math.min(1, (video.duration || 2) / 2);
    await seeked;
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * WIDTH);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.82));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
