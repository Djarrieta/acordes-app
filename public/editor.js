function editorDialog() {
  return document.getElementById("song-editor");
}

function openEditor() {
  const dialog = editorDialog();
  if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-song-edit]")) openEditor();
  const dialog = editorDialog();
  if (event.target === dialog && dialog instanceof HTMLDialogElement) dialog.close();
});

document.addEventListener("htmx:afterSwap", (event) => {
  if (event.detail.target?.id === "song-editor-body") openEditor();
});

document.addEventListener("htmx:responseError", (event) => {
  if (event.detail.target?.id !== "song-editor-body") return;
  if (event.detail.xhr?.status === 409) {
    const dialog = editorDialog();
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  }
});
