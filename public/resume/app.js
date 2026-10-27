/* 简历生成器 · 工作台逻辑：表单引擎 / 模板弹窗 / 本地保存 / 五格式导出
 * 数据只存访客浏览器 localStorage，不经过任何服务器。 */
(function () {
	"use strict";
	var RS = window.RS;
	var LS_KEY = "resume-maker-v1";
	var TPL_BASE = "/resume/templates/";

	var SAMPLE = {
		basics: {
			name: "林小满", title: "前端开发实习生", phone: "138 0000 0000", email: "xiaoman@example.com",
			wechat: "linxiaoman", city: "南京", birth: "2004-06", politics: "共青团员",
			website: "", github: "github.com/xiaoman", photo: "",
			headline: "大三在读 · 能独立交付完整页面 · 连续两年专业前 5%",
		},
		education: [{ school: "东南大学", major: "计算机科学与技术", degree: "本科", start: "2023-09", end: "2027-06", gpa: "3.8 / 4.0", rank: "前 5%", courses: "数据结构（95）、操作系统（92）、计算机网络（90）、数据库系统（93）", honors: "校级一等奖学金（2024、2025）" }],
		work: [{ company: "云杉科技有限公司", role: "前端开发实习生", start: "2025-07", end: "2025-09", points: "独立负责活动页组件库的 12 个组件开发与联调，上线后复用至 3 个业务线\n使用 Vite + Vue 3 重构内部工具页，首屏加载时间从 2.8s 降到 1.1s\n参与 Code Review 与需求评审，输出 2 篇团队技术文档" }],
		projects: [
			{ name: "校园二手交易小程序", role: "独立开发", stack: "微信小程序 · 云开发 · TypeScript", link: "", points: "独立完成商品发布、搜索、下单与消息通知全流程，上线 3 个月用户 2,400+\n引入图片压缩与懒加载，列表滑动帧率稳定在 55fps 以上" },
			{ name: "课程表课设：卫星定位可视化网页", role: "前端负责人", stack: "原生 JS · Canvas · Web Worker", link: "", points: "把桌面端解算程序移植到浏览器，24 小时回放与星空图渲染流畅运行\n与原始程序逐点比对 192 例，最大误差 0.0005m" },
		],
		skills: [
			{ group: "前端", items: "HTML / CSS / JavaScript / TypeScript、Vue 3、Vite、Tailwind CSS", level: "熟练" },
			{ group: "工具", items: "Git、Figma、Chrome DevTools、Linux 基础命令", level: "熟练" },
			{ group: "后端与语言", items: "Node.js 基础、Python（脚本与数据处理）", level: "良好" },
		],
		languages: [{ name: "英语 CET-6", level: "512 分" }, { name: "英语 CET-4", level: "588 分" }],
		certs: [{ name: "计算机三级（数据库技术）", issuer: "教育部考试中心", date: "2025-03" }],
		awards: [
			{ name: "全国大学生数学建模竞赛 省二等奖", level: "省级", date: "2025-09" },
			{ name: "校程序设计大赛 一等奖", level: "校级", date: "2024-11" },
		],
		summary: "基础扎实、交付意识强的前端方向大三学生。熟悉 Vue 3 与 TypeScript 工程化开发，有完整的实习与独立项目交付经验；习惯用数据说话（性能指标、用户量、误差比对），文档与沟通能力经过团队协作验证。",
		sectionMeta: {},
	};

	function blankData() {
		return {
			basics: { name: "", title: "", phone: "", email: "", wechat: "", city: "", birth: "", politics: "", website: "", github: "", photo: "", headline: "" },
			education: [], work: [], projects: [], skills: [], languages: [], certs: [], awards: [],
			summary: "", sectionMeta: {},
		};
	}

	var SAMPLE_EN = {
		basics: { name: "Xiaoman Lin", title: "Frontend Developer Intern", phone: "+86 138 0000 0000", email: "xiaoman@example.com", wechat: "", city: "Nanjing, China", birth: "", politics: "", website: "https://example.com", github: "github.com/xiaoman", photo: "", headline: "B.Eng. candidate · Top 5% of class" },
		summary: "Detail-oriented CS junior with strong foundations in Vue 3 and TypeScript. Shipped a full internship project and an independent mini-program with 2,400+ users.",
		education: [{ school: "Southeast University", major: "Computer Science and Technology", degree: "B.Eng.", start: "2023-09", end: "2027-06", gpa: "3.8 / 4.0", rank: "Top 5%", courses: "Data Structures (95), Operating Systems (92)", honors: "University First-Class Scholarship (2024, 2025)" }],
		work: [{ company: "Yunshan Technology Co., Ltd.", role: "Frontend Developer Intern", start: "2025-07", end: "2025-09", points: "Built 12 reusable components for campaign pages and owned cross-team integration\nRebuilt an internal tool with Vite + Vue 3, cutting first paint from 2.8s to 1.1s" }],
		projects: [{ name: "Campus Second-hand Trading Mini Program", role: "Solo Developer", stack: "WeChat Mini Program · TypeScript", link: "", points: "Shipped listing, search and checkout flows end to end; 2,400+ users in 3 months" }],
		skills: [{ group: "Frontend", items: "Vue 3, TypeScript, Vite, Tailwind CSS", level: "Proficient" }],
		languages: [{ name: "English (CET-6)", level: "512" }, { name: "Mandarin", level: "Native" }],
		certs: [{ name: "NCRE Level 3 (Database Technology)", issuer: "Ministry of Education, China", date: "2025-03" }],
		awards: [{ name: "Mathematical Contest in Modeling, Provincial Second Prize", level: "Provincial", date: "2025-09" }],
		sectionMeta: {},
	};
	function currentPackLang() {
		var id = state.settings.templateId;
		if (catalog) {
			var e = catalog.packs.find(function (p) { return p.id === id; });
			if (e) return e.lang || "zh";
		}
		return id.indexOf("en-") === 0 || id === "theme-concise" ? "en" : "zh";
	}

	var state = { data: blankData(), settings: { templateId: "campus-classic-teal", accent: "", fontSize: "m", leading: "normal" } };
	try {
		var saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
		if (saved && saved.data && saved.settings) state = saved;
	} catch (e) { /* 忽略损坏的存档 */ }

	var packCache = {}; // id -> pack
	var catalog = null; // index.json 的 packs
	var currentPack = null;

	var FONT_SCALE = { s: 0.92, m: 1, l: 1.09 };
	var LEADING = { compact: 1.42, normal: 1.55, loose: 1.74 };
	var ACCENTS = ["", "#0e7c6b", "#1f4e79", "#2b7de9", "#6c4bd8", "#8e2f3c", "#3c4653", "#e0653a"];

	/* ---------- 工具 ---------- */
	function $(sel, root) { return (root || document).querySelector(sel); }
	function el(html) { var d = document.createElement("div"); d.innerHTML = html; return d.firstElementChild; }
	function save() {
		try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 照片过大等 */ }
		var t = new Date();
		var hh = String(t.getHours()).padStart(2, "0"), mm = String(t.getMinutes()).padStart(2, "0");
		var s = $("#rs-saved"); if (s) s.textContent = "已自动保存 " + hh + ":" + mm;
	}
	var saveTimer = null;
	function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }
	function download(name, blob) {
		var a = document.createElement("a");
		a.href = URL.createObjectURL(blob); a.download = name;
		document.body.appendChild(a); a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
	}
	function renderSettings() {
		return { accent: state.settings.accent || "", fontScale: FONT_SCALE[state.settings.fontSize] || 1, leading: LEADING[state.settings.leading] || 1.55 };
	}
	function renderWith(pack) { return RS.render(state.data, pack, renderSettings()); }

	/* ---------- 模板包加载 ---------- */
	function ensurePackCss(pack) {
		if (!pack.css) return;
		var id = "rs-pack-css-" + pack.id;
		if (document.getElementById(id)) return;
		var st = document.createElement("style"); st.id = id; st.textContent = pack.css;
		document.head.appendChild(st);
	}
	function loadPack(id) {
		if (packCache[id]) return Promise.resolve(packCache[id]);
		var meta = catalog && catalog.find(function (p) { return p.id === id; });
		if (!meta) { // 目录还没到或内置模板
			var fb = RS.FALLBACK.find(function (p) { return p.id === id; }) || RS.FALLBACK[0];
			packCache[fb.id] = fb; return Promise.resolve(fb);
		}
		return fetch(TPL_BASE + meta.file)
			.then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
			.then(function (pack) { packCache[id] = pack; ensurePackCss(pack); return pack; })
			.catch(function () {
				var fb = RS.FALLBACK.find(function (p) { return p.cat === meta.cat; }) || RS.FALLBACK[0];
				packCache[id] = fb; return fb;
			});
	}
	function loadCatalog() {
		return fetch(TPL_BASE + "index.json")
			.then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
			.then(function (j) { catalog = j.packs || []; return catalog; })
			.catch(function () { catalog = RS.FALLBACK.slice(); return catalog; });
	}

	/* ---------- 预览 ---------- */
	var zoomMode = "fit", zoomVal = 1;
	function applyZoom() {
		var wrap = $("#rs-preview-wrap"), page = $("#rs-page"), scaler = $("#rs-scaler");
		if (!wrap || !page) return;
		var root = page.querySelector(".rsr-root");
		var h = root ? root.offsetHeight : 1123;
		var avail = Math.max(wrap.clientWidth - 36, 200);
		var s = zoomMode === "fit" ? Math.min(avail / 794, 1.6) : zoomVal;
		page.style.transform = "scale(" + s + ")";
		scaler.style.width = 794 * s + "px";
		scaler.style.height = h * s + "px";
	}
	function renderPreview() {
		if (!currentPack) return;
		$("#rs-page").innerHTML = renderWith(currentPack);
		$("#rs-current-name").textContent = currentPack.name;
		var thumb = $("#rs-current-thumb");
		thumb.innerHTML = '<div class="rs-thumb-scale">' + renderWith(currentPack) + "</div>";
		applyZoom();
	}

	/* ---------- 表单 ---------- */
	var FIELD_DEFS = {
		basics: [
			["name", "姓名", "如：林小满"], ["title", "求职意向", "如：前端开发实习生"],
			["phone", "电话", "如：138 0000 0000"], ["email", "邮箱", "name@example.com"],
			["wechat", "微信", "微信号"], ["city", "所在城市", "如：南京"],
			["birth", "出生年月", "如：2004-06"], ["politics", "政治面貌", "如：共青团员 / 中共党员"],
			["website", "个人网站", "https://example.com"], ["github", "GitHub", "github.com/你的账号"],
			["headline", "一句话简介", "如：大三在读 · 专业前 5% · 有完整项目交付经验", "full"],
		],
		education: [["school", "学校", "如：东南大学"], ["major", "专业", "计算机科学与技术"], ["degree", "学历", "本科 / 硕士 / 博士"], ["start", "入学", "2023-09"], ["end", "毕业", "2027-06"], ["gpa", "GPA", "3.8 / 4.0"], ["rank", "排名", "前 5%"], ["courses", "主修课程", "课程名（成绩）用顿号隔开", "full"], ["honors", "在校荣誉", "如：校级一等奖学金（2024、2025）", "full"]],
		work: [["company", "公司 / 单位", "公司名称"], ["role", "职位", "如：前端开发实习生"], ["start", "开始", "2025-07"], ["end", "结束", "2025-09， 在职填空"], ["points", "工作内容（每行一条，尽量带数字）", "独立负责……，上线后……\n使用……，指标从 X 降到 Y", "textarea"]],
		projects: [["name", "项目名称", "项目名称"], ["role", "担任角色", "独立开发 / 前端负责人"], ["stack", "技术栈", "Vue 3 · TypeScript · Vite", "full"], ["link", "项目链接", "可留空", "full"], ["points", "项目描述（每行一条，尽量带数字）", "完成……全流程，用户量……\n引入……，性能从 X 提升到 Y", "textarea"]],
		skills: [["group", "分组名", "如：前端"], ["level", "熟练度", "熟练 / 良好 / 了解"], ["items", "技能清单", "用顿号或逗号隔开", "full"]],
		languages: [["name", "语言 / 考试", "如：英语 CET-6"], ["level", "成绩 / 水平", "如：512 分"]],
		certs: [["name", "证书名称", "证书全称"], ["issuer", "颁发机构", "可留空"], ["date", "取得时间", "2025-03"]],
		awards: [["name", "奖项名称", "奖项全称"], ["level", "级别", "国家级 / 省级 / 校级"], ["date", "获奖时间", "2025-09"]],
	};
	var LIST_SECTIONS = [
		["education", "教育经历"], ["work", "实习 / 工作经历"], ["projects", "项目经历"],
		["skills", "技能分组"], ["languages", "语言能力"], ["certs", "证书"], ["awards", "获奖经历"],
	];

	function fieldHtml(secKey, idx, def, value) {
		var fname = def[0], label = def[1], ph = def[2] || "", kind = def[3] || "";
		var path = idx === null ? secKey + "." + fname : secKey + "." + idx + "." + fname;
		var cls = kind === "full" || kind === "textarea" ? "rs-field full" : "rs-field";
		var input = kind === "textarea"
			? '<textarea data-path="' + path + '" placeholder="' + RS.esc(ph) + '" rows="4">' + RS.esc(value) + "</textarea>"
			: '<input type="text" data-path="' + path + '" value="' + RS.esc(value) + '" placeholder="' + RS.esc(ph) + '" />';
		return '<div class="' + cls + '"><label>' + label + "</label>" + input + "</div>";
	}
	function secHeadHtml(key, defTitle, canToggle) {
		var meta = state.data.sectionMeta[key] || {};
		var title = meta.title || defTitle;
		var btn = canToggle
			? '<button type="button" class="rs-sec-toggle' + (meta.hidden ? " is-off" : "") + '" data-toggle="' + key + '">' + (meta.hidden ? "已隐藏 · 点开显示" : "显示中") + "</button>"
			: "";
		return '<div class="rs-sec-head"><input class="rs-sec-title-input" data-meta="' + key + '" value="' + RS.esc(title) + '" ' + (canToggle ? "" : "readonly") + " />" + btn + "</div>";
	}
	function buildForm() {
		var form = $("#rs-form");
		form.innerHTML = "";
		// 基本信息
		var basicsCard = el('<div class="rs-sec-card"></div>');
		basicsCard.innerHTML = secHeadHtml("basics", "基本信息", false) +
			'<div class="rs-fields">' + FIELD_DEFS.basics.map(function (d) { return fieldHtml("basics", null, d, state.data.basics[d[0]] || ""); }).join("") + "</div>" +
			'<div class="rs-photo-row" style="margin-top:.6rem"><img class="rs-photo-preview" id="rs-photo-preview" alt="" style="' + (state.data.basics.photo ? "" : "visibility:hidden") + '" src="' + (state.data.basics.photo || "") + '" /><div><button type="button" class="rs-btn rs-btn-small" id="rs-photo-btn">📷 上传证件照</button> <button type="button" class="rs-btn rs-btn-small" id="rs-photo-del" style="' + (state.data.basics.photo ? "" : "display:none") + '">移除</button><input type="file" id="rs-photo-file" accept="image/*" hidden /><p style="font-size:.72rem;opacity:.6;margin-top:.3rem">照片只存在你本地，不上传</p></div></div>';
		form.appendChild(basicsCard);
		// 列表区块
		LIST_SECTIONS.forEach(function (pair) {
			var key = pair[0], defTitle = pair[1];
			var card = el('<div class="rs-sec-card"></div>');
			var list = state.data[key] || [];
			var entries = list.map(function (item, idx) {
				return '<div class="rs-entry-card"><div class="rs-entry-tools">' +
					'<button type="button" class="rs-tool" data-move="' + key + ":" + idx + ':-1" title="上移">↑</button>' +
					'<button type="button" class="rs-tool" data-move="' + key + ":" + idx + ':1" title="下移">↓</button>' +
					'<button type="button" class="rs-tool danger" data-del="' + key + ":" + idx + '" title="删除">✕</button></div>' +
					'<div class="rs-fields">' + FIELD_DEFS[key].map(function (d) { return fieldHtml(key, idx, d, item[d[0]] || ""); }).join("") + "</div></div>";
			}).join("");
			card.innerHTML = secHeadHtml(key, defTitle, true) + entries +
				'<button type="button" class="rs-add-btn" data-add="' + key + '">＋ 添加一条' + defTitle + "</button>";
			form.appendChild(card);
		});
		// 自我评价
		var sumCard = el('<div class="rs-sec-card"></div>');
		sumCard.innerHTML = secHeadHtml("summary", "自我评价", true) +
			'<div class="rs-fields"><div class="rs-field full"><label>内容</label><textarea data-path="summary" rows="4" placeholder="2–4 句：基础与方向、代表性成果、协作与文档能力……">' + RS.esc(state.data.summary || "") + "</textarea></div></div>";
		form.appendChild(sumCard);
		bindPhoto();
	}
	function setPath(path, value) {
		var parts = path.split(".");
		if (parts.length === 2) {
			if (parts[0] === "summary") state.data.summary = value;
			else state.data[parts[0]][parts[1]] = value;
		} else {
			state.data[parts[0]][Number(parts[1])][parts[2]] = value;
		}
	}
	function blankItem(key) {
		var o = {}; FIELD_DEFS[key].forEach(function (d) { o[d[0]] = ""; }); return o;
	}
	function bindPhoto() {
		var btn = $("#rs-photo-btn"), file = $("#rs-photo-file"), del = $("#rs-photo-del");
		if (!btn) return;
		btn.addEventListener("click", function () { file.click(); });
		del.addEventListener("click", function () {
			state.data.basics.photo = ""; buildForm(); renderPreview(); saveSoon();
		});
		file.addEventListener("change", function () {
			var f = file.files && file.files[0]; if (!f) return;
			var img = new Image();
			img.onload = function () {
				var max = 360, scale = Math.min(1, max / Math.max(img.width, img.height));
				var c = document.createElement("canvas");
				c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
				c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
				state.data.basics.photo = c.toDataURL("image/jpeg", 0.85);
				URL.revokeObjectURL(img.src);
				buildForm(); renderPreview(); saveSoon();
			};
			img.src = URL.createObjectURL(f);
		});
	}

	/* ---------- 模板弹窗 ---------- */
	var modalState = { cat: "all", q: "", selectedId: null };
	function catCounts() {
		var counts = { all: catalog.length };
		catalog.forEach(function (p) { counts[p.cat] = (counts[p.cat] || 0) + 1; });
		return counts;
	}
	function openModal() {
		var overlay = el('<div class="rs-modal-overlay"></div>');
		var counts = catCounts();
		var chips = RS.CATEGORIES.map(function (c) {
			return '<button type="button" class="rs-chip' + (modalState.cat === c.id ? " is-active" : "") + '" data-cat="' + c.id + '">' + c.name + "<small>" + (counts[c.id] || 0) + "</small></button>";
		}).join("");
		overlay.innerHTML =
			'<div class="rs-modal" role="dialog" aria-modal="true" aria-label="模板库">' +
			'<div class="rs-modal-head"><span class="rs-modal-title">🎨 模板库</span>' +
			'<input class="rs-modal-search" id="rs-modal-q" type="search" placeholder="搜模板名、标签…" value="' + RS.esc(modalState.q) + '" />' +
			'<button type="button" class="rs-modal-close" id="rs-modal-close" aria-label="关闭">✕</button></div>' +
			'<div class="rs-modal-chips">' + chips + "</div>" +
			'<div class="rs-modal-body"><div class="rs-modal-grid" id="rs-modal-grid"></div>' +
			'<div class="rs-modal-side" id="rs-modal-side"></div></div></div>';
		document.body.appendChild(overlay);
		document.body.style.overflow = "hidden";
		overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
		$("#rs-modal-close").addEventListener("click", closeModal);
		overlay.querySelectorAll("[data-cat]").forEach(function (chip) {
			chip.addEventListener("click", function () {
				modalState.cat = chip.getAttribute("data-cat");
				overlay.querySelectorAll("[data-cat]").forEach(function (c) { c.classList.toggle("is-active", c === chip); });
				renderGrid();
			});
		});
		$("#rs-modal-q").addEventListener("input", function (e) { modalState.q = e.target.value.trim(); renderGrid(); });
		modalState.selectedId = state.settings.templateId;
		renderGrid();
		selectInModal(modalState.selectedId);
	}
	function closeModal() {
		var o = $(".rs-modal-overlay"); if (o) o.remove();
		document.body.style.overflow = "";
	}
	function filteredCatalog() {
		return catalog.filter(function (p) {
			if (modalState.cat !== "all" && p.cat !== modalState.cat) return false;
			if (modalState.q) {
				var hay = (p.name + " " + (p.tags || []).join(" ") + " " + (p.desc || "")).toLowerCase();
				if (!hay.includes(modalState.q.toLowerCase())) return false;
			}
			return true;
		});
	}
	function renderGrid() {
		var grid = $("#rs-modal-grid"); if (!grid) return;
		var list = filteredCatalog();
		grid.innerHTML = list.length ? "" : '<div class="rs-empty">这个分类下暂时没有匹配的模板，换个关键词试试</div>';
		var i = 0;
		function chunk() {
			var frag = document.createDocumentFragment();
			for (var n = 0; n < 10 && i < list.length; n++, i++) {
				(function (meta) {
					var card = el('<div class="rs-tpl-card' + (meta.id === modalState.selectedId ? " is-selected" : "") + '" data-tpl="' + meta.id + '" role="button" tabindex="0"></div>');
					card.innerHTML = '<div class="rs-tpl-thumb"></div><div class="rs-tpl-meta"><div class="rs-tpl-name">' + RS.esc(meta.name) + '</div><div class="rs-tpl-tags">' + (meta.tags || []).map(function (t) { return '<span class="rs-tpl-tag">' + RS.esc(t) + "</span>"; }).join("") + "</div></div>";
					card.addEventListener("click", function () { selectInModal(meta.id); });
					card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectInModal(meta.id); } });
					frag.appendChild(card);
					loadPack(meta.id).then(function (pack) {
						var th = card.querySelector(".rs-tpl-thumb");
						if (th) th.innerHTML = '<div class="rs-thumb-scale">' + renderWith(pack) + "</div>";
					});
				})(list[i]);
			}
			grid.appendChild(frag);
			if (i < list.length) setTimeout(chunk, 30);
		}
		chunk();
	}
	function selectInModal(id) {
		modalState.selectedId = id;
		document.querySelectorAll(".rs-tpl-card").forEach(function (c) {
			c.classList.toggle("is-selected", c.getAttribute("data-tpl") === id);
		});
		var side = $("#rs-modal-side"); if (!side) return;
		side.innerHTML = '<div class="rs-modal-side-desc">加载中…</div>';
		loadPack(id).then(function (pack) {
			if (modalState.selectedId !== id) return;
			side.innerHTML =
				'<div class="rs-modal-preview"><div class="rs-thumb-scale">' + renderWith(pack) + "</div></div>" +
				'<div class="rs-modal-side-name">' + RS.esc(pack.name) + "</div>" +
				'<div class="rs-modal-side-desc">' + RS.esc(pack.desc || "") + "</div>" +
				'<div class="rs-modal-side-src">版式' + RS.esc(pack.source || "") + (pack.license ? " · 许可证 " + RS.esc(pack.license) : "") + "</div>" +
				'<button type="button" class="rs-modal-apply" id="rs-modal-apply">使用这个模板</button>';
			$("#rs-modal-apply").addEventListener("click", function () {
				state.settings.templateId = id;
				currentPack = pack;
				renderPreview(); saveSoon(); closeModal();
			});
		});
	}

	/* ---------- 导出 ---------- */
	function standaloneHtml(pack) {
		return "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\" /><title>" +
			RS.esc((state.data.basics.name || "简历") + "的简历") + "</title><style>" +
			RS.BASE_CSS + "\n" + (pack.css || "") +
			"\n@page{size:A4;margin:0}body{margin:0}.rsr-root{margin:0 auto}</style></head><body>" +
			renderWith(pack) + "</body></html>";
	}
	function fileBase() { return (state.data.basics.name || "我的") + "的简历"; }
	function exportPdf() {
		var w = window.open("", "_blank");
		if (!w) { alert("浏览器拦住了弹窗，请允许本站弹窗后再试"); return; }
		w.document.write(standaloneHtml(currentPack));
		w.document.close();
		w.focus();
		setTimeout(function () { w.print(); }, 350);
	}
	function exportMd() {
		var d = state.data, b = d.basics, out = [];
		out.push("# " + (b.name || "姓名") + (b.title ? " · " + b.title : ""));
		var contacts = [b.phone, b.email, b.wechat, b.city, b.website, b.github].filter(Boolean).join(" | ");
		if (contacts) out.push(contacts);
		if (b.headline) out.push(">" + b.headline);
		function sec(title, body) { if (body) out.push("\n## " + title + "\n" + body); }
		sec("教育经历", (d.education || []).map(function (e) { return "- **" + e.school + "** " + [e.major, e.degree].filter(Boolean).join(" · ") + "（" + (e.start || "") + " – " + (e.end || "") + "）" + (e.gpa ? " GPA " + e.gpa : "") + (e.courses ? "\n  主修课程：" + e.courses : "") + (e.honors ? "\n  荣誉：" + e.honors : ""); }).join("\n"));
		sec("实习 / 工作经历", (d.work || []).map(function (e) { return "- **" + e.company + "** " + e.role + "（" + (e.start || "") + " – " + (e.end || "至今") + "）\n" + String(e.points || "").split(/\n+/).filter(Boolean).map(function (l) { return "  - " + l.trim(); }).join("\n"); }).join("\n"));
		sec("项目经历", (d.projects || []).map(function (e) { return "- **" + e.name + "** " + [e.role, e.stack].filter(Boolean).join(" · ") + "\n" + String(e.points || "").split(/\n+/).filter(Boolean).map(function (l) { return "  - " + l.trim(); }).join("\n"); }).join("\n"));
		sec("技能", (d.skills || []).map(function (g) { return "- **" + g.group + "**：" + g.items + (g.level ? "（" + g.level + "）" : ""); }).join("\n"));
		sec("语言能力", (d.languages || []).map(function (e) { return "- " + e.name + (e.level ? "：" + e.level : ""); }).join("\n"));
		sec("证书", (d.certs || []).map(function (e) { return "- " + e.name + (e.issuer ? "（" + e.issuer + "）" : "") + (e.date ? " " + e.date : ""); }).join("\n"));
		sec("获奖经历", (d.awards || []).map(function (e) { return "- " + e.name + (e.level ? "（" + e.level + "）" : "") + (e.date ? " " + e.date : ""); }).join("\n"));
		sec("自我评价", d.summary || "");
		download(fileBase() + ".md", new Blob([out.join("\n")], { type: "text/markdown;charset=utf-8" }));
	}
	function exportPng() {
		var page = $("#rs-page");
		var root = page.querySelector(".rsr-root");
		if (!root) return;
		var w = 794, h = root.offsetHeight;
		var html = new XMLSerializer().serializeToString(root.cloneNode(true));
		var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w * 2 + '" height="' + h * 2 + '">' +
			'<foreignObject width="' + w + '" height="' + h + '" transform="scale(2)">' +
			'<div xmlns="http://www.w3.org/1999/xhtml"><style>' + RS.BASE_CSS + "\n" + (currentPack.css || "") + "</style>" + html + "</div></foreignObject></svg>";
		var img = new Image();
		img.onload = function () {
			var c = document.createElement("canvas");
			c.width = w * 2; c.height = h * 2;
			c.getContext("2d").drawImage(img, 0, 0);
			c.toBlob(function (blob) { if (blob) download(fileBase() + ".png", blob); }, "image/png");
		};
		img.onerror = function () { alert("PNG 导出失败（浏览器限制），可以改用 PDF 导出后自行转图"); };
		img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
	}

	/* ---------- 事件绑定 ---------- */
	function bind() {
		var form = $("#rs-form");
		form.addEventListener("input", function (e) {
			var t = e.target;
			if (t.hasAttribute("data-path")) { setPath(t.getAttribute("data-path"), t.value); renderPreview(); saveSoon(); }
			if (t.hasAttribute("data-meta")) {
				var key = t.getAttribute("data-meta");
				state.data.sectionMeta[key] = state.data.sectionMeta[key] || {};
				state.data.sectionMeta[key].title = t.value;
				renderPreview(); saveSoon();
			}
		});
		form.addEventListener("click", function (e) {
			var t = e.target.closest("[data-add],[data-del],[data-move],[data-toggle]");
			if (!t) return;
			if (t.hasAttribute("data-add")) {
				var key = t.getAttribute("data-add");
				state.data[key].push(blankItem(key)); buildForm(); renderPreview(); saveSoon();
			}
			if (t.hasAttribute("data-del")) {
				var parts = t.getAttribute("data-del").split(":");
				if (confirm("删除这一条？")) { state.data[parts[0]].splice(Number(parts[1]), 1); buildForm(); renderPreview(); saveSoon(); }
			}
			if (t.hasAttribute("data-move")) {
				var m = t.getAttribute("data-move").split(":");
				var arr = state.data[m[0]], idx = Number(m[1]), to = idx + Number(m[2]);
				if (to < 0 || to >= arr.length) return;
				var tmp = arr[idx]; arr[idx] = arr[to]; arr[to] = tmp;
				buildForm(); renderPreview(); saveSoon();
			}
			if (t.hasAttribute("data-toggle")) {
				var k2 = t.getAttribute("data-toggle");
				state.data.sectionMeta[k2] = state.data.sectionMeta[k2] || {};
				state.data.sectionMeta[k2].hidden = !state.data.sectionMeta[k2].hidden;
				buildForm(); renderPreview(); saveSoon();
			}
		});
		$("#rs-open-modal").addEventListener("click", function () {
			if (catalog) openModal();
			else loadCatalog().then(openModal);
		});
		$("#rs-sample").addEventListener("click", function () {
			var src = currentPackLang() === "en" ? SAMPLE_EN : SAMPLE;
			state.data = JSON.parse(JSON.stringify(src));
			buildForm(); renderPreview(); saveSoon();
		});
		$("#rs-clear").addEventListener("click", function () {
			if (confirm("清空全部内容？（导出的 JSON 备份可以恢复）")) {
				state.data = blankData(); buildForm(); renderPreview(); saveSoon();
			}
		});
		var importFile = $("#rs-import-file");
		$("#rs-import").addEventListener("click", function () { importFile.click(); });
		importFile.addEventListener("change", function () {
			var f = importFile.files && importFile.files[0]; if (!f) return;
			f.text().then(function (txt) {
				try {
					var j = JSON.parse(txt);
					if (j.data) { state.data = j.data; if (j.settings) state.settings = Object.assign(state.settings, j.settings); }
					else if (j.basics) state.data = j;
					state.data.sectionMeta = state.data.sectionMeta || {};
					return loadPack(state.settings.templateId).then(function (p) {
						currentPack = p; buildForm(); syncStylebar(); renderPreview(); saveSoon();
						alert("导入成功");
					});
				} catch (err) { alert("这个文件不是有效的简历 JSON"); }
			});
			importFile.value = "";
		});
		// 风格条
		var colors = $("#rs-colors");
		ACCENTS.forEach(function (acc) {
			var dot = el('<button type="button" class="rs-color-dot" title="' + (acc ? "主题色 " + acc : "模板自带配色") + '"></button>');
			dot.style.background = acc || "conic-gradient(#0e7c6b,#2b7de9,#e0653a,#0e7c6b)";
			if ((state.settings.accent || "") === acc) dot.classList.add("is-active");
			dot.addEventListener("click", function () {
				state.settings.accent = acc;
				colors.querySelectorAll(".rs-color-dot").forEach(function (d) { d.classList.remove("is-active"); });
				dot.classList.add("is-active");
				renderPreview(); saveSoon();
			});
			colors.appendChild(dot);
		});
		$("#rs-fontsize").addEventListener("change", function (e) { state.settings.fontSize = e.target.value; renderPreview(); saveSoon(); });
		$("#rs-leading").addEventListener("change", function (e) { state.settings.leading = e.target.value; renderPreview(); saveSoon(); });
		// 缩放
		document.querySelectorAll("[data-zoom]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var z = btn.getAttribute("data-zoom");
				if (z === "fit") zoomMode = "fit";
				else if (z === "100") { zoomMode = "val"; zoomVal = 1; }
				else if (z === "in") { zoomMode = "val"; zoomVal = Math.min(1.8, (zoomMode === "val" ? zoomVal : 1) + 0.15); }
				else if (z === "out") { zoomMode = "val"; zoomVal = Math.max(0.35, (zoomMode === "val" ? zoomVal : 1) - 0.15); }
				applyZoom();
			});
		});
		// 导出
		$("#rs-exp-pdf").addEventListener("click", exportPdf);
		document.querySelectorAll("[data-exp]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				var kind = btn.getAttribute("data-exp");
				if (kind === "html") download(fileBase() + ".html", new Blob([standaloneHtml(currentPack)], { type: "text/html;charset=utf-8" }));
				else if (kind === "json") download(fileBase() + ".json", new Blob([JSON.stringify({ data: state.data, settings: state.settings }, null, 2)], { type: "application/json;charset=utf-8" }));
				else if (kind === "md") exportMd();
				else if (kind === "png") exportPng();
			});
		});
		// 手机标签
		document.querySelectorAll("[data-mtab]").forEach(function (tab) {
			tab.addEventListener("click", function () {
				document.querySelectorAll("[data-mtab]").forEach(function (x) { x.classList.toggle("is-active", x === tab); });
				$(".rs-main").classList.toggle("show-preview", tab.getAttribute("data-mtab") === "preview");
				if (tab.getAttribute("data-mtab") === "preview") setTimeout(applyZoom, 30);
			});
		});
		window.addEventListener("resize", function () { if (zoomMode === "fit") applyZoom(); });
	}
	function syncStylebar() {
		$("#rs-fontsize").value = state.settings.fontSize || "m";
		$("#rs-leading").value = state.settings.leading || "normal";
	}

	/* ---------- 启动 ---------- */
	function init() {
		var baseStyle = document.createElement("style");
		baseStyle.id = "rs-base-css";
		baseStyle.textContent = RS.BASE_CSS;
		document.head.appendChild(baseStyle);
		buildForm();
		syncStylebar();
		bind();
		loadCatalog();
		loadPack(state.settings.templateId).then(function (p) {
			currentPack = p;
			renderPreview();
		});
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
	else init();
})();
