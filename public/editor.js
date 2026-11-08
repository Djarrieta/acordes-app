document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("[data-song-edit]")) {
    window.setSongView?.("editor");
  }
});

document.addEventListener("htmx:afterSwap", (event) => {
  if (event.detail.target?.id === "song-editor-body") {
    window.setSongView?.("editor");
    return;
  }
  if (event.detail.target?.id !== "song-container") return;
  const card = event.detail.target.querySelector(".song-card");
  if (card?.dataset.view !== "editor") return;
  const body = card.querySelector("#song-editor-body");
  const id = card.dataset.songId;
  if (body && id && !body.querySelector(".song-editor-inner")) {
    window.htmx.ajax("GET", `/songs/${id}/edit`, {
      target: "#song-editor-body",
      swap: "innerHTML",
    });
  }
});
