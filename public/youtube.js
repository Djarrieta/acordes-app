const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

let activeSection = null;
let optionsProgrammaticChange = false;
let player = null;
let playerVideoId = null;
let apiLoading = false;
let pendingPlayback = null;
let markMode = false;
let progressSeeking = false;
let playbackTimer = null;
let pollTimer = null;
let highlightedChordIndex = null;
let chordDiagramRequest = 0;
let requestedAccompanimentChord = "";
const chordDiagramCache = new Map();
const LEGACY_PREFERENCES_KEY = "acordes-youtube-videos";
const migrationChecked = new Set();

function legacyPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(LEGACY_PREFERENCES_KEY) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch (error) {
    console.error("No se pudieron leer los videos guardados en este navegador:", error);
    return {};
  }
}

function offerLegacyMigration(card, section) {
  if (!card || card.dataset.hasVideo !== "false") return;
  const id = card.dataset.songId;
  const sourceKey = card.dataset.sourceKey;
  if (!id || !sourceKey || migrationChecked.has(id)) return;
  const stored = legacyPreferences();
  const legacy = stored[sourceKey];
  if (!legacy || typeof legacy !== "object" || !VIDEO_ID_PATTERN.test(legacy.videoId)) return;
  migrationChecked.add(id);
  const chords = [...card.querySelectorAll("[data-chord-id]")];
  const marks = Array.isArray(legacy.chordTimestamps) ? legacy.chordTimestamps : [];
  void (async () => {
    try {
      const linked = await linkVideo(section, legacy.videoId, legacy.url || "");
      if (!linked) return;
      for (const [index, chord] of chords.entries()) {
        const seconds = marks[index];
        if (!Number.isSafeInteger(seconds) || seconds < 0 || !chord.dataset.chordId) continue;
        await postForm(
          `/songs/${encodeURIComponent(id)}/chords/${encodeURIComponent(chord.dataset.chordId)}/timestamp`,
          { ms: String(seconds * 1000) },
        );
      }
      delete stored[sourceKey];
      localStorage.setItem(LEGACY_PREFERENCES_KEY, JSON.stringify(stored));
      reloadPlayer();
    } catch (error) {
      console.error("No se pudieron importar los datos guardados:", error);
    }
  })();
}

function songCard(section) {
  return section?.closest(".song-card") ?? null;
}

function songId(section) {
  return songCard(section)?.dataset.songId ?? "";
}

function optionsElement(section) {
  return songCard(section)?.querySelector("[data-song-options]") ?? null;
}

function setOptionsOpen(section, open) {
  const options = optionsElement(section);
  if (!(options instanceof HTMLDetailsElement)) return;
  if (options.open === open) return;
  optionsProgrammaticChange = true;
  options.open = open;
}

function setStatus(section, message) {
  const status = section?.querySelector("[data-youtube-status]");
  if (status) status.textContent = message;
}

function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function chordElements(section) {
  return [...(songCard(section)?.querySelectorAll("[data-chord-index]") ?? [])];
}

function chordTime(chord) {
  const value = Number(chord.dataset.chordTime);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function updatePlaybackButton(section) {
  const button = songCard(section)?.querySelector("[data-youtube-play]");
  if (!button) return;
  const ready = Boolean(player?.getPlayerState && window.YT?.PlayerState);
  const playing = ready && player.getPlayerState() === window.YT.PlayerState.PLAYING;
  button.disabled = !ready;
  button.setAttribute("aria-label", playing ? "Pausar audio" : "Reproducir audio");
  button.innerHTML = playing
    ? 'Ⅱ <span>Pausar audio</span>'
    : '▶ <span>Reproducir audio</span>';
}

function getProgressParts(section) {
  const card = songCard(section);
  return {
    slider: card?.querySelector("[data-youtube-progress]"),
    current: card?.querySelector("[data-youtube-progress-current]"),
    duration: card?.querySelector("[data-youtube-progress-duration]"),
  };
}

function updateProgress(section) {
  if (!section) return;
  const { slider, current, duration } = getProgressParts(section);
  if (!slider || !current || !duration) return;
  const ready = Boolean(player?.getCurrentTime && player?.getDuration);
  const total = ready ? player.getDuration() : 0;
  const position = ready ? player.getCurrentTime() : 0;
  const hasDuration = Number.isFinite(total) && total > 0;
  slider.disabled = !hasDuration;
  if (hasDuration) {
    slider.max = String(total);
    if (!progressSeeking) slider.value = String(Math.min(position, total));
    duration.textContent = formatTimestamp(total);
  } else if (!progressSeeking) {
    slider.max = "0";
    slider.value = "0";
    duration.textContent = "0:00";
  }
  if (!progressSeeking) {
    current.textContent = formatTimestamp(Number.isFinite(position) ? Math.max(0, position) : 0);
  }
}

function seekToTimestamp(seconds) {
  if (!activeSection || !player?.seekTo || !Number.isFinite(seconds)) return;
  player.seekTo(seconds, true);
  updateProgress(activeSection);
}

function updateChordControls(section) {
  const options = optionsElement(section);
  const optionsOpen = options instanceof HTMLDetailsElement ? options.open : true;
  const ready = Boolean(section?.dataset.videoId && player && player.getPlayerState);
  const toggle = section?.querySelector("[data-chord-mark-toggle]");
  if (toggle) toggle.disabled = !ready || !optionsOpen;
  const card = songCard(section);
  const timestampsAuto = card?.querySelector("[data-timestamps-auto]");
  const timestampsRetry = card?.querySelector("[data-timestamps-retry]");
  const busy = ["pending", "transcribing", "aligning"].includes(card?.dataset.timestampsStatus);
  if (timestampsAuto) timestampsAuto.disabled = !section?.dataset.videoId || busy;
  if (timestampsRetry) timestampsRetry.disabled = !section?.dataset.videoId;

  for (const chord of chordElements(section)) {
    const time = chordTime(chord);
    const marker = chord.querySelector(".chord-time-marker");
    if (time !== null) {
      chord.title = `Marca de reproducción: ${formatTimestamp(time / 1000)}`;
      if (marker) marker.textContent = formatTimestamp(time / 1000);
    } else {
      chord.removeAttribute("title");
      if (marker) marker.textContent = "";
    }
    const chordName = chord.dataset.chordName;
    chord.setAttribute(
      "aria-label",
      markMode
        ? time !== null
          ? `Actualizar la marca de ${chordName}, actualmente en ${formatTimestamp(time / 1000)}`
          : `Marcar el tiempo de ${chordName}`
        : time !== null
          ? `Ver diagrama de ${chordName}. Marca de reproducción en ${formatTimestamp(time / 1000)}`
          : `Ver diagrama de ${chordName}`,
    );
    chord.classList.toggle("is-marking", markMode);
  }
}

function setMarkMode(section, enabled) {
  const options = optionsElement(section);
  const optionsOpen = options instanceof HTMLDetailsElement ? options.open : true;
  markMode = Boolean(
    enabled
    && section
    && optionsOpen
    && section.dataset.videoId
    && player?.getCurrentTime,
  );
  section?.classList.toggle("is-marking", markMode);
  const toggle = section?.querySelector("[data-chord-mark-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(markMode));
    toggle.textContent = markMode ? "Desactivar marcas de acordes" : "Activar marcas de acordes";
  }
  if (section) updateChordControls(section);
}

function updateCurrentChord(section) {
  if (!player?.getCurrentTime || activeSection !== section) return;
  const currentTimeMs = player.getCurrentTime() * 1000;
  let activeIndex = null;
  let activeTimestamp = -1;
  for (const chord of chordElements(section)) {
    const time = chordTime(chord);
    if (time !== null && time <= currentTimeMs && time >= activeTimestamp) {
      activeIndex = Number(chord.dataset.chordIndex);
      activeTimestamp = time;
    }
  }
  if (activeIndex === highlightedChordIndex) return;
  highlightedChordIndex = activeIndex;
  const card = songCard(section);
  card?.querySelectorAll("[data-chord-index]").forEach((chord) => {
    chord.classList.toggle("is-current", Number(chord.dataset.chordIndex) === activeIndex);
    chord.closest(".song-line")?.classList.remove("is-current");
  });
  const activeChord = card?.querySelector(`[data-chord-index="${activeIndex}"]`);
  const activeLine = activeChord?.closest(".song-line");
  activeLine?.classList.add("is-current");
  const lyrics = card?.querySelector(".song-lyrics");
  if (activeLine instanceof HTMLElement && lyrics instanceof HTMLElement) {
    const lineTop = activeLine.getBoundingClientRect().top
      - lyrics.getBoundingClientRect().top
      + lyrics.scrollTop;
    lyrics.scrollTo({
      top: lineTop - (lyrics.clientHeight - activeLine.offsetHeight) / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  void updateAccompanimentChord(section, activeChord);
}

async function updateAccompanimentChord(section, chord) {
  const target = songCard(section)?.querySelector("#accompaniment-chord-viewer");
  if (!target) return;
  if (!chord) {
    chordDiagramRequest += 1;
    requestedAccompanimentChord = "";
    target.innerHTML = '<p class="accompaniment-chord-placeholder">Aún no hay un acorde marcado en este punto del video.</p>';
    return;
  }
  const chordName = chord.dataset.chordName;
  const displayedChord = target.querySelector(".chord-diagram h3")?.textContent;
  if (displayedChord === chordName) {
    chordDiagramRequest += 1;
    requestedAccompanimentChord = "";
    return;
  }
  if (requestedAccompanimentChord === chordName) return;
  const requestId = ++chordDiagramRequest;
  requestedAccompanimentChord = chordName;
  try {
    let html = chordDiagramCache.get(chordName);
    if (!html) {
      const url = new URL("/chord-diagram", window.location.origin);
      url.searchParams.set("chord", chordName);
      url.searchParams.set("target", "accompaniment-chord-viewer");
      const response = await fetch(url);
      html = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${html}`);
      chordDiagramCache.set(chordName, html);
    }
    if (requestId !== chordDiagramRequest || activeSection !== section) return;
    target.innerHTML = html;
    requestedAccompanimentChord = "";
    window.htmx?.process(target);
  } catch (error) {
    if (requestId !== chordDiagramRequest || activeSection !== section) return;
    console.error("No se pudo actualizar el diagrama del acorde actual:", error);
    requestedAccompanimentChord = "";
    target.innerHTML = '<p class="accompaniment-chord-placeholder">No se pudo mostrar la digitación de este acorde.</p>';
  }
}

function destroyPlayer(section) {
  setMarkMode(section, false);
  if (playbackTimer !== null) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  if (player?.destroy) {
    try {
      player.destroy();
    } catch (error) {
      console.error("No se pudo destruir el reproductor:", error);
    }
  }
  player = null;
  playerVideoId = null;
  highlightedChordIndex = null;
  section?.classList.remove("is-playing");
  songCard(section)?.classList.remove("is-playing");
}

function initializePlayer(section, videoId) {
  if (activeSection !== section || !VIDEO_ID_PATTERN.test(videoId) || !window.YT?.Player) return;
  if (player && playerVideoId === videoId && player.getPlayerState) {
    updateChordControls(section);
    updateProgress(section);
    return;
  }
  if (player) destroyPlayer(section);
  const host = songCard(section)?.querySelector("[data-youtube-player]");
  if (!host) return;
  host.replaceChildren();
  const element = document.createElement("div");
  host.append(element);
  setStatus(section, "");
  player = new window.YT.Player(element, {
    width: "100%",
    videoId,
    playerVars: { playsinline: 1, origin: window.location.origin },
    events: {
      onReady(event) {
        if (activeSection !== section || section.dataset.videoId !== videoId) {
          event.target.destroy();
          return;
        }
        player = event.target;
        updateChordControls(section);
        updatePlaybackButton(section);
        updateProgress(section);
        setMarkMode(section, false);
        const restore = pendingPlayback;
        pendingPlayback = null;
        if (restore?.songId === songId(section) && restore.videoId === videoId) {
          player.seekTo(restore.seconds, true);
          if (restore.wasPlaying) player.playVideo();
        }
        setStatus(section, "Listo.");
      },
      onStateChange(event) {
        if (activeSection !== section || section.dataset.videoId !== videoId) return;
        if (event.data === window.YT.PlayerState.PLAYING) {
          section.classList.add("is-playing");
          songCard(section)?.classList.add("is-playing");
          const options = optionsElement(section);
          if (options instanceof HTMLDetailsElement && options.open) {
            options.dataset.autocollapsed = "1";
            setOptionsOpen(section, false);
          }
          updateChordControls(section);
          setStatus(section, markMode ? "Marcas activadas." : "");
          if (playbackTimer !== null) window.clearInterval(playbackTimer);
          updateCurrentChord(section);
          playbackTimer = window.setInterval(() => {
            updateCurrentChord(section);
            updateProgress(section);
          }, 250);
          updatePlaybackButton(section);
          updateProgress(section);
        } else {
          section.classList.remove("is-playing");
          songCard(section)?.classList.remove("is-playing");
          const options = optionsElement(section);
          if (options instanceof HTMLDetailsElement && options.dataset.autocollapsed === "1") {
            options.dataset.autocollapsed = "0";
            setOptionsOpen(section, true);
          }
          updatePlaybackButton(section);
          updateProgress(section);
          updateChordControls(section);
          if (playbackTimer !== null) {
            window.clearInterval(playbackTimer);
            playbackTimer = null;
          }
        }
      },
      onError(event) {
        if (activeSection !== section || section.dataset.videoId !== videoId) return;
        console.error("Error del reproductor de YouTube:", event.data);
        section.classList.remove("is-playing");
        songCard(section)?.classList.remove("is-playing");
        setStatus(section, "No se pudo reproducir.");
        if (playbackTimer !== null) {
          window.clearInterval(playbackTimer);
          playbackTimer = null;
        }
        updateChordControls(section);
      },
    },
  });
  playerVideoId = videoId;
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(section) {
  stopPolling();
  const card = songCard(section);
  if (!card) return;
  const busy = () =>
    card.dataset.videoStatus === "searching"
    || ["pending", "transcribing", "aligning"].includes(card.dataset.timestampsStatus);
  if (!busy()) return;
  const id = card.dataset.songId;
  pollTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/songs/${id}/status`, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const status = await response.json();
      if (
        status.videoStatus === "searching"
        || ["pending", "transcribing", "aligning"].includes(status.timestampsStatus)
      ) {
        return;
      }
      stopPolling();
      reloadPlayer();
    } catch (error) {
      console.error("No se pudo consultar el estado de la canción:", error);
    }
  }, 2000);
}

function reloadPlayer() {
  const card = document.querySelector(".song-card");
  if (!card || !window.htmx) return;
  const id = card.dataset.songId;
  const offset = card.dataset.offset ?? "0";
  if (!id) return;
  window.htmx.ajax("GET", `/songs/${encodeURIComponent(id)}/player?offset=${encodeURIComponent(offset)}`, {
    target: "#song-container",
    swap: "innerHTML",
  });
}

function initializeSection(section) {
  if (!section) return;
  activeSection = section;
  const card = songCard(section);
  const videoId = section.dataset.videoId || "";
  const videoUrl = section.dataset.videoUrl || "";
  const input = section.querySelector('input[name="url"]');
  const media = card?.querySelector("[data-youtube-media]");
  const playbackControls = card?.querySelector("[data-youtube-playback-controls]");
  const host = card?.querySelector("[data-youtube-player]");
  const unlinkButton = section.querySelector("[data-video-unlink]");
  if (input) input.value = videoUrl;
  if (unlinkButton) unlinkButton.hidden = !videoId;
  updateChordControls(section);
  const hasVideo = VIDEO_ID_PATTERN.test(videoId);
  if (media) media.hidden = !hasVideo;
  if (playbackControls) playbackControls.hidden = !hasVideo;
  if (host) host.hidden = !hasVideo;
  updatePlaybackButton(section);
  updateProgress(section);
  offerLegacyMigration(card, section);

  if (!hasVideo) {
    destroyPlayer(section);
    setStatus(section, "");
    startPolling(section);
    return;
  }

  if (!window.YT?.Player) {
    setStatus(section, "");
    loadYoutubeApi();
  } else {
    initializePlayer(section, videoId);
  }
  startPolling(section);
}

function loadYoutubeApi() {
  if (apiLoading) return;
  apiLoading = true;
  window.onYouTubeIframeAPIReady = () => {
    apiLoading = false;
    if (activeSection) initializeSection(activeSection);
  };
  const script = document.createElement("script");
  script.src = "https://www.youtube.com/iframe_api";
  script.onerror = () => {
    apiLoading = false;
    if (activeSection) {
      setStatus(activeSection, "");
    }
  };
  document.head.append(script);
}

async function postForm(url, data) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
  });
}

async function linkVideo(section, videoId, url) {
  const id = songId(section);
  const response = await postForm(`/songs/${encodeURIComponent(id)}/video`, {
    videoId,
    url,
    confirm: "1",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "No se pudo vincular el video.");
  }
  return true;
}

document.addEventListener("htmx:beforeSwap", (event) => {
  if (event.detail.target?.id !== "song-container") return;
  stopPolling();
  markMode = false;
  highlightedChordIndex = null;
  progressSeeking = false;
  if (playbackTimer !== null) {
    window.clearInterval(playbackTimer);
    playbackTimer = null;
  }
  if (player && activeSection && activeSection.dataset.videoId) {
    try {
      if (player.getCurrentTime) {
        pendingPlayback = {
          songId: songId(activeSection),
          videoId: activeSection.dataset.videoId,
          seconds: player.getCurrentTime(),
          wasPlaying: player.getPlayerState() === window.YT?.PlayerState.PLAYING,
        };
      }
      if (player.destroy) player.destroy();
    } catch (error) {
      console.error("No se pudo conservar la posición del video:", error);
    }
    player = null;
    playerVideoId = null;
  }
});

document.addEventListener("htmx:afterSwap", (event) => {
  if (event.detail.target?.id !== "song-container") return;
  initializeSection(event.detail.target.querySelector("[data-youtube-song]"));
});

document.addEventListener("toggle", (event) => {
  const options = event.target;
  if (!(options instanceof HTMLDetailsElement) || !options.matches("[data-song-options]")) return;
  if (optionsProgrammaticChange) {
    optionsProgrammaticChange = false;
    return;
  }
  options.dataset.autocollapsed = "0";
  if (!options.open) setMarkMode(activeSection, false);
  else updateChordControls(activeSection);
}, true);

document.addEventListener("submit", async (event) => {
  const form = event.target.closest(".youtube-link-form");
  if (!form) return;
  event.preventDefault();
  const section = form.closest("[data-youtube-song]");
  const input = form.querySelector('input[name="url"]');
  const url = input.value.trim();
  const match = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([a-zA-Z0-9_-]{11})/.exec(url);
  if (!match) {
    setStatus(section, "Enlace no válido.");
    return;
  }
  setStatus(section, "");
  try {
    const linked = await linkVideo(section, match[1], url);
    if (!linked) return;
    reloadPlayer();
  } catch (error) {
    console.error("No se pudo vincular el video de YouTube:", error);
    setStatus(section, error instanceof Error ? error.message : "No se pudo vincular.");
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const playButton = target.closest("[data-youtube-play]");
  if (playButton) {
    if (!player?.getPlayerState || !window.YT?.PlayerState) return;
    if (player.getPlayerState() === window.YT.PlayerState.PLAYING) player.pauseVideo();
    else player.playVideo();
    updatePlaybackButton(activeSection);
    return;
  }

  const toggle = target.closest("[data-chord-mark-toggle]");
  if (toggle) {
    const section = toggle.closest("[data-youtube-song]");
    if (!section || toggle.disabled) return;
    setMarkMode(section, !markMode);
    setStatus(section, markMode ? "Marcas activadas." : "");
    return;
  }

  const generate = target.closest("[data-timestamps-auto], [data-timestamps-retry]");
  if (generate) {
    const section = generate.closest("[data-youtube-song]");
    const card = songCard(section);
    const id = card?.dataset.songId;
    if (!section || !id) return;
    const retry = generate.matches("[data-timestamps-retry]");
    setStatus(section, "");
    card.dataset.timestampsStatus = "pending";
    const loader = section?.querySelector(".song-loader");
    if (loader) loader.hidden = false;
    fetch(`/songs/${encodeURIComponent(id)}/timestamps/${retry ? "retry" : "auto"}`, {
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudieron iniciar las marcas.");
        startPolling(section);
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, "");
        card.dataset.timestampsStatus = "none";
      });
    return;
  }

  const retryVideo = target.closest("[data-video-retry]");
  if (retryVideo) {
    const section = retryVideo.closest("[data-youtube-song]");
    const card = songCard(section);
    const id = card?.dataset.songId;
    if (!section || !id) return;
    card.dataset.videoStatus = "searching";
    setStatus(section, "");
    const loader = section?.querySelector(".song-loader");
    if (loader) loader.hidden = false;
    fetch(`/songs/${encodeURIComponent(id)}/video/retry`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo buscar el video.");
        startPolling(section);
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, "");
        card.dataset.videoStatus = "failed";
      });
    return;
  }

  const unlink = target.closest("[data-video-unlink]");
  if (unlink) {
    const section = unlink.closest("[data-youtube-song]");
    const id = songId(section);
    if (!section || !id) return;
    postForm(`/songs/${encodeURIComponent(id)}/video`, { clear: "1" })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo quitar el video.");
        reloadPlayer();
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, "No se pudo quitar el video.");
      });
    return;
  }

  const candidate = target.closest("[data-video-select]");
  if (candidate) {
    const section = candidate.closest("[data-youtube-song]") ?? activeSection;
    const id = candidate.dataset.songId || songId(section);
    const videoId = candidate.dataset.videoSelect;
    if (!id || !VIDEO_ID_PATTERN.test(videoId)) return;
    linkVideo(section, videoId, "")
      .then((linked) => {
        if (linked) reloadPlayer();
      })
      .catch((error) => {
        console.error(error);
        setStatus(section, error instanceof Error ? error.message : "No se pudo cambiar el video.");
      });
    return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches("[data-youtube-progress]")) return;
  const seconds = Number(target.value);
  if (!Number.isFinite(seconds)) return;
  progressSeeking = true;
  const { current } = getProgressParts(activeSection);
  if (current) current.textContent = formatTimestamp(Math.max(0, seconds));
  seekToTimestamp(seconds);
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches("[data-youtube-progress]")) return;
  progressSeeking = false;
  seekToTimestamp(Number(target.value));
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const chord = target.closest("[data-chord-index]");
  if (!chord || !markMode) return;
  const options = optionsElement(activeSection);
  if (options instanceof HTMLDetailsElement && !options.open) return;
  if (!player?.getCurrentTime) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const ms = Math.floor(player.getCurrentTime() * 1000);
  const id = songId(activeSection);
  const chordId = chord.dataset.chordId;
  if (!id || !chordId) return;
  chord.dataset.chordTime = String(ms);
  updateChordControls(activeSection);
  postForm(`/songs/${encodeURIComponent(id)}/chords/${encodeURIComponent(chordId)}/timestamp`, {
    ms: String(ms),
  })
    .then((response) => {
      if (!response.ok) throw new Error("No se pudo guardar la marca.");
      setStatus(activeSection, `Marca guardada en ${formatTimestamp(ms / 1000)}.`);
    })
    .catch((error) => {
      console.error(error);
      setStatus(activeSection, "No se pudo guardar.");
      chord.removeAttribute("data-chord-time");
      updateChordControls(activeSection);
    });
}, true);

document.addEventListener("contextmenu", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const chord = target.closest("[data-chord-index]");
  if (!chord || !markMode) return;
  const options = optionsElement(activeSection);
  if (options instanceof HTMLDetailsElement && !options.open) return;
  if (chordTime(chord) === null) return;
  event.preventDefault();
  const id = songId(activeSection);
  const chordId = chord.dataset.chordId;
  if (!id || !chordId) return;
  chord.removeAttribute("data-chord-time");
  updateChordControls(activeSection);
  postForm(`/songs/${encodeURIComponent(id)}/chords/${encodeURIComponent(chordId)}/timestamp/clear`, {})
    .then((response) => {
      if (!response.ok) throw new Error("No se pudo borrar la marca.");
      setStatus(activeSection, `Marca eliminada.`);
    })
    .catch((error) => {
      console.error(error);
      setStatus(activeSection, "No se pudo borrar.");
    });
}, true);

document.body.addEventListener("song-updated", () => {
  reloadPlayer();
});

document.addEventListener("DOMContentLoaded", () => {
  initializeSection(document.querySelector("[data-youtube-song]"));
});
