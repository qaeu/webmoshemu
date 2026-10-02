/**
 * Drag-and-drop handling.
 *
 * @module
 */

// ── Drag and drop a video file to replace the background ────────────────────
/**
 * Accept file drops anywhere on the window, toggling the `dragging` body class
 * while files are dragged over it.
 *
 * @param onVideo - Called with the first dropped `video/*` file, if any.
 */
export function attachDrop(onVideo: (file: File) => void): void {
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
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('video/'));
    if (file) onVideo(file);
  });
}
