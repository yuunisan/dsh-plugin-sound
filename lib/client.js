window.__ModuleLoader__.load({ id: "dsh-plugin-sound", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;

//#region src/client/audio.ts
let sharedContext;
/** Lazily create (or resume) the page's single AudioContext. */
function audioContext() {
	const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
	if (Ctor === void 0) return void 0;
	if (sharedContext === void 0) try {
		sharedContext = new Ctor();
	} catch {
		return;
	}
	if (sharedContext.state === "suspended") sharedContext.resume().catch(() => {});
	return sharedContext;
}
/**
* Decode a stored blob, reporting its length.
* @param blob - audio file contents.
* @returns the decoded buffer and duration.
* @throws when the browser cannot decode the file.
*/
async function decodeClip(blob) {
	const context = audioContext();
	if (context === void 0) throw new Error("Web Audio is unavailable in this browser");
	const bytes = await blob.arrayBuffer();
	const buffer = await context.decodeAudioData(bytes.slice(0));
	return {
		buffer,
		durationMs: Math.round(buffer.duration * 1e3)
	};
}
/** Plays at most one sound at a time, so a burst of finishes cannot stack. */
var SoundPlayer = class {
	decoded;
	decodedFrom;
	source;
	element;
	/**
	* Decode and cache a clip for `playClip` / `playBuffer`.
	* @param blob - audio file contents.
	* @returns the decoded length in milliseconds.
	*/
	async prepare(blob) {
		const decoded = await decodeClip(blob);
		this.decoded = decoded;
		this.decodedFrom = blob;
		return decoded.durationMs;
	}
	/** Whether a clip is prepared and ready to play. */
	get ready() {
		return this.decoded !== void 0;
	}
	/** Stop whatever is playing. */
	stop() {
		try {
			this.source?.stop();
		} catch {}
		this.source = void 0;
		if (this.element !== void 0) {
			try {
				this.element.pause();
				this.element.removeAttribute("src");
				this.element.load();
			} catch {}
			this.element = void 0;
		}
	}
	/**
	* Play the prepared clip.
	* @param volume - gain, 0–1.
	* @returns whether playback started.
	*/
	playClip(volume) {
		const decoded = this.decoded;
		const context = audioContext();
		if (decoded === void 0 || context === void 0) return false;
		this.stop();
		const source = context.createBufferSource();
		source.buffer = decoded.buffer;
		const gain = context.createGain();
		gain.gain.value = volume;
		source.connect(gain).connect(context.destination);
		try {
			source.start();
		} catch {
			return false;
		}
		this.source = source;
		source.onended = () => {
			if (this.source === source) this.source = void 0;
		};
		return true;
	}
	/**
	* Synthesize the built-in two-tone chime.
	* @param volume - gain, 0–1.
	* @returns whether playback started.
	*/
	playBuiltin(volume) {
		const context = audioContext();
		if (context === void 0) return false;
		this.stop();
		const start = context.currentTime;
		const gain = context.createGain();
		gain.connect(context.destination);
		gain.gain.setValueAtTime(1e-4, start);
		gain.gain.exponentialRampToValueAtTime(Math.max(2e-4, volume), start + .015);
		gain.gain.exponentialRampToValueAtTime(1e-4, start + .55);
		for (const [frequency, offset] of [[880, 0], [1318.5, .12]]) {
			const oscillator = context.createOscillator();
			oscillator.type = "sine";
			oscillator.frequency.setValueAtTime(frequency, start + offset);
			const voice = context.createGain();
			voice.gain.setValueAtTime(1e-4, start + offset);
			voice.gain.exponentialRampToValueAtTime(.9, start + offset + .02);
			voice.gain.exponentialRampToValueAtTime(1e-4, start + offset + .4);
			oscillator.connect(voice).connect(gain);
			oscillator.start(start + offset);
			oscillator.stop(start + offset + .45);
		}
		return true;
	}
	/**
	* Play a remote audio URL.
	* @param url - absolute http(s) URL.
	* @param volume - gain, 0–1.
	* @returns whether playback started (a rejected promise reports `false`).
	*/
	async playUrl(url, volume) {
		this.stop();
		try {
			const element = new Audio();
			element.crossOrigin = "anonymous";
			element.preload = "auto";
			element.volume = Math.min(1, Math.max(0, volume));
			element.src = url;
			this.element = element;
			await element.play();
			return true;
		} catch {
			return false;
		}
	}
	/** Forget the decoded clip (the stored blob changed or was removed). */
	reset() {
		this.stop();
		this.decoded = void 0;
		this.decodedFrom = void 0;
	}
	/** Whether the decoded cache still matches the given blob. */
	matches(blob) {
		return this.decodedFrom === blob;
	}
	/** Release the shared AudioContext. */
	static dispose() {
		const context = sharedContext;
		sharedContext = void 0;
		context?.close().catch(() => {});
	}
};

//#endregion
//#region src/client/settings.ts
/** Defaults chosen to be useful without being annoying. */
const DEFAULT_SETTINGS = {
	enabled: true,
	source: "builtin",
	url: "",
	volume: .7,
	onlyWhenHidden: true,
	onlyMainSession: true,
	minTurnMs: 2e3
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/**
* Coerce anything (stored JSON, hand-edited YAML, another version's shape) into
* a valid settings object.
* @param raw - unknown candidate value.
* @returns settings with every field in range.
*/
function normalizeSettings(raw) {
	if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
	const input = raw;
	const source = input.source === "file" || input.source === "url" || input.source === "builtin" ? input.source : DEFAULT_SETTINGS.source;
	return {
		enabled: input.enabled !== false,
		source,
		url: typeof input.url === "string" ? input.url.trim().slice(0, 2048) : "",
		volume: typeof input.volume === "number" && Number.isFinite(input.volume) ? clamp(input.volume, 0, 1) : DEFAULT_SETTINGS.volume,
		onlyWhenHidden: input.onlyWhenHidden !== false,
		onlyMainSession: input.onlyMainSession !== false,
		minTurnMs: typeof input.minTurnMs === "number" && Number.isFinite(input.minTurnMs) ? clamp(Math.round(input.minTurnMs), 0, 6e5) : DEFAULT_SETTINGS.minTurnMs
	};
}
/**
* Whether a string is a URL this plugin is willing to hand to an `<audio>`.
* @param value - candidate string.
* @returns true for absolute http(s) URLs only.
*/
function isPlayableUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}
/**
* Decide whether the finished turn should ring.
* @param settings - current settings.
* @param context - facts about the finished turn.
* @returns the reason to stay silent, or `null` to play.
*/
function skipReason(settings, context) {
	if (!settings.enabled) return "disabled";
	if (settings.onlyWhenHidden && !context.hidden) return "visible-window";
	if (settings.onlyMainSession && !context.mainSession) return "background-session";
	if (settings.minTurnMs > 0 && context.elapsedMs >= 0 && context.elapsedMs < settings.minTurnMs) return "short-turn";
	return null;
}
/** Maximum accepted imported file size, in bytes. */
const MAX_SOUND_BYTES = 2 * 1024 * 1024;
/** Maximum accepted clip length, in milliseconds. */
const MAX_SOUND_MS = 3e3;
/**
* Validate a user-selected file before it is stored.
* @param file - candidate as reported by the file input.
* @returns an error message, or `null` when acceptable.
*/
function fileRejection(file) {
	if (file.size > MAX_SOUND_BYTES) return "That file is larger than 2 MB.";
	if (file.size === 0) return "That file is empty.";
	if (file.type !== "" && !file.type.startsWith("audio/")) {
		if (!/\.(wav|wave|ogg|oga|mp3|m4a|aac|flac|opus|webm)$/i.test(file.name)) return "That does not look like an audio file (use WAV, OGG, or MP3).";
	}
	return null;
}

//#endregion
//#region src/client/storage.ts
const SETTINGS_KEY = "dsh-plugin-sound:settings";
const DB_NAME = "dsh-plugin-sound";
const DB_VERSION = 1;
const CLIP_STORE = "clips";
const CLIP_KEY = "current";
/**
* Read the saved settings.
* @returns normalized settings, or defaults when nothing is stored.
*/
function loadSettings() {
	try {
		const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
		return normalizeSettings(raw === null || raw === void 0 ? void 0 : JSON.parse(raw));
	} catch {
		return normalizeSettings(void 0);
	}
}
/**
* Persist settings.
* @param settings - values to save.
*/
function saveSettings(settings) {
	try {
		globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {}
}
/** Resolve the clips object store, creating the database on first use. */
function openDatabase() {
	return new Promise((resolve) => {
		const factory = globalThis.indexedDB;
		if (factory === void 0) {
			resolve(void 0);
			return;
		}
		let request;
		try {
			request = factory.open(DB_NAME, DB_VERSION);
		} catch {
			resolve(void 0);
			return;
		}
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(CLIP_STORE)) db.createObjectStore(CLIP_STORE);
		};
		request.onsuccess = () => {
			resolve(request.result);
		};
		request.onerror = () => {
			resolve(void 0);
		};
		request.onblocked = () => {
			resolve(void 0);
		};
	});
}
/**
* Read the stored clip.
* @returns the clip, or undefined when none is stored or the store is unavailable.
*/
async function loadClip() {
	const db = await openDatabase();
	if (db === void 0) return void 0;
	return new Promise((resolve) => {
		try {
			const request = db.transaction(CLIP_STORE, "readonly").objectStore(CLIP_STORE).get(CLIP_KEY);
			request.onsuccess = () => {
				const value = request.result;
				resolve(value !== void 0 && value !== null && value.blob instanceof Blob ? value : void 0);
			};
			request.onerror = () => {
				resolve(void 0);
			};
		} catch {
			resolve(void 0);
		}
	});
}
/**
* Store the imported clip, replacing any previous one.
* @param clip - blob and metadata to keep.
* @returns whether the write succeeded.
*/
async function saveClip(clip) {
	const db = await openDatabase();
	if (db === void 0) return false;
	return new Promise((resolve) => {
		try {
			const transaction = db.transaction(CLIP_STORE, "readwrite");
			transaction.objectStore(CLIP_STORE).put(clip, CLIP_KEY);
			transaction.oncomplete = () => {
				resolve(true);
			};
			transaction.onerror = () => {
				resolve(false);
			};
			transaction.onabort = () => {
				resolve(false);
			};
		} catch {
			resolve(false);
		}
	});
}
/**
* Forget the imported clip.
* @returns whether the delete succeeded.
*/
async function clearClip() {
	const db = await openDatabase();
	if (db === void 0) return false;
	return new Promise((resolve) => {
		try {
			const transaction = db.transaction(CLIP_STORE, "readwrite");
			transaction.objectStore(CLIP_STORE).delete(CLIP_KEY);
			transaction.oncomplete = () => {
				resolve(true);
			};
			transaction.onerror = () => {
				resolve(false);
			};
			transaction.onabort = () => {
				resolve(false);
			};
		} catch {
			resolve(false);
		}
	});
}

//#endregion
//#region src/client/tracker.ts
/** Tracks the running interval of each Session. */
var TurnTracker = class {
	startedAt = /* @__PURE__ */ new Map();
	/**
	* Feed one host status push.
	* @param sessionId - Session the status belongs to.
	* @param running - whether that Session is now running.
	* @param now - current epoch milliseconds.
	* @returns the finished turn, or `null` while a turn is still open.
	*/
	observe(sessionId, running, now) {
		if (running) {
			if (!this.startedAt.has(sessionId)) this.startedAt.set(sessionId, now);
			return null;
		}
		const started = this.startedAt.get(sessionId);
		this.startedAt.delete(sessionId);
		if (started === void 0) return {
			sessionId,
			elapsedMs: -1
		};
		return {
			sessionId,
			elapsedMs: Math.max(0, now - started)
		};
	}
	/** Forget a Session (on disposal, or when the Host drops it). */
	forget(sessionId) {
		this.startedAt.delete(sessionId);
	}
	/** Start time for one Session, for tests and diagnostics. */
	startOf(sessionId) {
		return this.startedAt.get(sessionId);
	}
	/** Clear every tracked Session. */
	clear() {
		this.startedAt.clear();
	}
};

//#endregion
//#region src/client/ui.ts
const STYLE = `
:host { all: initial; }
.panel {
  position: fixed; right: 20px; bottom: 64px; z-index: 2147483000;
  width: 320px; max-height: 80vh; overflow: auto;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #e6e8ee; background: #1b1e26; border: 1px solid #2f3542;
  border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.45); padding: 14px 16px;
}
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.title { font-weight: 600; font-size: 14px; }
.close { background: none; border: 0; color: #9aa4b8; font-size: 16px; cursor: pointer; padding: 2px 6px; }
.close:hover { color: #e6e8ee; }
.row { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.row.column { flex-direction: column; align-items: stretch; gap: 4px; }
label { color: #c3c9d6; }
input[type=text], input[type=number] {
  width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px;
  border: 1px solid #39414f; background: #12151b; color: #e6e8ee; font: inherit;
}
input[type=range] { width: 100%; }
button.action {
  padding: 6px 10px; border-radius: 6px; border: 1px solid #39414f;
  background: #232936; color: #e6e8ee; font: inherit; cursor: pointer;
}
button.action:hover { background: #2b3342; }
button.primary { background: #2f6feb; border-color: #2f6feb; }
button.primary:hover { background: #3b7bf5; }
.hint { color: #8792a6; font-size: 11.5px; margin-top: 6px; }
.status { color: #7dd3a0; font-size: 12px; min-height: 16px; margin-top: 6px; }
.error { color: #f08a8a; }
.trigger {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 36px; height: 36px; border-radius: 18px; cursor: pointer;
  border: 1px solid #39414f; background: #1b1e26; color: #e6e8ee; font-size: 16px;
  box-shadow: 0 6px 20px rgba(0,0,0,.35);
}
.trigger:hover { background: #2b3342; }
.hidden { display: none; }
`;
/** Build one labelled checkbox bound to a settings field. */
function checkbox(label, checked, onChange) {
	const row = document.createElement("label");
	row.className = "row";
	const input = document.createElement("input");
	input.type = "checkbox";
	input.checked = checked;
	input.addEventListener("change", () => {
		onChange(input.checked);
	});
	const text = document.createElement("span");
	text.textContent = label;
	row.append(input, text);
	return row;
}
/**
* Mount the floating bell and its settings panel.
* @param options - storage and playback callbacks.
* @returns disposer that removes every node it created.
*/
function mountSettingsPanel(options) {
	const host = document.createElement("div");
	host.setAttribute("data-dsh-plugin-sound", "");
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = STYLE;
	const trigger = document.createElement("button");
	trigger.className = "trigger";
	trigger.type = "button";
	trigger.title = "Notification sound settings";
	trigger.setAttribute("aria-label", "Notification sound settings");
	trigger.textContent = "🔔";
	const panel = document.createElement("div");
	panel.className = "panel hidden";
	const status = document.createElement("div");
	status.className = "status";
	const setStatus = (text, isError = false) => {
		status.textContent = text;
		status.classList.toggle("error", isError);
		if (text !== "") window.setTimeout(() => {
			if (status.textContent === text) status.textContent = "";
		}, 4e3);
	};
	const render = () => {
		const settings = options.getSettings();
		panel.replaceChildren();
		const header = document.createElement("div");
		header.className = "header";
		const title = document.createElement("span");
		title.className = "title";
		title.textContent = "Notification sound";
		const close = document.createElement("button");
		close.className = "close";
		close.type = "button";
		close.textContent = "✕";
		close.addEventListener("click", () => {
			panel.classList.add("hidden");
		});
		header.append(title, close);
		const enabled = checkbox("Play a sound when a turn finishes", settings.enabled, (value) => {
			update({ enabled: value });
		});
		const sourceRow = document.createElement("div");
		sourceRow.className = "row column";
		const sourceLabel = document.createElement("label");
		sourceLabel.textContent = "Sound";
		const sources = [
			["builtin", "Built-in chime (no file needed)"],
			["file", "Imported file (WAV / OGG / MP3)"],
			["url", "Direct audio URL"]
		];
		sourceRow.append(sourceLabel);
		for (const [value, text] of sources) {
			const option = document.createElement("label");
			option.className = "row";
			const radio = document.createElement("input");
			radio.type = "radio";
			radio.name = "dsh-sound-source";
			radio.checked = settings.source === value;
			radio.addEventListener("change", () => {
				if (radio.checked) update({ source: value });
			});
			const label = document.createElement("span");
			label.textContent = text;
			option.append(radio, label);
			sourceRow.append(option);
		}
		const fileRow = document.createElement("div");
		fileRow.className = "row column";
		const fileLabel = document.createElement("label");
		fileLabel.textContent = options.clipLabel() === "" ? "No file imported yet" : `Imported: ${options.clipLabel()}`;
		const fileActions = document.createElement("div");
		fileActions.className = "row";
		const picker = document.createElement("input");
		picker.type = "file";
		picker.accept = "audio/*,.wav,.ogg,.mp3,.m4a,.flac";
		picker.className = "hidden";
		picker.addEventListener("change", () => {
			const file = picker.files?.[0];
			if (file === void 0) return;
			options.importFile(file).then((error) => {
				if (error !== null) {
					setStatus(error, true);
					return;
				}
				update({ source: "file" });
				setStatus("Imported.");
				render();
			});
		});
		const importButton = document.createElement("button");
		importButton.className = "action";
		importButton.type = "button";
		importButton.textContent = "Choose file…";
		importButton.addEventListener("click", () => {
			picker.click();
		});
		fileActions.append(importButton);
		if (options.clipLabel() !== "") {
			const clearButton = document.createElement("button");
			clearButton.className = "action";
			clearButton.type = "button";
			clearButton.textContent = "Remove";
			clearButton.addEventListener("click", () => {
				options.clearFile().then(() => {
					setStatus("Removed.");
					render();
				});
			});
			fileActions.append(clearButton);
		}
		fileRow.append(fileLabel, fileActions, picker);
		const urlRow = document.createElement("div");
		urlRow.className = "row column";
		const urlLabel = document.createElement("label");
		urlLabel.textContent = "Audio URL (https, .mp3/.ogg/.wav)";
		const urlInput = document.createElement("input");
		urlInput.type = "text";
		urlInput.placeholder = "https://example.com/ding.mp3";
		urlInput.value = settings.url;
		urlInput.addEventListener("change", () => {
			update({
				url: urlInput.value,
				source: "url"
			});
		});
		urlRow.append(urlLabel, urlInput);
		const volumeRow = document.createElement("div");
		volumeRow.className = "row column";
		const volumeLabel = document.createElement("label");
		volumeLabel.textContent = `Volume: ${Math.round(settings.volume * 100)}%`;
		const volume = document.createElement("input");
		volume.type = "range";
		volume.min = "0";
		volume.max = "100";
		volume.step = "5";
		volume.value = String(Math.round(settings.volume * 100));
		volume.addEventListener("input", () => {
			volumeLabel.textContent = `Volume: ${volume.value}%`;
			update({ volume: Number(volume.value) / 100 }, false);
		});
		volumeRow.append(volumeLabel, volume);
		const hiddenOnly = checkbox("Only when this window is not focused", settings.onlyWhenHidden, (value) => {
			update({ onlyWhenHidden: value });
		});
		const mainOnly = checkbox("Ignore background sessions (subagents)", settings.onlyMainSession, (value) => {
			update({ onlyMainSession: value });
		});
		const minRow = document.createElement("div");
		minRow.className = "row";
		const minLabel = document.createElement("label");
		minLabel.textContent = "Skip turns shorter than";
		const minInput = document.createElement("input");
		minInput.type = "number";
		minInput.min = "0";
		minInput.max = "600";
		minInput.step = "1";
		minInput.value = String(Math.round(settings.minTurnMs / 1e3));
		minInput.style.width = "72px";
		minInput.addEventListener("change", () => {
			update({ minTurnMs: Math.max(0, Math.min(600, Number(minInput.value) || 0)) * 1e3 });
		});
		const seconds = document.createElement("span");
		seconds.textContent = "s";
		minRow.append(minLabel, minInput, seconds);
		const actions = document.createElement("div");
		actions.className = "row";
		const testButton = document.createElement("button");
		testButton.className = "action primary";
		testButton.type = "button";
		testButton.textContent = "Test sound";
		testButton.addEventListener("click", () => {
			options.test();
		});
		actions.append(testButton);
		const hint = document.createElement("div");
		hint.className = "hint";
		hint.textContent = "You are responsible for the rights to any audio you import or link. Nothing is uploaded anywhere.";
		panel.append(header, enabled, sourceRow, fileRow, urlRow, volumeRow, hiddenOnly, mainOnly, minRow, actions, status, hint);
	};
	/** Apply one change, persist it, and re-render the panel. */
	function update(patch, rerender = true) {
		options.save({
			...options.getSettings(),
			...patch
		});
		if (rerender) render();
	}
	trigger.addEventListener("click", () => {
		const open = panel.classList.contains("hidden");
		if (open) render();
		panel.classList.toggle("hidden", !open);
	});
	shadow.append(style, trigger, panel);
	document.body.append(host);
	return () => {
		host.remove();
	};
}

//#endregion
//#region src/client/index.ts
/** Services this plugin needs. `sessions` is optional and read defensively. */
const inject = ["remote"];
/**
* Mount the notifier.
* @param ctx - browser plugin context.
*/
function apply(ctx) {
	let settings = loadSettings();
	let clip;
	let disposed = false;
	const player = new SoundPlayer();
	const tracker = new TurnTracker();
	/**
	* Whether a Session is the one the user is looking at. Unknown rows count as
	* focused, so a version change degrades to "ring more" rather than silence.
	*/
	const isMainSession = (sessionId) => {
		try {
			const row = ctx.sessions?.list?.getSnapshot().byId[sessionId];
			if (row === void 0) return true;
			return (row.retainedBy?.mainView ?? 0) > 0;
		} catch {
			return true;
		}
	};
	/** Play whichever sound the settings select, falling back to the chime. */
	const ring = async () => {
		if (settings.source === "url") {
			if (isPlayableUrl(settings.url) && await player.playUrl(settings.url, settings.volume)) return;
			player.playBuiltin(settings.volume);
			return;
		}
		if (settings.source === "file" && clip !== void 0) {
			if (!player.matches(clip.blob)) try {
				await player.prepare(clip.blob);
			} catch {
				player.playBuiltin(settings.volume);
				return;
			}
			if (player.playClip(settings.volume)) return;
		}
		player.playBuiltin(settings.volume);
	};
	const unsubscribe = ctx.remote.$on("api-session/status", (sessionId, running) => {
		const finish = tracker.observe(sessionId, running, Date.now());
		if (finish === null || disposed) return;
		if (skipReason(settings, {
			elapsedMs: finish.elapsedMs,
			hidden: document.visibilityState === "hidden",
			mainSession: isMainSession(finish.sessionId)
		}) !== null) return;
		ring();
	});
	(async () => {
		clip = await loadClip();
		if (clip !== void 0) try {
			await player.prepare(clip.blob);
		} catch {}
	})();
	const removePanel = mountSettingsPanel({
		getSettings: () => settings,
		save: (next) => {
			settings = normalizeSettings(next);
			saveSettings(settings);
		},
		importFile: async (file) => {
			const rejection = fileRejection(file);
			if (rejection !== null) return rejection;
			let durationMs = 0;
			try {
				durationMs = await player.prepare(file);
			} catch {
				return "That file could not be decoded as audio.";
			}
			if (durationMs > MAX_SOUND_MS) return `That clip is ${(durationMs / 1e3).toFixed(1)}s — keep notification sounds under ${MAX_SOUND_MS / 1e3}s.`;
			const stored = {
				blob: file,
				name: file.name,
				durationMs,
				addedAt: Date.now()
			};
			if (!await saveClip(stored)) return "Could not save that file (browser storage is unavailable).";
			clip = stored;
			return null;
		},
		clearFile: async () => {
			await clearClip();
			clip = void 0;
			player.reset();
		},
		clipLabel: () => clip === void 0 ? "" : `${clip.name} · ${(clip.durationMs / 1e3).toFixed(2)}s`,
		test: ring
	});
	ctx.effect(() => () => {
		disposed = true;
		unsubscribe();
		removePanel();
		tracker.clear();
		player.reset();
		SoundPlayer.dispose();
	}, "sound-notify: teardown");
}

//#endregion
exports.apply = apply;
exports.inject = inject;
return module.exports; } });