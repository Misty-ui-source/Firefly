/**
 * 明信移动端底部 Dock 控制器（移植自 MmzMing/my-blog 的 MobileDock 内嵌脚本，
 * 机制与数值照原版；差异只有数据源与接法）：
 * - 音乐不走原版的 window.__fireflyMusic，改走本站播放器引擎的门面
 *   window.__mingxinMusic（MingxinMusicPlayer 在引擎关键点派发
 *   mxmusic:state / mxmusic:time 两个事件，Dock 订阅同步）；
 * - 目录视图不走原版 TOCManager，改按思维导图同一口径实时采集正文标题
 *   （.custom-md/.prose/.markdown-content + 最浅层起 3 级窗口）；
 * - 导航后同步走本站 swup 的 swup:page:view（原版 onNavigation 等价点）；
 * - 条左键未播放时开菜单视图（原版开顶栏资料卡，本站无对应移动端面板）。
 * 显隐本身由 CSS 负责（明信 + ≤768px），本控制器不判形态/断点。
 */
import { getStoredTheme, setTheme } from "@/utils/setting-utils";

export interface MxMusicTrack {
	name: string;
	artist: string;
	pic: string;
}

export interface MxMusicState {
	isPlaying: boolean;
	currentIndex: number;
	track: MxMusicTrack | null;
	playlist: MxMusicTrack[];
	currentTime: number;
	duration: number;
	currentTimeStr: string;
	durationStr: string;
	progress: number;
	mode: "sequence" | "one" | "random";
	volume: number;
	isMuted: boolean;
	lyric: string;
}

export interface MxMusicApi {
	getState(): MxMusicState;
	togglePlay(): void;
	playNext(): void;
	playPrev(): void;
	playTrackByIndex(index: number): void;
	cycleMode(): void;
	seek(ratio: number): void;
	toggleMute(): void;
}

declare global {
	interface Window {
		__mingxinMusic?: MxMusicApi;
		__mxdockBooted?: boolean;
	}
}

type DockShape = "pill" | "bubble" | "card";
type DockView = "menu" | "music" | "toc";

export function bootMingxinMobileDock(): void {
	if (window.__mxdockBooted) return;
	const dock = document.getElementById("mxdock");
	const overlay = document.getElementById("mxdock-overlay");
	if (!dock || !overlay) return;
	window.__mxdockBooted = true;

	const card = document.getElementById("mxdock-card") as HTMLElement;
	const cardInner = card.querySelector<HTMLElement>(
		".mxdock__card-inner",
	) as HTMLElement;
	const contextButton = document.getElementById(
		"mxdock-context-btn",
	) as HTMLButtonElement;
	const menuButton = document.getElementById(
		"mxdock-menu-btn",
	) as HTMLButtonElement;
	const viewTitle = document.getElementById("mxdock-view-title") as HTMLElement;
	const lyricViewport = document.getElementById(
		"mxdock-lyric-viewport",
	) as HTMLElement;
	const lyricText = document.getElementById("mxdock-lyric-text") as HTMLElement;
	if (
		!card ||
		!cardInner ||
		!contextButton ||
		!menuButton ||
		!viewTitle ||
		!lyricViewport ||
		!lyricText
	)
		return;

	const siteTitle =
		dock
			.querySelector<HTMLElement>(".mxdock__site-title")
			?.textContent?.trim() || document.title;
	const views = Array.from(
		dock.querySelectorAll<HTMLElement>("[data-dock-view]"),
	);
	const viewButtons = Array.from(
		dock.querySelectorAll<HTMLButtonElement>("[data-view-target]"),
	);
	const playlist = document.getElementById("mxdock-playlist");
	const musicEmpty = document.getElementById("mxdock-music-empty");
	const progress = document.getElementById(
		"mxdock-progress",
	) as HTMLInputElement | null;
	const currentTime = document.getElementById("mxdock-current-time");
	const durationEl = document.getElementById("mxdock-duration");
	const playButton = document.getElementById(
		"mxdock-play-btn",
	) as HTMLButtonElement | null;
	const modeButton = document.getElementById(
		"mxdock-mode-btn",
	) as HTMLButtonElement | null;
	const muteButton = document.getElementById(
		"mxdock-mute-btn",
	) as HTMLButtonElement | null;
	const playIcon = playButton?.querySelector<HTMLElement>(".mxdock__play-icon");
	const pauseIcon = playButton?.querySelector<HTMLElement>(
		".mxdock__pause-icon",
	);
	const modeListIcon = modeButton?.querySelector<HTMLElement>(
		".mxdock__mode-list-icon",
	);
	const modeSingleIcon = modeButton?.querySelector<HTMLElement>(
		".mxdock__mode-single-icon",
	);
	const modeShuffleIcon = modeButton?.querySelector<HTMLElement>(
		".mxdock__mode-shuffle-icon",
	);
	const volumeUpIcon = muteButton?.querySelector<HTMLElement>(
		".mxdock__volume-up-icon",
	);
	const volumeOffIcon = muteButton?.querySelector<HTMLElement>(
		".mxdock__volume-off-icon",
	);
	const tocButton = document.getElementById("mxdock-toc-btn");
	const tocContent = document.getElementById("mxdock-toc-content");
	const commentButton = document.getElementById("mxdock-comment-btn");
	const topButton = document.getElementById("mxdock-top-btn");

	let shape: DockShape = "pill";
	let activeView: DockView = "menu";
	let musicState: MxMusicState | null = null;
	let displayedLyric = "";
	let playlistSignature = "";
	let lastFocusedPlaylistIndex: number | null = null;
	let lastScrollY = window.scrollY;
	let idleExpandTimer: number | null = null;
	let previousFocus: HTMLElement | null = null;
	let previousBodyOverflow = "";
	let keyboardOpen = false;
	let scrollFrame: number | null = null;
	let closingTimer: number | null = null;
	let scrubbing = false;
	let tocEntries: { el: HTMLElement; depth: number; text: string }[] = [];

	function prefersReducedMotion(): boolean {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}

	function clearMotionTimers(): void {
		if (closingTimer !== null) window.clearTimeout(closingTimer);
		closingTimer = null;
		dock.classList.remove("is-closing");
		overlay.classList.remove("is-closing");
	}

	function setShape(nextShape: DockShape): void {
		if (shape === nextShape) return;
		const wasCard = shape === "card";
		shape = nextShape;
		dock.dataset.shape = shape;
		const isCard = shape === "card";
		menuButton.setAttribute("aria-expanded", String(isCard));
		menuButton.setAttribute("aria-label", isCard ? "关闭" : "菜单");
		card.setAttribute("aria-hidden", String(!isCard));
		overlay.classList.toggle("is-open", isCard);
		if (!isCard) overlay.classList.remove("is-closing");
		overlay.setAttribute("aria-hidden", String(!isCard));

		if (isCard) {
			previousFocus =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: menuButton;
			previousBodyOverflow = document.body.style.overflow;
			document.body.style.overflow = "hidden";
			requestAnimationFrame(() => cardInner.focus({ preventScroll: true }));
		} else if (wasCard) {
			document.body.style.overflow = previousBodyOverflow;
			previousFocus?.focus({ preventScroll: true });
			setView("menu");
		}
		if (nextShape === "pill") scheduleLyricMarquee();
	}

	function openCard(view: DockView = "menu"): void {
		setView(view);
		if (shape === "card") {
			clearMotionTimers();
			return;
		}
		setShape("card");
	}

	function closeCard(): void {
		if (shape !== "card" || dock.classList.contains("is-closing")) return;
		if (prefersReducedMotion()) {
			setShape("pill");
			return;
		}
		dock.classList.add("is-closing");
		overlay.classList.add("is-closing");
		closingTimer = window.setTimeout(() => {
			closingTimer = null;
			setShape("pill");
			dock.classList.remove("is-closing");
		}, 500);
	}

	function setView(nextView: DockView): void {
		const target = views.find((view) => view.dataset.dockView === nextView);
		if (!target) return;
		activeView = nextView;
		dock.dataset.view = activeView;
		views.forEach((view) => {
			const active = view === target;
			view.hidden = !active;
			view.classList.toggle("is-active", active);
		});
		viewButtons.forEach((button) => {
			const active = button.dataset.viewTarget === activeView;
			button.classList.toggle("is-active", active);
			button.setAttribute("aria-pressed", String(active));
		});
		viewTitle.textContent =
			(nextView === "music" && musicState?.track?.name) ||
			target.dataset.title ||
			"菜单";
		dock.classList.toggle("is-child-view", activeView !== "menu");
		contextButton.setAttribute(
			"aria-label",
			activeView === "menu" ? siteTitle : "菜单",
		);
		if (activeView === "toc") buildToc();
		target.scrollTop = 0;
	}

	function closeOpenAccordion(except?: HTMLElement): void {
		dock
			.querySelectorAll<HTMLElement>("[data-dock-accordion]")
			.forEach((accordion) => {
				if (accordion === except) return;
				accordion.classList.remove("is-open");
				const trigger = accordion.querySelector<HTMLButtonElement>(
					".mxdock__accordion-trigger",
				);
				const panel = accordion.querySelector<HTMLElement>(".mxdock__submenu");
				trigger?.setAttribute("aria-expanded", "false");
				if (panel) {
					panel.setAttribute("aria-hidden", "true");
					panel.inert = true;
				}
			});
	}

	dock
		.querySelectorAll<HTMLElement>("[data-dock-accordion]")
		.forEach((accordion) => {
			const trigger = accordion.querySelector<HTMLButtonElement>(
				".mxdock__accordion-trigger",
			);
			const panel = accordion.querySelector<HTMLElement>(".mxdock__submenu");
			trigger?.addEventListener("click", () => {
				const willOpen = !accordion.classList.contains("is-open");
				closeOpenAccordion(accordion);
				accordion.classList.toggle("is-open", willOpen);
				trigger.setAttribute("aria-expanded", String(willOpen));
				if (panel) {
					panel.setAttribute("aria-hidden", String(!willOpen));
					panel.inert = !willOpen;
				}
			});
		});

	/* —— 条左键的歌词位：播放中显示当前歌词行（无歌词时退歌名），超宽跑马灯 —— */
	function scheduleLyricMarquee(): void {
		requestAnimationFrame(() => {
			lyricText.classList.remove("is-marquee");
			lyricText.style.removeProperty("--mxdock-lyric-offset");
			lyricText.style.removeProperty("--mxdock-lyric-duration");
			if (!dock.classList.contains("has-playing-context") || shape !== "pill")
				return;
			const overflow = lyricText.scrollWidth - lyricViewport.clientWidth;
			if (overflow <= 2) return;
			lyricText.style.setProperty(
				"--mxdock-lyric-offset",
				`${-Math.ceil(overflow)}px`,
			);
			lyricText.style.setProperty(
				"--mxdock-lyric-duration",
				`${Math.max(5, overflow / 28 + 3).toFixed(2)}s`,
			);
			lyricText.classList.add("is-marquee");
		});
	}

	function updateContext(): void {
		const track = musicState?.track;
		const isPlaying = !!musicState?.isPlaying && !!track;
		dock.classList.toggle("has-playing-context", isPlaying);
		if (!isPlaying || !track) {
			if (displayedLyric) {
				displayedLyric = "";
				lyricText.textContent = "";
				scheduleLyricMarquee();
			}
			contextButton.setAttribute("aria-label", siteTitle);
			return;
		}
		const content = musicState?.lyric || track.name;
		if (content !== displayedLyric) {
			displayedLyric = content;
			lyricText.textContent = content;
			scheduleLyricMarquee();
		}
		contextButton.setAttribute("aria-label", `${track.name}: ${content}`);
	}

	function updateMusicViewTitle(): void {
		if (activeView !== "music") return;
		viewTitle.textContent = musicState?.track?.name || "音乐";
	}

	function updateMusicControls(): void {
		if (
			!progress ||
			!currentTime ||
			!durationEl ||
			!playButton ||
			!playIcon ||
			!pauseIcon
		)
			return;
		if (!scrubbing) {
			const value = musicState?.progress || 0;
			progress.value = String(value);
			progress.style.setProperty("--mxdock-progress", `${value}%`);
			currentTime.textContent = musicState?.currentTimeStr || "0:00";
		}
		durationEl.textContent = musicState?.durationStr || "0:00";
		const isPlaying = !!musicState?.isPlaying;
		playIcon.classList.toggle("is-hidden", isPlaying);
		pauseIcon.classList.toggle("is-hidden", !isPlaying);
		playButton.setAttribute("aria-label", isPlaying ? "暂停" : "播放");

		const mode = musicState?.mode || "sequence";
		modeListIcon?.classList.toggle("is-hidden", mode !== "sequence");
		modeSingleIcon?.classList.toggle("is-hidden", mode !== "one");
		modeShuffleIcon?.classList.toggle("is-hidden", mode !== "random");
		modeButton?.classList.toggle("is-active", mode !== "sequence");
		modeButton?.setAttribute(
			"aria-label",
			`播放模式：${mode === "sequence" ? "顺序播放" : mode === "one" ? "单曲循环" : "随机播放"}`,
		);
		modeButton?.setAttribute("aria-pressed", String(mode !== "sequence"));

		const isMuted = !!musicState?.isMuted || !musicState?.volume;
		volumeUpIcon?.classList.toggle("is-hidden", isMuted);
		volumeOffIcon?.classList.toggle("is-hidden", !isMuted);
		muteButton?.classList.toggle("is-active", isMuted);
		muteButton?.setAttribute(
			"aria-label",
			`音量: ${isMuted ? "0%" : `${Math.round((musicState?.volume || 0) * 100)}%`}`,
		);
		muteButton?.setAttribute("aria-pressed", String(isMuted));
	}

	function updatePlaylistState(): void {
		if (!playlist || !musicState) return;
		playlist
			.querySelectorAll<HTMLElement>(".mxdock__playlist-item")
			.forEach((item) => {
				const index = Number.parseInt(item.dataset.index || "-1", 10);
				const active = index === musicState?.currentIndex;
				item.classList.toggle("is-active", active);
				item.classList.toggle("is-playing", active && !!musicState?.isPlaying);
				item.setAttribute("aria-selected", String(active));
				if (active) item.setAttribute("aria-current", "true");
				else item.removeAttribute("aria-current");
			});
		const activeItem = playlist.querySelector<HTMLElement>(
			".mxdock__playlist-item.is-active",
		);
		if (
			activeItem &&
			activeView === "music" &&
			lastFocusedPlaylistIndex !== musicState.currentIndex
		) {
			activeItem.scrollIntoView({ block: "nearest" });
			lastFocusedPlaylistIndex = musicState.currentIndex;
		}
	}

	function renderPlaylist(): void {
		if (!playlist || !musicEmpty || !musicState) return;
		const signature = musicState.playlist
			.map((track) => `${track.name} ${track.artist} ${track.pic}`)
			.join("");
		if (signature === playlistSignature) {
			updatePlaylistState();
			return;
		}
		playlistSignature = signature;
		lastFocusedPlaylistIndex = null;
		playlist.replaceChildren();

		if (musicState.playlist.length === 0) {
			musicEmpty.textContent = "歌单是空的";
			playlist.appendChild(musicEmpty);
			return;
		}

		musicState.playlist.forEach((track, index) => {
			const item = document.createElement("button");
			item.type = "button";
			item.className = "mxdock__playlist-item";
			item.dataset.index = String(index);
			item.setAttribute("role", "option");

			const cover = document.createElement("span");
			cover.className = "mxdock__playlist-cover";
			if (track.pic) {
				const image = document.createElement("img");
				image.src = track.pic;
				image.alt = "";
				image.loading = "lazy";
				image.addEventListener("error", () => image.remove(), { once: true });
				cover.appendChild(image);
			}

			const meta = document.createElement("span");
			meta.className = "mxdock__playlist-meta";
			const name = document.createElement("strong");
			name.textContent = track.name;
			const artist = document.createElement("span");
			artist.textContent = track.artist;
			meta.appendChild(name);
			meta.appendChild(artist);

			const equalizer = document.createElement("span");
			equalizer.className = "mxdock__playlist-eq";
			equalizer.setAttribute("aria-hidden", "true");
			equalizer.appendChild(document.createElement("i"));
			equalizer.appendChild(document.createElement("i"));
			equalizer.appendChild(document.createElement("i"));

			item.appendChild(cover);
			item.appendChild(meta);
			item.appendChild(equalizer);
			item.addEventListener("click", () =>
				window.__mingxinMusic?.playTrackByIndex(index),
			);
			playlist.appendChild(item);
		});
		updatePlaylistState();
	}

	function syncMusicState(): void {
		const manager = window.__mingxinMusic;
		if (!manager) return;
		musicState = manager.getState();
		updateContext();
		updateMusicViewTitle();
		updateMusicControls();
		renderPlaylist();
	}

	function syncMusicTime(): void {
		const manager = window.__mingxinMusic;
		if (!manager) return;
		musicState = manager.getState();
		if (!scrubbing && progress && currentTime) {
			const value = musicState.progress || 0;
			progress.value = String(value);
			progress.style.setProperty("--mxdock-progress", `${value}%`);
			currentTime.textContent = musicState.currentTimeStr || "0:00";
		}
		if (durationEl) durationEl.textContent = musicState.durationStr || "0:00";
	}

	/* —— 目录视图：实时采集正文标题（与思维导图同一口径） —— */
	function collectToc(): void {
		const content =
			document.querySelector(".custom-md") ??
			document.querySelector(".prose") ??
			document.querySelector(".markdown-content");
		tocEntries = [];
		if (!content) return;
		const all = Array.from(
			content.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
		);
		if (!all.length) return;
		let minDepth = 10;
		for (const el of all)
			minDepth = Math.min(minDepth, Number.parseInt(el.tagName.slice(1), 10));
		for (const el of all) {
			const depth = Number.parseInt(el.tagName.slice(1), 10) - minDepth;
			if (depth >= 3) continue;
			// 标题尾部的锚点链接（a.anchor > span.anchor-icon 的「#」）不进目录文本
			const clone = el.cloneNode(true) as HTMLElement;
			clone.querySelectorAll("a.anchor").forEach((a) => {
				a.remove();
			});
			const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
			if (!text) continue;
			tocEntries.push({ el, depth, text });
		}
	}

	function buildToc(): void {
		if (!tocContent) return;
		collectToc();
		tocContent.replaceChildren();
		if (!tocEntries.length) {
			const p = document.createElement("p");
			p.className = "mxdock__empty";
			p.textContent = "暂无目录";
			tocContent.appendChild(p);
			return;
		}
		for (const entry of tocEntries) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "mxdock__toc-link";
			btn.dataset.depth = String(Math.min(entry.depth, 2));
			btn.textContent = entry.text;
			btn.addEventListener("click", () => {
				const top = entry.el.getBoundingClientRect().top + window.scrollY - 80;
				closeCard();
				window.scrollTo({ top, behavior: "smooth" });
			});
			tocContent.appendChild(btn);
		}
	}

	function updateThemeIcon(): void {
		const isDark = document.documentElement.classList.contains("dark");
		dock
			.querySelector<HTMLElement>(".mxdock__theme-light")
			?.classList.toggle("is-hidden", isDark);
		dock
			.querySelector<HTMLElement>(".mxdock__theme-dark")
			?.classList.toggle("is-hidden", !isDark);
	}

	function updatePathDependent(): void {
		collectToc();
		const hasComment = !!document.getElementById("post-comments");
		tocButton?.classList.toggle("is-hidden", tocEntries.length === 0);
		commentButton?.classList.toggle("is-hidden", !hasComment);
		topButton?.classList.toggle("is-hidden", window.scrollY <= 200);
		if (tocEntries.length === 0 && activeView === "toc") setView("menu");
	}

	function scheduleIdleExpand(): void {
		if (idleExpandTimer !== null) window.clearTimeout(idleExpandTimer);
		idleExpandTimer = window.setTimeout(() => {
			if (!keyboardOpen && shape === "bubble") setShape("pill");
		}, 1800);
	}

	function onScroll(): void {
		if (scrollFrame !== null) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = null;
			const y = window.scrollY;
			const delta = y - lastScrollY;
			lastScrollY = y;
			topButton?.classList.toggle("is-hidden", y <= 200);
			if (keyboardOpen || shape === "card") return;
			if (delta >= 8 && y > 80) setShape("bubble");
			else if (delta <= -8) setShape("pill");
			scheduleIdleExpand();
		});
	}

	function setKeyboardOpen(open: boolean): void {
		keyboardOpen = open;
		dock.classList.toggle("is-keyboard-open", open);
		if (open && shape === "card") closeCard();
	}

	menuButton.addEventListener("click", () => {
		if (shape === "bubble") {
			setShape("pill");
			return;
		}
		if (dock.classList.contains("is-closing")) openCard("menu");
		else if (shape === "card") closeCard();
		else openCard("menu");
	});

	contextButton.addEventListener("click", () => {
		if (shape === "bubble") {
			setShape("pill");
			return;
		}
		if (shape === "card") {
			if (activeView !== "menu") setView("menu");
			return;
		}
		// 播放中条左键进音乐视图；未播放开菜单视图（本站无顶栏资料卡的移动端对应物）
		if (musicState?.isPlaying && musicState.track) openCard("music");
		else openCard("menu");
	});

	overlay.addEventListener("click", closeCard);
	viewButtons.forEach((button) => {
		button.addEventListener("click", () =>
			setView(button.dataset.viewTarget as DockView),
		);
	});

	dock.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		if (target.closest("[data-dock-navigation]")) closeCard();
	});

	document
		.getElementById("mxdock-search-btn")
		?.addEventListener("click", () => {
			closeCard();
			// 与明信顶栏工具面板同一触发口：程序化点本站搜索开关
			document.getElementById("search-switch")?.click();
		});

	document.getElementById("mxdock-theme-btn")?.addEventListener("click", () => {
		const current = getStoredTheme();
		const resolved =
			current === "system"
				? document.documentElement.classList.contains("dark")
					? "dark"
					: "light"
				: current;
		setTheme(resolved === "light" ? "dark" : "light");
		updateThemeIcon();
	});

	commentButton?.addEventListener("click", () => {
		closeCard();
		document
			.getElementById("post-comments")
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	});

	topButton?.addEventListener("click", () => {
		closeCard();
		window.scroll({ top: 0, behavior: "smooth" });
	});

	document
		.getElementById("mxdock-prev-btn")
		?.addEventListener("click", () => window.__mingxinMusic?.playPrev());
	modeButton?.addEventListener("click", () =>
		window.__mingxinMusic?.cycleMode(),
	);
	playButton?.addEventListener("click", () =>
		window.__mingxinMusic?.togglePlay(),
	);
	document
		.getElementById("mxdock-next-btn")
		?.addEventListener("click", () => window.__mingxinMusic?.playNext());
	muteButton?.addEventListener("click", () =>
		window.__mingxinMusic?.toggleMute(),
	);
	progress?.addEventListener("input", () => {
		scrubbing = true;
		const value = Number.parseFloat(progress.value);
		progress.style.setProperty("--mxdock-progress", `${value}%`);
		window.__mingxinMusic?.seek(value / 100);
	});
	progress?.addEventListener("change", () => {
		scrubbing = false;
	});

	lyricViewport.addEventListener(
		"touchstart",
		() => lyricText.classList.add("is-paused"),
		{ passive: true },
	);
	lyricViewport.addEventListener(
		"touchend",
		() => lyricText.classList.remove("is-paused"),
		{ passive: true },
	);

	window.addEventListener("mxmusic:state", syncMusicState);
	window.addEventListener("mxmusic:time", syncMusicTime);
	window.addEventListener("theme-change", updateThemeIcon);
	window.addEventListener("resize", scheduleLyricMarquee, { passive: true });
	window.addEventListener("scroll", onScroll, { passive: true });

	document.addEventListener("focusin", (event) => {
		const target = event.target;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement
		)
			setKeyboardOpen(true);
	});
	document.addEventListener("focusout", () =>
		requestAnimationFrame(() => {
			const active = document.activeElement;
			setKeyboardOpen(
				active instanceof HTMLInputElement ||
					active instanceof HTMLTextAreaElement,
			);
		}),
	);

	document.addEventListener("keydown", (event) => {
		if (shape !== "card") return;
		if (event.key === "Escape") {
			event.preventDefault();
			closeCard();
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = Array.from(
			dock.querySelectorAll<HTMLElement>(
				'a[href]:not([hidden]), button:not([disabled]):not(.is-hidden), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		).filter((element) => element.offsetParent !== null);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	});

	// 导航后收起卡片并同步路径相关状态（首次加载的初始态由末尾直接调用负责）
	document.addEventListener("swup:page:view", () => {
		lastScrollY = window.scrollY;
		setKeyboardOpen(false);
		if (shape === "card") closeCard();
		else setShape("pill");
		closeOpenAccordion();
		updatePathDependent();
		syncMusicState();
	});

	updateThemeIcon();
	updatePathDependent();
	syncMusicState();
}
