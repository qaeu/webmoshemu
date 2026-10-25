/**
 * Drag-and-drop handling.
 *
 * @module
 */

// ── Drag and drop a video or image file ─────────────────────────────────────
/**
 * Accept file drops anywhere on the window, toggling the `dragging` body class
 * while files are dragged over it.
 *
 * @param onVideo - Called with the first dropped `video/*` file, if any.
 * @param onImage - Called with the first dropped `image/*` file if no video was dropped.
 */
export function attachDrop(onVideo: (file: File) => void, onImage: (file: File) => void): void {
  let drags = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (drags++ === 0) document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    if (drags && --drags === 0) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    drags = 0;
    document.body.classList.remove('dragging');
    const files = [...(e.dataTransfer?.files ?? [])];
    const video = files.find((f) => f.type.startsWith('video/'));
    const image = files.find((f) => f.type.startsWith('image/'));
    if (video) onVideo(video);
    else if (image) onImage(image);
  });
}
