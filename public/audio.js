(function () {
let audioEl = null;
let audioCtx = null;
let pitchNode = null;
let graphReady = false;
let graphPromise = null;
let ytPlayer = null;
let currentSongId = "";
let currentVideoId = "";
let currentOffset = 0;
let audioStatus = "none";
let sourceMode = "youtube";
let chosenMode = null;
let pendingAudio = null;
let pendingSeekSeconds = null;
let pollTimer = null;
let audioError = "";
let audioPreparing = false;

function songCard(section) {
  return section?.closest(".song-card") ?? null;
}

function clampSemitones(value) {
  if (!Number.isInteger(value)) return 0;
  return Math.max(-12, Math.min(12, value));
}

function pitchRatio(semitones) {
  return Math.pow(2, clampSemitones(semitones) / 12);
}

function getAudioElement() {
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.preload = "auto";
    audioEl.addEventListener("loadedmetadata", () => {
      if (pendingSeekSeconds !== null && Number.isFinite(pendingSeekSeconds)) {
        try {
          audioEl.currentTime = pendingSeekSeconds;
        } catch (error) {
          console.error("No se pudo restaurar la posición del audio:", error);
        }
      }
      pendingSeekSeconds = null;
    });
  }
  return audioEl;
}

function applyPitch() {
  if (!pitchNode || !graphReady) return;
  try {
    pitchNode.port.postMessage(JSON.stringify(["pitch", pitchRatio(currentOffset)]));
  } catch (error) {
    console.error("No se pudo aplicar el pitch del audio:", error);
  }
}

async function ensureGraph() {
  if (graphReady) return;
  if (graphPromise) return graphPromise;
  graphPromise = (async () => {
    if (!window.AudioContext || !window.AudioWorkletNode) {
      throw new Error("Web Audio no disponible.");
    }
    getAudioElement();
    if (!audioCtx) audioCtx = new window.AudioContext();
    await audioCtx.audioWorklet.addModule("/public/rubberband-processor.js");
    const source = audioCtx.createMediaElementSource(audioEl);
    pitchNode = new window.AudioWorkletNode(audioCtx, "rubberband-processor");
    pitchNode.port.postMessage(JSON.stringify(["tempo", 1]));
    pitchNode.port.postMessage(JSON.stringify(["quality", true]));
    source.connect(pitchNode);
    pitchNode.connect(audioCtx.destination);
    graphReady = true;
    applyPitch();
  })();
  try {
    await graphPromise;
  } catch (error) {
    graphPromise = null;
    throw error;
  }
}

function updateAudioUi(card) {
  if (!card) return;
  const transposed = card.querySelector('[data-audio-source="transposed"]');
  const youtube = card.querySelector('[data-audio-source="youtube"]');
  const text = card.querySelector("[data-audio-status-text]");
  const ready = audioStatus === "ready";
  const busy = audioPreparing || audioStatus === "fetching";
  card.dataset.audioBusy = String(busy);
  if (transposed) {
    transposed.disabled = !ready;
    transposed.setAttribute("aria-pressed", String(sourceMode === "transposed"));
  }
  if (youtube) youtube.setAttribute("aria-pressed", String(sourceMode === "youtube"));
  if (text) {
    text.textContent = audioError
      ? `Audio transpuesto no disponible: ${audioError}`
      : audioPreparing
        ? "Preparando audio transpuesto…"
        : audioStatus === "fetching"
          ? "Descargando audio…"
          : audioStatus === "failed"
            ? "Audio transpuesto no disponible."
            : "";
  }
}

function stopAudioPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startAudioPolling(card, songId) {
  stopAudioPolling();
  pollTimer = window.setInterval(async () => {
    if (currentSongId !== songId) {
      stopAudioPolling();
      return;
    }
    try {
      const response = await fetch(`/songs/${encodeURIComponent(songId)}/status`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const status = await response.json();
      audioStatus = status.audioStatus ?? "none";
      card.dataset.audioStatus = audioStatus;
      if (audioStatus === "ready") {
        stopAudioPolling();
        onAudioReady(card, songId);
        return;
      }
      if (audioStatus === "failed") {
        stopAudioPolling();
        if (chosenMode !== "youtube") sourceMode = "youtube";
        updateAudioUi(card);
        return;
      }
      updateAudioUi(card);
    } catch (error) {
      console.error("No se pudo consultar el estado del audio:", error);
    }
  }, 2000);
}

function setAudioSource(songId) {
  const el = getAudioElement();
  const src = `/songs/${encodeURIComponent(songId)}/audio`;
  if (el.dataset.songId !== songId) {
    el.dataset.songId = songId;
    el.src = src;
    el.load();
  }
}

function onAudioReady(card, songId) {
  if (chosenMode !== "youtube") sourceMode = "transposed";
  setAudioSource(songId);
  if (chosenMode !== "youtube") {
    void ensureGraph().catch((error) => {
      console.warn("[audio] no se pudo precargar el audio transpuesto:", error);
    });
  }
  let resumeAt = null;
  if (pendingAudio && pendingAudio.songId === songId) {
    pendingSeekSeconds = pendingAudio.seconds;
    if (pendingAudio.wasPlaying) resumeAt = pendingAudio.seconds;
    pendingAudio = null;
  }
  updateAudioUi(card);
  console.info("[audio] listo, modo:", sourceMode, "offset:", currentOffset);
  if (sourceMode !== "transposed") return;
  if (ytPlayer) {
    try {
      ytPlayer.mute();
    } catch (error) {
      console.error("No se pudo silenciar el video:", error);
    }
    if (resumeAt === null && isYoutubePlaying()) {
      resumeAt = ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0;
    }
  }
  if (resumeAt !== null) void startTransposed(resumeAt);
}

function isYoutubePlaying() {
  return Boolean(
    ytPlayer?.getPlayerState
    && window.YT?.PlayerState
    && ytPlayer.getPlayerState() === window.YT.PlayerState.PLAYING,
  );
}

function init(section) {
  const card = songCard(section);
  if (!card) return;
  const songId = card.dataset.songId ?? "";
  const videoId = section.dataset.videoId ?? "";
  const offset = Number(card.dataset.offset ?? "0");
  currentOffset = clampSemitones(Number.isInteger(offset) ? offset : 0);

  if (songId !== currentSongId || videoId !== currentVideoId) {
    currentSongId = songId;
    currentVideoId = videoId;
    chosenMode = null;
    pendingSeekSeconds = null;
    stopAudioPolling();
    if (audioEl) {
      try {
        audioEl.pause();
      } catch (error) {
        console.error("No se pudo pausar el audio:", error);
      }
      delete audioEl.dataset.songId;
    }
    audioStatus = card.dataset.audioStatus ?? "none";
    sourceMode = audioStatus === "ready" ? "transposed" : "youtube";
    if (pendingAudio && pendingAudio.songId === songId && pendingAudio.videoId === videoId) {
      pendingSeekSeconds = pendingAudio.seconds;
      pendingAudio = null;
    }
  } else {
    audioStatus = card.dataset.audioStatus ?? audioStatus;
  }

  applyPitch();
  updateAudioUi(card);

  if (!videoId) {
    sourceMode = "youtube";
    updateAudioUi(card);
    return;
  }

  if (audioStatus === "ready") {
    onAudioReady(card, songId);
    return;
  }
  if (audioStatus === "fetching" || audioStatus === "none") {
    startAudioPolling(card, songId);
  }
}

function preserve() {
  if (audioEl && currentSongId) {
    pendingAudio = {
      songId: currentSongId,
      videoId: currentVideoId,
      seconds: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0,
      wasPlaying: !audioEl.paused,
    };
    try {
      audioEl.pause();
    } catch (error) {
      console.error("No se pudo pausar el audio:", error);
    }
  }
  stopAudioPolling();
  ytPlayer = null;
}

function onPlayerReady(player) {
  ytPlayer = player;
  if (sourceMode === "transposed" && audioStatus === "ready") {
    try {
      player.mute();
    } catch (error) {
      console.error("No se pudo silenciar el video:", error);
    }
  }
}

function onYoutubePlaying(player, seconds) {
  if (player) ytPlayer = player;
  if (sourceMode !== "transposed" || audioStatus !== "ready") return;
  try {
    if (ytPlayer) ytPlayer.mute();
  } catch (error) {
    console.error("No se pudo silenciar el video:", error);
  }
  void startTransposed(seconds);
}

async function startTransposed(seconds) {
  const card = document.querySelector(".song-card");
  audioPreparing = true;
  updateAudioUi(card);
  try {
    await ensureGraph();
    await Promise.race([
      audioCtx.resume(),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    if (audioCtx.state !== "running") {
      throw new Error(`AudioContext en estado ${audioCtx.state}`);
    }
    if (sourceMode !== "transposed") return;
    const el = getAudioElement();
    if (Number.isFinite(seconds) && Math.abs((el.currentTime || 0) - seconds) > 0.5) {
      el.currentTime = seconds;
    }
    audioError = "";
    await el.play();
    console.info("[audio] reproduciendo transpuesto en", el.currentTime, "offset", currentOffset);
  } catch (error) {
    console.error("No se pudo reproducir el audio transpuesto:", error);
    audioError = error instanceof Error ? error.message : "error desconocido";
    sourceMode = "youtube";
    if (ytPlayer) {
      try {
        ytPlayer.unMute();
      } catch (unmuteError) {
        console.error("No se pudo reactivar el video:", unmuteError);
      }
    }
  } finally {
    audioPreparing = false;
    updateAudioUi(card);
  }
}

function onYoutubePaused(player) {
  if (player) ytPlayer = player;
  if (audioEl && !audioEl.paused) {
    try {
      audioEl.pause();
    } catch (error) {
      console.error("No se pudo pausar el audio:", error);
    }
  }
}

function seek(seconds) {
  if (sourceMode !== "transposed" || audioStatus !== "ready" || !audioEl) return;
  if (!Number.isFinite(seconds)) return;
  try {
    audioEl.currentTime = Math.max(0, seconds);
  } catch (error) {
    console.error("No se pudo buscar en el audio:", error);
  }
}

function syncDrift(seconds) {
  if (sourceMode !== "transposed" || audioStatus !== "ready" || !audioEl) return;
  if (audioEl.paused || !Number.isFinite(seconds)) return;
  if (Math.abs((audioEl.currentTime || 0) - seconds) > 1) {
    try {
      audioEl.currentTime = seconds;
    } catch (error) {
      console.error("No se pudo sincronizar el audio:", error);
    }
  }
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-audio-source]");
  if (!button || button.disabled) return;
  const mode = button.dataset.audioSource;
  if (mode !== "transposed" && mode !== "youtube") return;
  if (mode === "transposed" && audioStatus !== "ready") return;
  chosenMode = mode;
  sourceMode = mode;
  audioError = "";
  const card = songCard(button);
  updateAudioUi(card);
  const playing = isYoutubePlaying();
  if (mode === "transposed") {
    const seconds = ytPlayer?.getCurrentTime?.() ?? audioEl?.currentTime ?? 0;
    if (ytPlayer) {
      try {
        ytPlayer.mute();
      } catch (error) {
        console.error("No se pudo silenciar el video:", error);
      }
      if (!playing) {
        try {
          ytPlayer.playVideo();
        } catch (error) {
          console.error("No se pudo iniciar el video:", error);
        }
      }
    }
    void startTransposed(seconds);
  } else {
    if (audioEl) {
      try {
        audioEl.pause();
      } catch (error) {
        console.error("No se pudo pausar el audio:", error);
      }
    }
    if (ytPlayer) {
      try {
        ytPlayer.unMute();
      } catch (error) {
        console.error("No se pudo reactivar el video:", error);
      }
      if (!playing) ytPlayer.playVideo();
    }
  }
});

window.AcordesAudio = {
  init,
  preserve,
  onPlayerReady,
  onYoutubePlaying,
  onYoutubePaused,
  seek,
  syncDrift,
  debug: () => ({
    songId: currentSongId,
    videoId: currentVideoId,
    offset: currentOffset,
    audioStatus,
    sourceMode,
    chosenMode,
    ctxState: audioCtx ? audioCtx.state : null,
    graphReady,
    audioPreparing,
    audioTime: audioEl ? audioEl.currentTime : null,
    audioPaused: audioEl ? audioEl.paused : null,
    audioError,
  }),
};
})();
