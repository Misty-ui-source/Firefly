/* 简历生成器 · 模板引擎（纯前端渲染）
 * 数据（data）与模板包（pack）分离：pack 是 JSON，含版式/配色/字体/疏密等参数 + 少量专属 CSS。
 * 渲染产物是 .rsr-root 的 A4 页面 HTML，样式由 RS.BASE_CSS + pack.css 共同决定。
 */
(function () {
	"use strict";

	function esc(s) {
		return String(s == null ? "" : s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}
	function lines(text) {
		return String(text || "")
			.split(/\n+/)
			.map((t) => t.trim())
			.filter(Boolean);
	}
	var CUR_EN = false;
	var EN_TITLE = {
		"联系方式": "Contact", "关于我": "About", "个人总结": "Summary", "自我评价": "Summary",
		"工作经历": "Experience", "实习 / 工作经历": "Experience", "项目经历": "Projects",
		"教育经历": "Education", "技能": "Skills", "语言能力": "Languages",
		"证书": "Certificates", "获奖经历": "Awards", "科研 / 论文": "Research & Publications",
	};
	function period(a, b) {
		a = (a || "").trim();
		b = (b || "").trim();
		if (!a && !b) return "";
		return a + " – " + (b || (CUR_EN ? "Present" : "至今"));
	}

	var FONT_STACKS = {
		sans: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans SC',sans-serif",
		serif: "'Songti SC','STSong','SimSun','Noto Serif SC',Georgia,serif",
		round: "'Yuanti SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",
		kai: "'Kaiti SC','STKaiti','KaiTi','Noto Serif SC',serif",
	};

	/* ---------- 通用区块渲染 ---------- */
	function entryHead(title, sub, date) {
		var h = '<div class="rsr-entry-head"><span class="rsr-entry-title">' + esc(title) + "</span>";
		if (date) h += '<span class="rsr-entry-date">' + esc(date) + "</span>";
		h += "</div>";
		if (sub) h += '<div class="rsr-entry-sub">' + esc(sub) + "</div>";
		return h;
	}
	function pointsHtml(text) {
		var ls = lines(text);
		if (!ls.length) return "";
		return (
			'<ul class="rsr-points">' +
			ls.map((l) => "<li>" + esc(l) + "</li>").join("") +
			"</ul>"
		);
	}
	function section(key, title, inner) {
		if (!inner) return "";
		return (
			'<section class="rsr-sec rsr-sec-' + key + '">' +
			'<h3 class="rsr-sec-title"><span class="rsr-sec-title-text">' + esc(title) + "</span></h3>" +
			inner +
			"</section>"
		);
	}

	function eduHtml(list) {
		return (list || [])
			.map(function (e) {
				var sub = [e.major, e.degree].filter(Boolean).join(" · ");
				var extra = [];
				if (e.gpa) extra.push("GPA " + e.gpa);
				if (e.rank) extra.push((CUR_EN ? "Rank: " : "排名 ") + e.rank);
				var body = "";
				if (extra.length) body += '<div class="rsr-entry-line">' + esc(extra.join("　")) + "</div>";
				if (e.courses) body += '<div class="rsr-entry-line">' + (CUR_EN ? "Key Courses: " : "主修课程：") + esc(e.courses) + "</div>";
				if (e.honors) body += '<div class="rsr-entry-line">' + (CUR_EN ? "Honors: " : "荣誉：") + esc(e.honors) + "</div>";
				return '<div class="rsr-entry">' + entryHead(e.school, sub, period(e.start, e.end)) + body + "</div>";
			})
			.join("");
	}
	function workHtml(list) {
		return (list || [])
			.map(function (e) {
				return (
					'<div class="rsr-entry">' +
					entryHead(e.company, e.role, period(e.start, e.end)) +
					pointsHtml(e.points) +
					"</div>"
				);
			})
			.join("");
	}
	function projHtml(list) {
		return (list || [])
			.map(function (e) {
				var sub = [e.role, e.stack].filter(Boolean).join(" · ");
				var body = pointsHtml(e.points);
				if (e.link) body += '<div class="rsr-entry-line rsr-link">' + esc(e.link) + "</div>";
				return '<div class="rsr-entry">' + entryHead(e.name, sub, "") + body + "</div>";
			})
			.join("");
	}
	function skillBarWidth(level) {
		var m = { "精通": 95, "熟练": 85, "掌握": 80, "良好": 70, "熟悉": 65, "了解": 50, "入门": 40 };
		if (!level) return 0;
		var pct = parseInt(level, 10);
		if (!isNaN(pct) && /%|％/.test(level)) return Math.max(5, Math.min(100, pct));
		return m[level.trim()] || 60;
	}
	function skillsHtml(list, pack) {
		return (list || [])
			.map(function (g) {
				var lvl = "";
				if (g.level) {
					lvl = '<span class="rsr-skill-level">' + esc(g.level) + "</span>";
					if (pack && pack.skillBars) {
						lvl += '<span class="rsr-skill-bar"><i style="width:' + skillBarWidth(g.level) + '%"></i></span>';
					}
				}
				return (
					'<div class="rsr-skill"><span class="rsr-skill-group">' +
					esc(g.group) +
					'</span><span class="rsr-skill-items">' +
					esc(g.items) +
					"</span>" +
					lvl +
					"</div>"
				);
			})
			.join("");
	}
	function simpleListHtml(list, fmt) {
		return (list || []).map(fmt).join("");
	}
	function langHtml(list) {
		return simpleListHtml(list, function (e) {
			return (
				'<div class="rsr-line-item"><span>' + esc(e.name) + "</span>" +
				(e.level ? '<span class="rsr-line-right">' + esc(e.level) + "</span>" : "") + "</div>"
			);
		});
	}
	function certHtml(list) {
		return simpleListHtml(list, function (e) {
			return (
				'<div class="rsr-line-item"><span>' + esc(e.name) +
				(e.issuer ? ' <span class="rsr-dim">' + (CUR_EN ? '(' : '（') + esc(e.issuer) + (CUR_EN ? ')' : '）') + "</span>" : "") + "</span>" +
				(e.date ? '<span class="rsr-line-right">' + esc(e.date) + "</span>" : "") + "</div>"
			);
		});
	}
	function awardHtml(list) {
		return simpleListHtml(list, function (e) {
			return (
				'<div class="rsr-line-item"><span>' + esc(e.name) +
				(e.level ? ' <span class="rsr-dim">' + (CUR_EN ? '(' : '（') + esc(e.level) + (CUR_EN ? ')' : '）') + "</span>" : "") + "</span>" +
				(e.date ? '<span class="rsr-line-right">' + esc(e.date) + "</span>" : "") + "</div>"
			);
		});
	}

	function contactItems(b) {
		var items = [];
		if (CUR_EN) {
			if (b.phone) items.push({ k: "Phone", v: b.phone });
			if (b.email) items.push({ k: "Email", v: b.email });
			if (b.wechat) items.push({ k: "WeChat", v: b.wechat });
			if (b.city) items.push({ k: "City", v: b.city });
			if (b.website) items.push({ k: "Website", v: b.website });
			if (b.github) items.push({ k: "GitHub", v: b.github });
			return items;
		}
		if (b.phone) items.push({ k: "电话", v: b.phone });
		if (b.email) items.push({ k: "邮箱", v: b.email });
		if (b.wechat) items.push({ k: "微信", v: b.wechat });
		if (b.city) items.push({ k: "城市", v: b.city });
		if (b.birth) items.push({ k: "出生", v: b.birth });
		if (b.politics) items.push({ k: "面貌", v: b.politics });
		if (b.website) items.push({ k: "网站", v: b.website });
		if (b.github) items.push({ k: "GitHub", v: b.github });
		return items;
	}

	/* ---------- 头部 ---------- */
	function headHtml(b, pack) {
		var contacts = contactItems(b)
			.map(function (c) {
				return '<span class="rsr-contact"><em>' + esc(c.k) + "</em>" + esc(c.v) + "</span>";
			})
			.join('<span class="rsr-contact-sep">|</span>');
		var photo = "";
		if (b.photo && pack.photo !== "none") {
			photo = '<img class="rsr-photo rsr-photo-' + (pack.photo || "round") + '" src="' + b.photo + '" alt="证件照" />';
		}
		return (
			'<header class="rsr-head">' +
			'<div class="rsr-head-main">' +
			'<h1 class="rsr-name">' + esc(b.name || (CUR_EN ? "Your Name" : "你的姓名")) + "</h1>" +
			(b.title ? '<div class="rsr-jobtitle">' + esc(b.title) + "</div>" : "") +
			(b.headline ? '<div class="rsr-headline">' + esc(b.headline) + "</div>" : "") +
			(contacts ? '<div class="rsr-contacts">' + contacts + "</div>" : "") +
			"</div>" +
			photo +
			"</header>"
		);
	}

	/* ---------- 真转换主题的构建器（结构按上游模板移植，字段映射到本站数据模型） ---------- */
	function buildFlat(data, ctx) {
		var b = data.basics || {};
		function row(id, name, inner) {
			if (!inner) return "";
			return '<section id="' + id + '" class="row"><aside class="col-sm-3"><h3>' + esc(name) + '</h3></aside><div class="col-sm-9"><div class="row">' + inner + "</div></div></section>";
		}
		function hl(text, withHead) {
			var ls = lines(text);
			if (!ls.length) return "";
			return (withHead ? "<h4>工作亮点</h4>" : "") + '<ul class="highlights">' + ls.map((l) => '<li class="bullet">' + esc(l) + "</li>").join("") + "</ul>";
		}
		var out = '<header id="header"><div class="container"><div class="row"><div class="col-sm-9 col-sm-push-3"><h1>' + esc(b.name || "你的姓名") + "</h1>" + (b.title ? "<h2>" + esc(b.title) + "</h2>" : "") + "</div></div></div></header>";
		out += '<div id="content" class="container">';
		var cells = "";
		function cell(label, val) { if (val) cells += '<div class="col-sm-6"><strong>' + label + '</strong><div>' + esc(val) + "</div></div>"; }
		cell("邮箱", b.email); cell("电话", b.phone); cell("微信", b.wechat); cell("城市", b.city); cell("网站", b.website); cell("GitHub", b.github);
		out += row("contact", ctx.title("contact", "联系方式"), cells);
		if (!ctx.hidden("summary") && data.summary)
			out += row("about", ctx.title("summary", "关于我"), '<div class="col-sm-12"><p>' + esc(data.summary) + "</p></div>");
		out += row("work", ctx.title("work", "工作经历"), (data.work || []).map(function (e) {
			return '<div class="col-sm-12"><h4 class="strike-through"><span>' + esc(e.company) + '</span><span class="date">' + esc(period(e.start, e.end)) + "</span></h4>" +
				(e.role ? '<div class="position">' + esc(e.role) + "</div>" : "") + hl(e.points, true) + "</div>";
		}).join(""));
		out += row("projects", ctx.title("projects", "项目经历"), (data.projects || []).map(function (e) {
			return '<div class="col-sm-12"><h4 class="strike-through"><span>' + esc(e.name) + "</span></h4>" +
				(e.role || e.stack ? '<div class="position">' + esc([e.role, e.stack].filter(Boolean).join(" · ")) + "</div>" : "") + hl(e.points, false) + "</div>";
		}).join(""));
		out += row("education", ctx.title("education", "教育经历"), (data.education || []).map(function (e) {
			return '<div class="col-sm-12"><h4 class="strike-through"><span>' + esc(e.school) + '</span><span class="date">' + esc(period(e.start, e.end)) + "</span></h4>" +
				(e.major ? '<div class="area">' + esc(e.major) + "</div>" : "") +
				(e.degree ? '<div class="studyType">' + esc(e.degree) + (e.gpa ? " · GPA " + esc(e.gpa) : "") + (e.rank ? " · 排名 " + esc(e.rank) : "") + "</div>" : "") +
				(e.courses ? '<h4>主修课程</h4><ul class="courses"><li>' + esc(e.courses) + "</li></ul>" : "") +
				(e.honors ? '<div class="summary"><p>' + esc(e.honors) + "</p></div>" : "") + "</div>";
		}).join(""));
		out += row("skills", ctx.title("skills", "技能"), (data.skills || []).map(function (g) {
			return '<div class="col-sm-6"><h4>' + esc(g.group) + (g.level ? " <em>" + esc(g.level) + "</em>" : "") + '</h4><div class="keywords">' + esc(g.items) + "</div></div>";
		}).join(""));
		out += row("languages", ctx.title("languages", "语言能力"), (data.languages || []).map(function (e) {
			return '<div class="col-sm-6"><strong>' + esc(e.name) + "</strong><div>" + esc(e.level || "") + "</div></div>";
		}).join(""));
		out += row("certs", ctx.title("certs", "证书"), (data.certs || []).map(function (e) {
			return '<div class="col-sm-12"><h4 class="strike-through"><span>' + esc(e.name) + "</span></h4>" +
				(e.date ? '<div class="date pull-right"><em>取得于</em> ' + esc(e.date) + "</div>" : "") +
				(e.issuer ? '<div class="awarder"><em>颁发</em> <strong>' + esc(e.issuer) + "</strong></div>" : "") + "</div>";
		}).join(""));
		out += row("awards", ctx.title("awards", "获奖经历"), (data.awards || []).map(function (e) {
			return '<div class="col-sm-12"><h4 class="strike-through"><span>' + esc(e.name) + "</span></h4>" +
				(e.date ? '<div class="date pull-right"><em>获奖于</em> ' + esc(e.date) + "</div>" : "") +
				(e.level ? '<div class="awarder"><em>级别</em> <strong>' + esc(e.level) + "</strong></div>" : "") + "</div>";
		}).join(""));
		out += "</div>";
		return out;
	}

	function buildOnepage(data, ctx) {
		var b = data.basics || {};
		function block(id, name, inner) {
			if (!inner) return "";
			return '<div id="' + id + '" class="sectionBlock"><div class="sectionName"><span>' + esc(name) + '</span></div><div class="sectionContent">' + inner + '</div></div><div class="sectionLine"></div>';
		}
		function hl(text) {
			var ls = lines(text);
			return ls.length ? '<ul class="highlights">' + ls.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>" : "";
		}
		var out = '<div id="resume">';
		out += '<div id="nameBlock" class="largeFont"><span class="name">' + esc(b.name || "你的姓名") + "</span>" + (b.title ? ' <span class="label">' + esc(b.title) + "</span>" : "") + "</div>";
		var contacts = [];
		if (b.email) contacts.push('<span class="email">' + esc(b.email) + "</span>");
		if (b.phone) contacts.push('<span class="phone">' + esc(b.phone) + "</span>");
		if (b.city) contacts.push('<span class="address">' + esc(b.city) + "</span>");
		out += '<div id="basicsBlock" class="smallFont"><div class="contactBlock">' + contacts.join('<span class="divider">|</span>') + "</div>" +
			(b.website || b.github ? '<div id="profilesBlock">' + [b.website, b.github].filter(Boolean).map((u) => '<span class="url">' + esc(u) + "</span>").join('<span class="divider">|</span>') + "</div>" : "") + "</div>";
		out += '<div class="sectionLine"></div>';
		if (!ctx.hidden("summary") && data.summary)
			out += block("summaryBlock", ctx.title("summary", "个人总结"), "<span>" + esc(data.summary) + "</span>");
		out += block("workBlock", ctx.title("work", "工作经历"), (data.work || []).map(function (e, i, arr) {
			return '<div class="jobBlock"><div class="blockHeader"><span class="title">' + esc(e.company) + (e.role ? ", " + esc(e.role) : "") + '</span><span class="date">' + esc(period(e.start, e.end)) + "</span></div>" + hl(e.points) + (i < arr.length - 1 ? '<div class="separator"></div>' : "") + "</div>";
		}).join(""));
		out += block("projectsBlock", ctx.title("projects", "项目经历"), (data.projects || []).map(function (e, i, arr) {
			return '<div class="jobBlock"><div class="blockHeader"><span class="title">' + esc(e.name) + (e.role ? ", " + esc(e.role) : "") + "</span></div>" + (e.stack ? "<div>" + esc(e.stack) + "</div>" : "") + hl(e.points) + (i < arr.length - 1 ? '<div class="separator"></div>' : "") + "</div>";
		}).join(""));
		out += block("education", ctx.title("education", "教育经历"), (data.education || []).map(function (e, i, arr) {
			return '<div class="educationBlock"><span class="title">' + esc(e.school) + '</span><span class="date">' + esc(period(e.start, e.end)) + "</span><div>" +
				esc([e.degree, e.major].filter(Boolean).join(" - ")) + (e.gpa ? ", GPA: " + esc(e.gpa) : "") + (e.rank ? "（" + esc(e.rank) + "）" : "") + "</div>" +
				(e.courses ? '<ul class="coursesList"><li class="course">' + esc(e.courses) + "</li></ul>" : "") +
				(e.honors ? "<div>" + esc(e.honors) + "</div>" : "") + (i < arr.length - 1 ? '<div class="separator"></div>' : "") + "</div>";
		}).join(""));
		out += block("skills", ctx.title("skills", "技能"), (data.skills || []).map(function (g) {
			return '<div class="skillBlock"><span class="title">' + esc(g.group) + "</span> " + (g.level ? "<em>" + esc(g.level) + "</em> " : "") + esc(g.items) + "</div>";
		}).join(""));
		out += block("languages", ctx.title("languages", "语言能力"), (data.languages || []).map(function (e) {
			return '<div class="skillBlock"><span class="title">' + esc(e.name) + "</span> " + esc(e.level || "") + "</div>";
		}).join(""));
		out += block("certs", ctx.title("certs", "证书"), (data.certs || []).map(function (e) {
			return '<div class="skillBlock"><span class="title">' + esc(e.name) + "</span> " + esc(e.issuer || "") + (e.date ? ' <span class="date">' + esc(e.date) + "</span>" : "") + "</div>";
		}).join(""));
		out += block("awards", ctx.title("awards", "获奖经历"), (data.awards || []).map(function (e, i, arr) {
			return '<div><div class="blockHeader"><span class="title">' + esc(e.name) + (e.level ? ", " + esc(e.level) : "") + '</span>' + (e.date ? '<span class="date">' + esc(e.date) + "</span>" : "") + "</div>" + (i < arr.length - 1 ? '<div class="separator"></div>' : "") + "</div>";
		}).join(""));
		out += "</div>";
		return out;
	}

	function buildKendall(data, ctx) {
		var b = data.basics || {};
		function box(icon, name, inner) {
			if (!inner) return "";
			return '<div class="box"><h2><i class="fas ' + icon + ' ico"></i> ' + esc(name) + "</h2>" + inner + "</div>";
		}
		function jobList(list, isProj) {
			return (list || []).map(function (e) {
				var head = isProj ? e.name : e.company;
				var role = isProj ? [e.role, e.stack].filter(Boolean).join(" · ") : e.role;
				return '<div class="job clearfix"><div class="row"><div class="details"><div class="where">' + esc(head) + '</div><div class="year">' + esc(period(e.start, e.end)) + '</div></div></div>' +
					'<div class="row"><div class="job-details col-xs-11"><div class="profession">' + esc(role || "") + '</div><div class="description">' +
					(lines(e.points).length ? '<ul class="list-group">' + lines(e.points).map((l) => '<li class="list-group-item">' + esc(l) + "</li>").join("") + "</ul>" : "") +
					"</div></div></div></div>";
			}).join("");
		}
		var left = "";
		if (!ctx.hidden("summary") && data.summary) left += box("fa-user", ctx.title("summary", "关于我"), "<p>" + esc(data.summary) + "</p>");
		left += box("fa-suitcase", ctx.title("work", "工作经历"), jobList(data.work, false));
		left += box("fa-folder-open", ctx.title("projects", "项目经历"), jobList(data.projects, true));
		left += box("fa-trophy", ctx.title("awards", "获奖经历"), (data.awards || []).map(function (e) {
			return '<div class="job clearfix"><div class="details"><div class="where">' + esc(e.name) + '</div><div class="year">' + esc(e.date || "") + "</div></div>" + (e.level ? '<div class="profession">' + esc(e.level) + "</div>" : "") + "</div>";
		}).join(""));
		var right = "";
		var contact = "";
		function citem(icon, val, desc) {
			if (!val) return;
			contact += '<div class="contact-item"><div class="icon pull-left text-center"><span class="fas ' + icon + ' fa-fw"></span></div><div class="title only pull-right">' + esc(val) + "</div>" + (desc ? '<div class="description pull-right">' + esc(desc) + "</div>" : "") + "</div>";
		}
		citem("fa-map-marker", b.city); citem("fa-phone", b.phone); citem("fa-envelope", b.email); citem("fa-comment", b.wechat); citem("fa-globe", b.website); citem("fa-github", b.github);
		right += box("fa-bullseye", ctx.title("contact", "联系方式"), contact);
		right += box("fa-university", ctx.title("education", "教育经历"), '<ul id="education" class="clearfix">' + (data.education || []).map(function (e) {
			return '<li><div class="year pull-left">' + esc(e.start || "") + "<br>" + esc(e.end || "") + '</div><div class="description pull-right"><h3>' + esc(e.school) + "</h3>" +
				(e.degree ? "<p>" + esc(e.degree) + "</p>" : "") + (e.major ? "<p>" + esc(e.major) + "</p>" : "") +
				(e.gpa ? "<p>成绩: " + esc(e.gpa) + (e.rank ? " · " + esc(e.rank) : "") + "</p>" : "") +
				(e.courses ? "<p>" + esc(e.courses) + "</p>" : "") + (e.honors ? "<p>" + esc(e.honors) + "</p>" : "") + "</div></li>";
		}).join("") + "</ul>");
		right += box("fa-cogs", ctx.title("skills", "技能"), (data.skills || []).map(function (g) {
			return '<div class="skills-item"><div class="skills-group">' + esc(g.group) + (g.level ? ' <em>' + esc(g.level) + "</em>" : "") + '</div><div class="skills-keywords">' + esc(g.items) + "</div></div>";
		}).join(""));
		right += box("fa-language", ctx.title("languages", "语言能力"), (data.languages || []).map(function (e) {
			return '<div class="skills-item"><div class="skills-group">' + esc(e.name) + '</div><div class="skills-keywords">' + esc(e.level || "") + "</div></div>";
		}).join(""));
		right += box("fa-certificate", ctx.title("certs", "证书"), (data.certs || []).map(function (e) {
			return '<div class="skills-item"><div class="skills-group">' + esc(e.name) + '</div><div class="skills-keywords">' + esc([e.issuer, e.date].filter(Boolean).join(" · ")) + "</div></div>";
		}).join(""));
		var photo = b.photo ? '<div id="photo"><img src="' + b.photo + '" alt="avatar"></div>' : "";
		return '<div class="container"><div class="row"><div class="col-xs-12"><div id="photo-header" class="text-center">' + photo +
			'<div id="text-header"><h1>' + esc(b.name || "你的姓名") + "<br>" + (b.title ? "<span>" + esc(b.title) + "</span>" : "") + "</h1></div></div></div></div>" +
			'<div class="row"><div class="col-xs-12 col-sm-7">' + left + '</div><div class="col-xs-12 col-sm-5">' + right + "</div></div></div>";
	}

	function buildSimple(data, ctx) {
		var b = data.basics || {};
		function sec(id, name, inner) {
			if (!inner) return "";
			return '<div id="' + id + '"><div class="heading">' + esc(name) + "</div>" + inner + "</div>";
		}
		function items(list, isProj) {
			return (list || []).map(function (e) {
				return '<div class="item"><div class="overview"><div class="details"><div class="label">' + esc(isProj ? e.name : e.company) + '</div>' +
					'<div class="date"><span class="startDate">' + esc(e.start || "") + '</span>' + (e.end ? ' <span class="endDate">- ' + esc(e.end) + "</span>" : "") + "</div></div>" +
					'<div class="summary">' + esc(isProj ? [e.role, e.stack].filter(Boolean).join(" · ") : e.role || "") + "</div></div>" +
					(lines(e.points).length ? "<ul>" + lines(e.points).map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>" : "") + "</div>";
			}).join("");
		}
		var out = '<div class="top"><div class="container">' +
			(b.photo ? '<div class="profile-pic" style="background-image: url(' + b.photo + ')"></div>' : "") +
			'<div class="name-title"><div class="name">' + esc(b.name || "你的姓名") + '</div><div class="job-title">' + esc(b.title || "") + "</div></div></div></div>" +
			'<div class="clearfix"></div><div class="container">';
		if (!ctx.hidden("summary") && data.summary) out += '<div class="bio">' + esc(data.summary) + "</div>";
		var contact = "";
		function crow(label, val) { if (val) contact += '<div><span class="label">' + label + '</span><span class="data">' + esc(val) + "</span></div>"; }
		crow("网站", b.website); crow("邮箱", b.email); crow("电话", b.phone); crow("微信", b.wechat); crow("城市", b.city); crow("GitHub", b.github);
		if (contact) out += '<div class="contact"><div class="heading">' + esc(ctx.title("contact", "联系方式")) + "</div>" + contact + "</div>";
		out += '<div class="clearfix"></div>';
		out += sec("work", ctx.title("work", "工作经历"), items(data.work, false));
		out += sec("projects", ctx.title("projects", "项目经历"), items(data.projects, true));
		out += sec("education", ctx.title("education", "教育经历"), (data.education || []).map(function (e) {
			return '<div class="item"><div class="overview"><div class="details"><div class="label">' + esc(e.school) + '</div><div class="date"><span class="startDate">' + esc(e.start || "") + '</span>' + (e.end ? ' <span class="endDate">- ' + esc(e.end) + "</span>" : "") + "</div></div>" +
				'<div class="summary">' + esc([e.degree, e.major].filter(Boolean).join(" · ")) + (e.gpa ? " · GPA " + esc(e.gpa) : "") + "</div></div>" +
				(e.courses ? "<ul><li>" + esc(e.courses) + "</li></ul>" : "") + (e.honors ? "<ul><li>" + esc(e.honors) + "</li></ul>" : "") + "</div>";
		}).join(""));
		out += sec("skills", ctx.title("skills", "技能"), (data.skills || []).map(function (g) {
			return '<div class="item"><div class="label">' + esc(g.group) + (g.level ? " · " + esc(g.level) : "") + '</div><div class="summary">' + esc(g.items) + "</div></div>";
		}).join(""));
		out += sec("languages", ctx.title("languages", "语言能力"), (data.languages || []).map(function (e) {
			return '<div class="item"><div class="label">' + esc(e.name) + '</div><div class="summary">' + esc(e.level || "") + "</div></div>";
		}).join(""));
		out += sec("certs", ctx.title("certs", "证书"), (data.certs || []).map(function (e) {
			return '<div class="item"><div class="label">' + esc(e.name) + '</div><div class="summary">' + esc([e.issuer, e.date].filter(Boolean).join(" · ")) + "</div></div>";
		}).join(""));
		out += sec("awards", ctx.title("awards", "获奖经历"), (data.awards || []).map(function (e) {
			return '<div class="item"><div class="label">' + esc(e.name) + '</div><div class="summary">' + esc([e.level, e.date].filter(Boolean).join(" · ")) + "</div></div>";
		}).join(""));
		out += "</div>";
		return out;
	}

	function buildConcise(data, ctx) {
		var b = data.basics || {};
		function head2(name, inner) {
			if (!inner) return "";
			return '<div class="cross-heading"><p>' + esc(name) + "</p></div>" + inner;
		}
		function hl(text) {
			var ls = lines(text);
			return ls.length ? '<ul class="highlights">' + ls.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>" : "";
		}
		function item(role, org, dates, points) {
			return '<div class="item section-container"><div class="summary-section">' +
				(role ? '<div class="position">' + esc(role) + "</div>" : "") +
				(org ? '<h3 class="name">' + esc(org) + "</h3>" : "") +
				(dates ? '<div class="dateRange">' + esc(dates) + "</div>" : "") +
				'</div><div class="full-section">' + hl(points) + "</div></div>";
		}
		var out = '<div id="header"><h1>' + esc(b.name || "Your Name") + "</h1>" + (b.title ? "<h3>" + esc(b.title) + "</h3>" : "") + "</div>";
		out += '<div id="resume"><section id="basics">';
		var contact = [b.email, b.phone, b.city, b.website, b.github].filter(Boolean).join(" · ");
		if (contact) out += '<div id="contact" class="section-container"><div class="summary-section"><div class="email">' + esc(contact) + "</div></div></div>";
		if (!ctx.hidden("summary") && data.summary) out += '<div class="summary"><p><em>' + esc(data.summary) + "</em></p></div>";
		out += "</section>";
		out += '<section id="work">' + head2(ctx.title("work", "Work"), (data.work || []).map(function (e) { return item(e.role, e.company, period(e.start, e.end), e.points); }).join("")) + "</section>";
		out += '<section id="projects">' + head2(ctx.title("projects", "Projects"), (data.projects || []).map(function (e) { return item(e.role, e.name, e.stack || "", e.points); }).join("")) + "</section>";
		out += '<section id="education">' + head2(ctx.title("education", "Education"), (data.education || []).map(function (e) {
			return item([e.degree, e.major].filter(Boolean).join(", "), e.school, period(e.start, e.end), [e.courses, e.honors, e.gpa ? "GPA: " + e.gpa : ""].filter(Boolean).join("\n"));
		}).join("")) + "</section>";
		out += '<section id="awards">' + head2(ctx.title("awards", "Awards"), (data.awards || []).map(function (e) { return item(e.level, e.name, e.date || "", ""); }).join("")) + "</section>";
		out += '<section id="skills">' + head2(ctx.title("skills", "Skills"), (data.skills || []).map(function (g) {
			return '<div class="item section-container"><div class="summary-section"><div class="skill-name">' + esc(g.group) + "</div>" + (g.level ? '<div class="level"><em>' + esc(g.level) + "</em></div>" : "") + '</div><div class="full-section"><div class="keywords">' + esc(g.items) + "</div></div></div>";
		}).join("")) + "</section>";
		out += '<section id="languages">' + head2(ctx.title("languages", "Languages"), (data.languages || []).map(function (e) {
			return '<div class="item section-container"><div class="summary-section"><div class="skill-name">' + esc(e.name) + "</div>" + (e.level ? '<div class="level"><em>' + esc(e.level) + "</em></div>" : "") + "</div></div>";
		}).join("")) + "</section>";
		out += '<section id="certs">' + head2(ctx.title("certs", "Certificates"), (data.certs || []).map(function (e) { return item(e.issuer, e.name, e.date || "", ""); }).join("")) + "</section>";
		out += "</div>";
		return out;
	}

	var THEME_BUILDERS = { flat: buildFlat, onepage: buildOnepage, kendall: buildKendall, simple: buildSimple, concise: buildConcise };

	/* ---------- 主渲染 ---------- */
	function render(data, pack, settings) {
		settings = settings || {};
		CUR_EN = !!pack && pack.lang === "en";
		var b = data.basics || {};
		var meta = data.sectionMeta || {};
		function title(key, def) {
			if (meta[key] && meta[key].title) return meta[key].title;
			if (CUR_EN && EN_TITLE[def]) return EN_TITLE[def];
			return def;
		}
		function hidden(key) {
			return meta[key] && meta[key].hidden;
		}

		var html = "";
		if (pack.builder && THEME_BUILDERS[pack.builder]) {
			html = THEME_BUILDERS[pack.builder](data, { title: title, hidden: hidden });
		} else {
		var secs = {};
		if (!hidden("summary") && (b.summary || data.summary))
			secs.summary = section("summary", title("summary", "自我评价"), '<p class="rsr-summary">' + esc(data.summary || b.summary) + "</p>");
		if (!hidden("education")) secs.education = section("education", title("education", "教育经历"), eduHtml(data.education));
		if (!hidden("work")) secs.work = section("work", title("work", "实习 / 工作经历"), workHtml(data.work));
		if (!hidden("projects")) secs.projects = section("projects", title("projects", "项目经历"), projHtml(data.projects));
		if (!hidden("skills")) secs.skills = section("skills", title("skills", "技能"), skillsHtml(data.skills, pack));
		if (!hidden("languages")) secs.languages = section("languages", title("languages", "语言能力"), langHtml(data.languages));
		if (!hidden("certs")) secs.certs = section("certs", title("certs", "证书"), certHtml(data.certs));
		if (!hidden("awards")) secs.awards = section("awards", title("awards", "获奖经历"), awardHtml(data.awards));

		var order = ["education", "work", "projects", "skills", "languages", "certs", "awards", "summary"];
		var mainSecs = order.map((k) => secs[k] || "").join("");
		var html = "";

		if (pack.layout === "sidebarL" || pack.layout === "sidebarR") {
			var sideKeys = ["skills", "languages", "certs"];
			var sideSecs = sideKeys.map((k) => secs[k] || "").join("");
			var restOrder = ["education", "work", "projects", "awards", "summary"];
			var restSecs = restOrder.map((k) => secs[k] || "").join("");
			var sideContacts = contactItems(b)
				.map(function (c) {
					return '<div class="rsr-side-contact"><em>' + esc(c.k) + "</em><span>" + esc(c.v) + "</span></div>";
				})
				.join("");
			var sidePhoto =
				b.photo && pack.photo !== "none"
					? '<img class="rsr-photo rsr-photo-' + (pack.photo || "round") + '" src="' + b.photo + '" alt="证件照" />'
					: "";
			var side =
				'<aside class="rsr-side">' +
				sidePhoto +
				'<div class="rsr-side-name">' + esc(b.name || (CUR_EN ? "Your Name" : "你的姓名")) + "</div>" +
				(b.title ? '<div class="rsr-side-title">' + esc(b.title) + "</div>" : "") +
				(sideContacts ? '<div class="rsr-side-contacts">' + sideContacts + "</div>" : "") +
				sideSecs +
				"</aside>";
			var main = '<div class="rsr-main">' + restSecs + "</div>";
			html = '<div class="rsr-cols">' + (pack.layout === "sidebarL" ? side + main : main + side) + "</div>";
		} else {
			html = headHtml(b, pack) + '<div class="rsr-main rsr-main-full">' + mainSecs + "</div>";
		}
		}

		var p = pack.palette || {};
		var acc = settings.accent || p.acc || "#0e7c6b";
		var styleVars =
			"--acc:" + acc +
			";--acc2:" + (p.acc2 || acc) +
			";--soft:" + (p.soft || "#eef4f2") +
			";--side:" + (p.side || p.soft || "#f2f5f4") +
			";--sideink:" + (p.sideInk || "#223") +
			";--fs:" + (settings.fontScale || 1) +
			";--lead:" + (settings.leading || 1.55);
		var density = pack.density || "normal";
		return (
			'<div class="rsr-root" data-layout="' + esc(pack.layout || "single") +
			'" data-secstyle="' + esc(pack.secstyle || "bar") +
			'" data-density="' + esc(density) +
			(pack.builder ? '" data-theme="' + esc(pack.builder) : "") +
			'" style="' + styleVars + ";font-family:" + (FONT_STACKS[pack.font] || FONT_STACKS.sans) + '">' +
			html +
			"</div>"
		);
	}

	/* ---------- 基础样式（所有模板共用骨架，变体靠变量与 pack.css 拉开差异） ---------- */
	var BASE_CSS = [
		".rsr-root{width:794px;min-height:1123px;background:#fff;color:#26292e;box-sizing:border-box;padding:42px 46px;font-size:calc(13.5px * var(--fs,1));line-height:var(--lead,1.55);-webkit-print-color-adjust:exact;print-color-adjust:exact}",
		".rsr-root *{box-sizing:border-box;margin:0;padding:0}",
		".rsr-root[data-density=compact]{padding:34px 40px}",
		".rsr-root[data-density=loose]{padding:50px 52px}",
		".rsr-name{font-size:calc(27px * var(--fs,1));font-weight:800;letter-spacing:.02em;color:#191c1f}",
		".rsr-jobtitle{margin-top:4px;font-size:calc(14.5px * var(--fs,1));color:var(--acc);font-weight:700}",
		".rsr-headline{margin-top:5px;color:#5a6068;font-size:calc(12.5px * var(--fs,1))}",
		".rsr-contacts{margin-top:9px;display:flex;flex-wrap:wrap;gap:5px 8px;color:#43484f;font-size:calc(12px * var(--fs,1))}",
		".rsr-contact em{font-style:normal;color:var(--acc);font-weight:700;margin-right:4px}",
		".rsr-contact-sep{color:#c3c8cd}",
		".rsr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding-bottom:14px;border-bottom:2.5px solid var(--acc)}",
		".rsr-photo{width:86px;height:112px;object-fit:cover;flex:none}",
		".rsr-photo-round{border-radius:10px}",
		".rsr-photo-square{border-radius:2px}",
		".rsr-sec{margin-top:17px}",
		".rsr-root[data-density=compact] .rsr-sec{margin-top:13px}",
		".rsr-root[data-density=loose] .rsr-sec{margin-top:22px}",
		".rsr-sec-title{font-size:calc(15px * var(--fs,1));font-weight:800;color:#191c1f;display:flex;align-items:center;gap:9px;margin-bottom:8px}",
		'.rsr-root[data-secstyle=bar] .rsr-sec-title::before{content:"";width:5px;height:17px;background:var(--acc);border-radius:2px;flex:none}',
		'.rsr-root[data-secstyle=line] .rsr-sec-title{border-bottom:1.5px solid var(--acc);padding-bottom:5px}',
		'.rsr-root[data-secstyle=block] .rsr-sec-title-text{background:var(--acc);color:#fff;padding:3px 12px;border-radius:5px}',
		'.rsr-root[data-secstyle=dot] .rsr-sec-title::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--acc);flex:none}',
		'.rsr-root[data-secstyle=num] .rsr-sec{counter-increment:rsrsec}',
		'.rsr-root[data-secstyle=num] .rsr-sec-title::before{content:counter(rsrsec,decimal-leading-zero);color:var(--acc);font-weight:800}',
		".rsr-root{counter-reset:rsrsec}",
		".rsr-entry{margin-bottom:10px}",
		".rsr-entry-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}",
		".rsr-entry-title{font-weight:700;font-size:calc(13.8px * var(--fs,1));color:#22252a}",
		".rsr-entry-date{color:var(--acc);font-weight:600;font-size:calc(12px * var(--fs,1));white-space:nowrap}",
		".rsr-entry-sub{color:#555b63;font-weight:600;margin-top:1px}",
		".rsr-entry-line{color:#454a51;margin-top:2px}",
		".rsr-points{list-style:none;margin-top:3px}",
		".rsr-points li{position:relative;padding-left:13px;color:#3c4148;margin-top:2px}",
		'.rsr-points li::before{content:"";position:absolute;left:1px;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--acc)}',
		".rsr-summary{color:#3c4148;white-space:pre-wrap}",
		".rsr-skill{display:flex;gap:10px;margin-top:4px;align-items:baseline}",
		".rsr-skill-group{font-weight:700;min-width:86px;color:#22252a}",
		".rsr-skill-items{color:#3c4148;flex:1}",
		".rsr-skill-level{color:var(--acc);font-weight:700;font-size:calc(12px * var(--fs,1))}",
		".rsr-line-item{display:flex;justify-content:space-between;gap:12px;margin-top:3px;color:#3c4148}",
		".rsr-line-right{color:#6a7078;white-space:nowrap}",
		".rsr-dim{color:#7d838c}",
		"/* 双栏 */",
		".rsr-cols{display:flex;gap:26px;align-items:stretch}",
		".rsr-side{width:236px;flex:none;background:var(--side);color:var(--sideink);border-radius:12px;padding:22px 18px}",
		".rsr-side .rsr-photo{width:104px;height:132px;margin:0 auto 12px;display:block}",
		".rsr-side-name{font-size:calc(20px * var(--fs,1));font-weight:800;text-align:center}",
		".rsr-side-title{text-align:center;color:var(--acc);font-weight:700;margin-top:3px}",
		".rsr-side-contacts{margin-top:14px;border-top:1px dashed rgba(120,130,140,.4);padding-top:10px}",
		".rsr-side-contact{display:flex;gap:8px;margin-top:5px;font-size:calc(12px * var(--fs,1));word-break:break-all}",
		".rsr-side-contact em{font-style:normal;font-weight:700;color:var(--acc);flex:none}",
		".rsr-side .rsr-sec-title{color:var(--sideink)}",
		".rsr-side .rsr-skill{flex-direction:column;gap:1px}",
		".rsr-side .rsr-skill-group{min-width:0}",
		".rsr-main{flex:1;min-width:0}",
		".rsr-main-full .rsr-sec:first-child{margin-top:15px}",
		"/* 时间轴版式 */",
		'.rsr-root[data-layout=timeline] .rsr-entry{position:relative;padding-left:20px;border-left:2px solid var(--soft);margin-left:5px}',
		'.rsr-root[data-layout=timeline] .rsr-entry::before{content:"";position:absolute;left:-6px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--acc);border:2px solid #fff;box-shadow:0 0 0 1.5px var(--acc)}',
		"/* 色带版式 */",
		".rsr-root[data-layout=band]{padding-top:0}",
		".rsr-root[data-layout=band] .rsr-head{background:linear-gradient(120deg,var(--acc),var(--acc2));margin:0 -46px;padding:30px 46px 22px;border-bottom:none}",
		".rsr-root[data-layout=band][data-density=compact] .rsr-head{margin:0 -40px;padding:24px 40px 18px}",
		".rsr-root[data-layout=band][data-density=loose] .rsr-head{margin:0 -52px;padding:36px 52px 26px}",
		".rsr-root[data-layout=band] .rsr-name,.rsr-root[data-layout=band] .rsr-jobtitle{color:#fff}",
		".rsr-root[data-layout=band] .rsr-headline{color:rgba(255,255,255,.85)}",
		".rsr-root[data-layout=band] .rsr-contacts{color:rgba(255,255,255,.92)}",
		".rsr-root[data-layout=band] .rsr-contact em{color:#ffe9a8}",
		".rsr-root[data-layout=band] .rsr-photo{border:2.5px solid rgba(255,255,255,.85)}",
		"/* 卡片版式 */",
		".rsr-root[data-layout=cards] .rsr-sec{background:var(--soft);border-radius:12px;padding:13px 16px 7px}",
		".rsr-root[data-layout=cards] .rsr-sec-title{margin-bottom:5px}",
		"/* 学术版式 */",
		".rsr-root[data-layout=academic] .rsr-head{flex-direction:column;align-items:center;text-align:center;border-bottom:1.5px solid #2b2b2b}",
		".rsr-root[data-layout=academic] .rsr-head-main{display:flex;flex-direction:column;align-items:center}",
		".rsr-root[data-layout=academic] .rsr-contacts{justify-content:center}",
		".rsr-root[data-layout=academic] .rsr-photo{position:absolute}",
		".rsr-root[data-layout=academic]{position:relative}",
		".rsr-root[data-layout=academic] .rsr-sec-title{justify-content:center;letter-spacing:.35em;text-indent:.35em}",
		"/* 技能条（WPS 常见款） */",
		".rsr-skill-bar{display:inline-block;width:92px;height:6px;background:#e2e6ea;border-radius:3px;overflow:hidden;vertical-align:middle;margin-left:8px;flex:none}",
		".rsr-skill-bar i{display:block;height:100%;background:var(--acc);border-radius:3px}",
		".rsr-side .rsr-skill-bar{width:100%;margin-left:0;margin-top:3px;background:rgba(127,137,148,.35)}",
		"/* 表格风（WPS 常见款） */",
		".rsr-root[data-layout=table] .rsr-head{border-bottom:3px double var(--acc)}",
		".rsr-root[data-layout=table] .rsr-sec{margin-top:15px}",
		".rsr-root[data-layout=table] .rsr-sec-title{background:var(--soft);border:1px solid #c9ced4;padding:5px 11px;margin-bottom:0}",
		".rsr-root[data-layout=table] .rsr-entry{border:1px solid #c9ced4;border-top:none;padding:8px 11px 4px;margin-bottom:0}",
		".rsr-root[data-layout=table] .rsr-line-item{border:1px solid #c9ced4;border-top:none;padding:5px 11px;margin-top:0}",
		".rsr-root[data-layout=table] .rsr-skill{border:1px solid #c9ced4;border-top:none;padding:5px 11px;margin-top:0}",
		".rsr-root[data-layout=table] .rsr-summary{border:1px solid #c9ced4;border-top:none;padding:8px 11px}",
		"/* 极简版式 */",
		".rsr-root[data-layout=minimal] .rsr-head{border-bottom:1px solid #d8dce0}",
		".rsr-root[data-layout=minimal] .rsr-sec-title{font-weight:700;letter-spacing:.12em;color:#33373d}",
		".rsr-root[data-layout=minimal] .rsr-contact em{color:#8a9098}",
		".rsr-root[data-layout=minimal] .rsr-entry-date{color:#8a9098}",
		".rsr-root[data-layout=minimal] .rsr-points li::before{background:#b9bfc6}",
		"/* 创意版式 */",
		".rsr-root[data-layout=creative] .rsr-name{font-size:calc(34px * var(--fs,1));letter-spacing:.01em}",
		".rsr-root[data-layout=creative] .rsr-head{border-bottom:none;position:relative;padding-bottom:6px}",
		'.rsr-root[data-layout=creative] .rsr-head::after{content:"";position:absolute;left:0;bottom:-6px;width:120px;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--acc),var(--acc2))}',
		".rsr-root[data-layout=creative] .rsr-photo{border-radius:50%;width:104px;height:104px}",
		".rsr-side .rsr-line-item,.rsr-side .rsr-skill-items,.rsr-side .rsr-summary{color:inherit;opacity:.92}",
		".rsr-side .rsr-skill-group{color:inherit}",
		".rsr-side .rsr-line-right,.rsr-side .rsr-dim{color:inherit;opacity:.65}",
		".rsr-side .rsr-points li{color:inherit;opacity:.92}",
		"@media print{.rsr-root{width:auto;min-height:0}}",
	].join("\n");

	/* ---------- 内置兜底模板（目录拉不到时用） ---------- */
	var FALLBACK = [
		{ id: "builtin-teal", name: "经典青绿", cat: "campus", layout: "single", secstyle: "bar", font: "sans", density: "normal", photo: "round", palette: { acc: "#0e7c6b", acc2: "#0a5c50", soft: "#e9f4f1" }, source: "站内自制", license: "MIT", tags: ["单栏"] },
		{ id: "builtin-navy", name: "藏青双栏", cat: "internet", layout: "sidebarL", secstyle: "bar", font: "sans", density: "normal", photo: "round", palette: { acc: "#1f4e79", acc2: "#2f6da3", soft: "#e8eff6", side: "#1f4e79", sideInk: "#eef4fa" }, source: "站内自制", license: "MIT", tags: ["双栏"] },
		{ id: "builtin-min", name: "极简灰", cat: "minimal", layout: "minimal", secstyle: "line", font: "sans", density: "normal", photo: "none", palette: { acc: "#3c4653", acc2: "#3c4653", soft: "#f1f2f4" }, source: "站内自制", license: "MIT", tags: ["单栏"] },
		{ id: "builtin-acad", name: "学术衬线", cat: "academic", layout: "academic", secstyle: "num", font: "serif", density: "normal", photo: "none", palette: { acc: "#5b2333", acc2: "#5b2333", soft: "#f6f1ee" }, source: "站内自制", license: "MIT", tags: ["单栏"] },
		{ id: "builtin-band", name: "色带橙", cat: "creative", layout: "band", secstyle: "dot", font: "round", density: "normal", photo: "round", palette: { acc: "#e0653a", acc2: "#b7791f", soft: "#fdf0e9" }, source: "站内自制", license: "MIT", tags: ["单栏"] },
	];

	var CATEGORIES = [
		{ id: "all", name: "全部" },
		{ id: "campus", name: "校招实习" },
		{ id: "internet", name: "互联网科技" },
		{ id: "minimal", name: "极简单栏" },
		{ id: "academic", name: "学术科研" },
		{ id: "creative", name: "创意设计" },
		{ id: "formal", name: "严肃正式" },
	];

	window.RS = {
		esc: esc,
		render: render,
		BASE_CSS: BASE_CSS,
		FALLBACK: FALLBACK,
		CATEGORIES: CATEGORIES,
		FONT_STACKS: FONT_STACKS,
	};
})();
