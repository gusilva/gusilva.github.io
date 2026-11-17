/*
 * Europass-style résumé generator.
 *
 * Builds a pdfmake document definition from the same data the portfolio
 * renders (data/profile.md, data/experience/*.md, data/projects/*.md and the
 * skills list) and downloads it as a PDF. pdfmake is loaded lazily from the
 * CDN on first use so the page itself stays light.
 *
 * Browser: window.ResumePdf.download(data)
 * Node:    require('./resume-pdf.js').buildDocDefinition(data)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ResumePdf = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PDFMAKE_CDN = "https://cdn.jsdelivr.net/npm/pdfmake@0.3.14/build/";

  // A4 = 595.28 x 841.89 pt
  const PAGE_MARGINS = [44, 40, 44, 54];
  const CONTENT_WIDTH = 595.28 - PAGE_MARGINS[0] - PAGE_MARGINS[2];

  const COLOR = {
    blue: "#0E4194",
    text: "#1F2328",
    muted: "#5B6470",
    rule: "#C9D3E6",
    soft: "#EEF2FA",
  };

  const CEFR_LEVEL = /^(A1|A2|B1|B2|C1|C2)$/i;

  // ── Small helpers ──────────────────────────────────────────────────────
  // Roboto (bundled with pdfmake) has no arrow glyphs: "Java 7→8" → "Java 7 to 8".
  const clean = (s) =>
    String(s == null ? "" : s)
      .replace(/\s*[→⟶]\s*/g, " to ")
      .replace(/\s+/g, " ")
      .trim();
  const real = (u) => !!u && u !== "#";
  const displayUrl = (u) =>
    u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const compact = (arr) => arr.filter(Boolean);

  // "a | b; c | d" → [["a", "b"], ["c", "d"]]
  function splitRecords(value) {
    return clean(value)
      .split(";")
      .map((rec) => rec.split("|").map(clean))
      .filter((rec) => rec[0]);
  }

  function parseLanguages(value) {
    return splitRecords(value).map(([name, level = ""]) => {
      const codes = level.toUpperCase().split(/\s+/).filter(Boolean);
      const isCefr = codes.length > 0 && codes.every((c) => CEFR_LEVEL.test(c));
      let levels = null;
      if (isCefr && codes.length === 1) levels = Array(5).fill(codes[0]);
      else if (isCefr && codes.length === 5) levels = codes;
      return { name, level, levels };
    });
  }

  function rule(color, width) {
    return {
      canvas: [
        {
          type: "line",
          x1: 0,
          y1: 0,
          x2: CONTENT_WIDTH,
          y2: 0,
          lineWidth: width,
          lineColor: color,
        },
      ],
    };
  }

  // A section heading is glued to its first entry so it never ends up
  // orphaned at the bottom of a page.
  function section(title, entries) {
    const items = compact(entries);
    if (!items.length) return [];
    const heading = {
      stack: [
        { text: title.toUpperCase(), style: "section" },
        rule(COLOR.blue, 0.8),
      ],
      margin: [0, 0, 0, 9],
    };
    return [
      { stack: [heading, items[0]], unbreakable: true, margin: [0, 16, 0, 0] },
      ...items.slice(1),
    ];
  }

  function techLine(label, tags) {
    if (!tags || !tags.length) return null;
    return {
      text: [
        { text: label + ": ", bold: true, color: COLOR.text },
        tags.map(clean).join("  ·  "),
      ],
      style: "meta",
    };
  }

  // ── Header ─────────────────────────────────────────────────────────────
  function header(profile) {
    const contacts = compact([
      profile.location && { label: "Address", value: profile.location },
      profile.email && {
        label: "Email",
        value: profile.email,
        link: "mailto:" + profile.email,
      },
      real(profile.website) && {
        label: "Website",
        value: displayUrl(profile.website),
        link: profile.website,
      },
      real(profile.linkedin) && {
        label: "LinkedIn",
        value: displayUrl(profile.linkedin),
        link: profile.linkedin,
      },
      real(profile.github) && {
        label: "GitHub",
        value: displayUrl(profile.github),
        link: profile.github,
      },
    ]);

    // Contact grid: two rows, filled column by column.
    const contactLine = (c) => ({
      text: [
        { text: c.label + ": ", bold: true },
        c.link
          ? { text: c.value, link: c.link, color: COLOR.blue }
          : { text: c.value },
      ],
      noWrap: true,
    });
    const contactColumns = [];
    for (let i = 0; i < contacts.length; i += 2) {
      contactColumns.push({
        width: "auto",
        stack: contacts.slice(i, i + 2).map(contactLine),
      });
    }

    return [
      {
        columns: [
          {
            width: "*",
            stack: compact([
              { text: clean(profile.name) || "Curriculum Vitae", style: "name" },
              profile.title && { text: clean(profile.title), style: "headline" },
            ]),
          },
          {
            width: "auto",
            text: "CURRICULUM VITAE",
            style: "cvTag",
          },
        ],
      },
      contactColumns.length
        ? { columns: contactColumns, columnGap: 28, style: "contact" }
        : null,
      { ...rule(COLOR.blue, 2), margin: [0, 10, 0, 0] },
    ];
  }

  // ── Entries ────────────────────────────────────────────────────────────
  function experienceEntry(item) {
    return {
      stack: compact([
        item.period && { text: clean(item.period).toUpperCase(), style: "date" },
        {
          text: compact([
            { text: clean(item.role).toUpperCase(), style: "role" },
            item.company && { text: "  –  ", color: COLOR.muted },
            item.company && { text: clean(item.company), style: "org" },
          ]),
        },
        item.body && { text: clean(item.body), style: "body" },
        techLine("Key technologies", item.tags),
      ]),
      unbreakable: true,
      margin: [0, 0, 0, 12],
    };
  }

  function projectEntry(p) {
    const link = real(p.link) ? p.link : null;
    const repo = real(p.repo) ? p.repo : null;
    const links = compact([
      link && { text: displayUrl(link), link, color: COLOR.blue },
      link && repo && { text: "   |   ", color: COLOR.rule },
      repo && { text: "Source: " + displayUrl(repo), link: repo, color: COLOR.blue },
    ]);
    return {
      stack: compact([
        {
          text: clean(p.title),
          style: "role",
          link: link || undefined,
        },
        links.length && { text: links, style: "link" },
        p.body && { text: clean(p.body), style: "body" },
        techLine("Technologies", p.tags),
      ]),
      unbreakable: true,
      margin: [0, 0, 0, 12],
    };
  }

  function educationEntry([degree, institution, period]) {
    return {
      stack: compact([
        period && { text: period.toUpperCase(), style: "date" },
        {
          text: compact([
            { text: degree.toUpperCase(), style: "role" },
            institution && { text: "  –  ", color: COLOR.muted },
            institution && { text: institution, style: "org" },
          ]),
        },
      ]),
      unbreakable: true,
      margin: [0, 0, 0, 10],
    };
  }

  function languageEntries(profile) {
    const mother = clean(profile.motherTongue);
    const others = parseLanguages(profile.languages);
    const entries = [];

    if (mother) {
      entries.push({
        text: [{ text: "Mother tongue(s): ", bold: true }, mother],
        margin: [0, 0, 0, 8],
      });
    }
    if (!others.length) return entries.length ? [{ stack: entries }] : [];

    entries.push({
      text: "Other language(s):",
      bold: true,
      margin: [0, 0, 0, 5],
    });

    if (others.every((l) => l.levels)) {
      const head = (text, extra) => ({
        text,
        style: "tableHead",
        fillColor: COLOR.soft,
        ...extra,
      });
      entries.push({
        table: {
          headerRows: 2,
          widths: ["*", 66, 66, 66, 66, 66],
          body: [
            [
              head("", { rowSpan: 2 }),
              head("UNDERSTANDING", { colSpan: 2 }),
              {},
              head("SPEAKING", { colSpan: 2 }),
              {},
              head("WRITING", { rowSpan: 2 }),
            ],
            [
              {},
              head("Listening"),
              head("Reading"),
              head("Spoken production"),
              head("Spoken interaction"),
              {},
            ],
            ...others.map((l) => [
              { text: l.name, bold: true, margin: [4, 3, 0, 3] },
              ...l.levels.map((lv) => ({
                text: lv,
                alignment: "center",
                margin: [0, 3, 0, 3],
              })),
            ]),
          ],
        },
        layout: {
          hLineWidth: () => 0.6,
          vLineWidth: () => 0.6,
          hLineColor: () => COLOR.rule,
          vLineColor: () => COLOR.rule,
        },
        fontSize: 9,
      });
      entries.push({
        text:
          "Levels: A1 and A2: Basic user; B1 and B2: Independent user; " +
          "C1 and C2: Proficient user (Common European Framework of Reference for Languages)",
        style: "note",
      });
    } else {
      others.forEach((l) =>
        entries.push({
          columns: [
            { width: 110, text: l.name, bold: true },
            { width: "*", text: l.level || "—" },
          ],
          margin: [0, 0, 0, 3],
        }),
      );
    }
    // Keep the whole language block together.
    return [{ stack: entries, unbreakable: true }];
  }

  function skillEntries(skills) {
    return (skills || [])
      .filter((g) => g && g.items && g.items.length)
      .map((g) => ({
        columns: [
          { width: 92, text: clean(g.category).toUpperCase(), style: "skillCat" },
          {
            width: "*",
            text: g.items.map((i) => clean(i.label)).join("  |  "),
          },
        ],
        columnGap: 10,
        margin: [0, 0, 0, 7],
        unbreakable: true,
      }));
  }

  // ── Document ───────────────────────────────────────────────────────────
  function buildDocDefinition(data) {
    const profile = data.profile || {};
    const name = clean(profile.name) || "Curriculum Vitae";
    const summary = (data.summary || []).map(clean).filter(Boolean);
    const education = splitRecords(profile.education);

    const content = [
      ...header(profile),
      ...section(
        "About me",
        summary.map((p, i) => ({
          text: p,
          style: "body",
          margin: [0, i ? 5 : 0, 0, 0],
        })),
      ),
      ...section("Work experience", (data.experience || []).map(experienceEntry)),
      ...section("Education and training", education.map(educationEntry)),
      ...section("Language skills", languageEntries(profile)),
      ...section("Digital skills", skillEntries(data.skills)),
      ...section("Projects", (data.projects || []).map(projectEntry)),
    ];

    return {
      pageSize: "A4",
      pageMargins: PAGE_MARGINS,
      info: {
        title: name + " — Curriculum Vitae",
        author: name,
        subject: "Curriculum Vitae (Europass)",
        keywords: "CV, Europass, " + clean(profile.title),
      },
      footer: (currentPage, pageCount) => ({
        columns: [
          { text: name + " — Curriculum Vitae" },
          { text: "Page " + currentPage + " / " + pageCount, alignment: "right" },
        ],
        margin: [PAGE_MARGINS[0], 20, PAGE_MARGINS[2], 0],
        fontSize: 7.5,
        color: COLOR.muted,
      }),
      content,
      defaultStyle: {
        font: "Roboto",
        fontSize: 9.5,
        color: COLOR.text,
        lineHeight: 1.25,
      },
      styles: {
        name: { fontSize: 24, bold: true, color: COLOR.text, lineHeight: 1 },
        headline: { fontSize: 12, color: COLOR.blue, margin: [0, 4, 0, 0] },
        cvTag: {
          fontSize: 7.5,
          color: COLOR.muted,
          characterSpacing: 1.5,
          margin: [0, 6, 0, 0],
        },
        contact: { fontSize: 8.5, lineHeight: 1.5, margin: [0, 10, 0, 0] },
        section: {
          fontSize: 11,
          bold: true,
          color: COLOR.blue,
          characterSpacing: 1,
          margin: [0, 0, 0, 3],
        },
        date: {
          fontSize: 7.5,
          color: COLOR.muted,
          characterSpacing: 0.6,
          margin: [0, 0, 0, 2],
        },
        role: { fontSize: 10, bold: true, color: COLOR.text },
        org: { fontSize: 10, color: COLOR.blue },
        link: { fontSize: 8, margin: [0, 1, 0, 0] },
        body: { fontSize: 9.5, lineHeight: 1.35, margin: [0, 3, 0, 0] },
        meta: { fontSize: 8, color: COLOR.muted, margin: [0, 4, 0, 0] },
        skillCat: { fontSize: 8.5, bold: true, color: COLOR.blue },
        tableHead: {
          fontSize: 7.5,
          bold: true,
          color: COLOR.blue,
          alignment: "center",
          margin: [0, 3, 0, 3],
        },
        note: { fontSize: 7, color: COLOR.muted, italics: true, margin: [0, 4, 0, 0] },
      },
    };
  }

  function fileName(profile) {
    const base = clean(profile && profile.name).replace(/\s+/g, "_") || "Resume";
    return base + "_CV_Europass.pdf";
  }

  // ── Lazy pdfmake loader (browser only) ─────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  let pdfMakePromise = null;
  function loadPdfMake() {
    if (!pdfMakePromise) {
      pdfMakePromise = loadScript(PDFMAKE_CDN + "pdfmake.min.js")
        .then(() => loadScript(PDFMAKE_CDN + "vfs_fonts.js"))
        .then(() => window.pdfMake)
        .catch((err) => {
          pdfMakePromise = null; // allow a retry
          throw err;
        });
    }
    return pdfMakePromise;
  }

  async function download(data) {
    const pdfMake = await loadPdfMake();
    await pdfMake
      .createPdf(buildDocDefinition(data))
      .download(fileName(data.profile));
  }

  return { buildDocDefinition, download, fileName, parseLanguages };
});
