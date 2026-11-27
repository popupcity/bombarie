const zone = document.getElementById('statistics-dropzone');
const input = document.getElementById('statistics-file') as HTMLInputElement | null;

if (zone && input) {
  input.addEventListener('change', () => input.form?.requestSubmit());
  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  let depth = 0;
  const leave = () => {
    depth = 0;
    zone.removeAttribute('data-active');
  };
  document.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    depth += 1;
    zone.setAttribute('data-active', '');
  });
  document.addEventListener('dragleave', (event) => {
    if (carriesFiles(event) && --depth <= 0) leave();
  });
  document.addEventListener('dragover', (event) => {
    if (carriesFiles(event)) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    leave();
    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0) return;
    input.files = dropped;
    input.form?.requestSubmit();
  });
}
