// UI audit checks (plan 05zb). Injected into a page by run.mjs; returns what is wrong with the page it is run on. Not served by the app.
(() => {
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  cv.canvas.width = cv.canvas.height = 1;
  const rgba = (css) => {
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = "#000";
    cv.fillStyle = css;
    cv.fillRect(0, 0, 1, 1);
    const d = cv.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
  };
  const lum = ([r, g, b]) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const desc = (el) => {
    const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);
    const cls = typeof el.className === "string" ? el.className.split(" ").slice(0, 3).join(".") : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${t ? ` "${t}"` : ""}`;
  };

  window.__auditDoc = (doc, win, scope) => {
    const root = scope || doc.body;
    const out = {};
    const add = (k, v) => ((out[k] ||= []).push(v), undefined);
    const W = win.innerWidth;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = win.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    };
    const inScroller = (e) => { for (let n = e.parentElement; n && n !== doc.body; n = n.parentElement) { const o = win.getComputedStyle(n).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
    const decorative = (e) => !!e.closest("[aria-hidden='true'], [aria-hidden=true]");
    const all = [...root.querySelectorAll("*")].filter((e) => !["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH", "TEMPLATE"].includes(e.tagName.toUpperCase()) && visible(e) && !decorative(e));

    if (!scope) {
      const de = doc.documentElement;
      if (de.scrollWidth > W + 1) {
        const offenders = all.filter((e) => e.getBoundingClientRect().right > W + 1 && !inScroller(e)).slice(0, 4).map(desc);
        add("h-overflow", `page ${de.scrollWidth}px wide in ${W}px: ${offenders.join(" | ")}`);
      }
      const h1s = [...doc.querySelectorAll("h1")].filter(visible);
      if (h1s.length !== 1) add("headings", `${h1s.length} h1 elements`);
      const levels = [...doc.querySelectorAll("h1,h2,h3,h4")].filter(visible).map((h) => +h.tagName[1]);
      for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) { add("headings", `level jumps h${levels[i - 1]}→h${levels[i]}`); break; }
      const nested = doc.querySelectorAll("main main").length;
      if (nested) add("structure", `${nested} nested <main>`);
      if (!doc.querySelector("main")) add("structure", "no <main>");
    }

    for (const el of all) {
      const cs = win.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const ownText = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");

      // addresses / hashes broken over lines
      if (/0x[0-9a-fA-F]{12,}/.test(ownText) || /^0x[0-9a-f]{8,}…?/i.test(ownText)) {
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
        // a value the page must show whole (the signed payout on a document, a share link) may wrap and says so
        if (r.height > lh * 1.6 && !el.closest("[data-wrap-ok]")) add("wrapped-hex", `${desc(el)} is ${Math.round(r.height / lh)} lines at ${Math.round(r.width)}px`);
      }
      // clipped text
      if ((cs.overflowX === "hidden" || cs.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1 && ownText && !(el.className && /\bsr-only\b/.test(String(el.className)))) add("clipped", `${desc(el)} (${el.scrollWidth}>${el.clientWidth})`);
      // text wider than its parent without wrapping
      if (ownText && r.right > W + 1 && cs.position !== "fixed" && !inScroller(el)) add("off-screen", `${desc(el)} right=${Math.round(r.right)} > ${W}`);

      // boxed element whose text touches its own edge
      if (ownText && el.tagName !== "BUTTON" && el.tagName !== "A" && el.tagName !== "INPUT" && el.tagName !== "SELECT") {
        const boxed = (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") || rgba(cs.backgroundColor)[3] > 0.05;
        const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat);
        if (boxed && r.width > 120 && pad.some((p) => p < 4) && !["TD", "TH", "TR", "LI", "SPAN", "CODE"].includes(el.tagName)) add("no-padding", `${desc(el)} padding ${pad.join("/")}`);
      }
      // dialog-like panel children touching the panel edge
      if (el.getAttribute && el.getAttribute("role") === "dialog") {
        const kids = [...el.children];
        const p = [cs.paddingTop, cs.paddingLeft].map(parseFloat);
        const first = kids[0]?.getBoundingClientRect();
        if (first && first.left - r.left < 12 && p[1] < 12) add("dialog-padding", `dialog content starts ${Math.round(first.left - r.left)}px from its edge`);
      }

      // tiny text
      if (ownText) {
        const fs = parseFloat(cs.fontSize);
        // text drawn along a path inside a scaled SVG (the seal stamp) is artwork, not copy
        if (fs < 11.5 && !el.closest("textPath")) add("small-text", `${fs}px ${desc(el)}`);
        add("__sizes", fs);
        add("__fonts", cs.fontFamily.split(",")[0].replace(/["']/g, ""));
        // contrast
        const fg = rgba(cs.color);
        let bg = [0, 0, 0, 0];
        for (let n = el; n && bg[3] < 0.99; n = n.parentElement) bg = over(bg, rgba(win.getComputedStyle(n).backgroundColor)).length === 4 ? over(bg, rgba(win.getComputedStyle(n).backgroundColor)) : bg;
        if (bg[3] < 0.99) bg = over(bg, [255, 255, 255, 1]);
        const f2 = over(fg, bg);
        const L1 = lum(f2), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5) && ownText.length > 1) add("contrast", `${ratio.toFixed(2)}:1 ${fs}px ${desc(el)}`);
      }

      // interactive
      if (["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.getAttribute("role") === "button") {
        const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("placeholder") || (el.labels && el.labels[0]?.textContent) || el.getAttribute("alt") || "").trim();
        if (!name && el.type !== "hidden" && el.type !== "checkbox" && el.type !== "radio") add("no-name", desc(el));
        if (el.tagName === "A" && (el.getAttribute("href") === "#" || !el.getAttribute("href"))) add("dead-link", desc(el));
        if (W <= 768 && (r.height < 36 || r.width < 36) && !(el.tagName === "A" && cs.display === "inline")) add("tap-target", `${Math.round(r.width)}x${Math.round(r.height)} ${desc(el)}`);
        if (el.tagName === "BUTTON" || (el.tagName === "A" && (parseFloat(cs.borderTopWidth) > 0 || rgba(cs.backgroundColor)[3] > 0.1))) {
          add("__buttons", `${Math.round(r.height)}h r${parseFloat(cs.borderTopLeftRadius) | 0} ${cs.fontSize} pad${cs.paddingTop}/${cs.paddingLeft}`);
        }
        if (el.tagName === "INPUT" && !el.disabled && el.type !== "hidden") {
          add("__inputs", `${Math.round(r.height)}h r${parseFloat(cs.borderTopLeftRadius) | 0} ${cs.fontSize} pad${cs.paddingTop}/${cs.paddingLeft}`);
          if (!(el.labels && el.labels.length) && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby") && !el.getAttribute("title")) add("input-no-label", desc(el) + ` [${el.name || el.id || el.type}] ph="${el.placeholder}"`);
        }
      }
      if (el.tagName === "IMG" && !el.getAttribute("alt") && el.getAttribute("alt") !== "") add("img-alt", desc(el));
    }

    if (!scope) {
      // content column geometry
      const main = doc.querySelector("main");
      const h1 = doc.querySelector("main h1, h1");
      if (main && h1) {
        const mr = main.getBoundingClientRect();
        const kids = [...main.querySelectorAll("*")].filter(visible);
        const right = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
        const left = h1.getBoundingClientRect().left;
        out.geometry = { viewport: W, mainLeft: Math.round(mr.left), mainRight: Math.round(mr.right), h1Left: Math.round(left), contentRight: Math.round(right), empty: Math.round(mr.right - right) };
      }
    }
    // summarise the style-signature lists
    for (const k of ["__sizes", "__fonts", "__buttons", "__inputs"]) {
      if (!out[k]) continue;
      const counts = {};
      for (const v of out[k]) counts[v] = (counts[v] || 0) + 1;
      out[k.slice(2)] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      delete out[k];
    }
    for (const k of Object.keys(out)) if (Array.isArray(out[k]) && typeof out[k][0] === "string") { const u = [...new Set(out[k])]; out[k] = u.length > 8 ? [...u.slice(0, 8), `…+${u.length - 8} more`] : u; }
    return out;
  };
})();
