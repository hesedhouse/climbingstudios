#!/usr/bin/env node
/**
 * 클라이밍 하이프렉스 블로그 자동 포스트 생성기
 * - Claude API로 매일 1편의 블로그 글을 자동 생성
 * - 5개 카테고리 순환: 일산소식, 클라이밍가이드, 운동건강, 시설장비, 커뮤니티
 * - GitHub Actions cron에서 실행
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.join(__dirname, "..", "blog");
const SITE_URL = "https://climbingstudios.com";

// ── 카테고리 정의 ──
const CATEGORIES = [
  {
    id: "ilsan-life",
    name: "일산 소식",
    description: "일산·고양시 지역 소식, 맛집, 문화, 가볼 곳",
    keywords: "일산 가볼곳, 일산 맛집, 고양시 소식, 일산서구, 일산 데이트, 일산 주말",
    prompt: `일산·고양시 지역 생활 정보를 다루는 블로그 글을 작성하세요.
주제 예시: 일산 주변 맛집, 주말 나들이 코스, 계절별 가볼 곳, 일산 신상 카페, 고양시 축제/이벤트, 킨텍스 행사.
글 마지막에 "클라이밍 하이프렉스도 일산서구 덕이동에 있으니, 일산 나들이에 실내 클라이밍 한 판도 추가해보세요!"와 같이 자연스럽게 연결하세요.`
  },
  {
    id: "climbing-guide",
    name: "클라이밍 가이드",
    description: "클라이밍 기술, 볼더링 팁, 리드 가이드, 초보자 안내",
    keywords: "클라이밍 초보, 볼더링 팁, 리드 클라이밍, 클라이밍 기술, 클라이밍 입문, 클라이밍 난이도",
    prompt: `클라이밍 기술과 지식을 다루는 교육적 블로그 글을 작성하세요.
주제 예시: 볼더링 초보 가이드, 난이도 등급 이해하기, 클라이밍 기본 무브, 리드 클라이밍 시작하기, 홀드 종류와 잡는 법, 루트 리딩 방법, 클라이밍 에티켓.
실용적이고 구체적인 팁을 제공하세요. 글 마지막에 "하이프렉스에서 직접 연습해보세요"와 같이 자연스럽게 연결하세요.`
  },
  {
    id: "fitness-health",
    name: "운동·건강",
    description: "클라이밍 운동효과, 체력관리, 부상예방, 스트레칭",
    keywords: "클라이밍 운동효과, 클라이밍 다이어트, 클라이밍 근육, 실내운동, 클라이밍 스트레칭, 부상예방",
    prompt: `클라이밍과 관련된 운동·건강 정보를 다루는 블로그 글을 작성하세요.
주제 예시: 클라이밍 칼로리 소모량, 클라이밍에 필요한 근육, 클라이밍 전후 스트레칭, 악력 키우기, 클라이밍 부상 예방법, 초보자 체력 관리, 클라이밍 vs 다른 운동 비교.
과학적 근거가 있는 실용적 정보를 제공하세요.`
  },
  {
    id: "gear-facility",
    name: "시설·장비",
    description: "클라이밍 장비, 암벽화, 초크, 시설 이야기",
    keywords: "암벽화 추천, 클라이밍 장비, 초크 종류, 클라이밍 복장, 클라이밍장 시설",
    prompt: `클라이밍 장비와 시설에 대한 블로그 글을 작성하세요.
주제 예시: 첫 암벽화 고르는 법, 초크 종류와 선택 가이드, 클라이밍 복장 추천, 홀드 소재와 특징, 매트 안전 기준, 실내 클라이밍장 선택 팁.
초보자도 이해할 수 있게 쉽게 설명하세요.`
  },
  {
    id: "community",
    name: "커뮤니티",
    description: "클라이밍 문화, 대회, 사람들, 라이프스타일",
    keywords: "클라이밍 대회, 클라이밍 문화, 클라이밍 커뮤니티, 클라이밍 취미, 클라이밍 모임",
    prompt: `클라이밍 문화와 커뮤니티에 대한 블로그 글을 작성하세요.
주제 예시: 클라이밍이 인기 있는 이유, 직장인 취미로서의 클라이밍, 클라이밍 대회 관전 가이드, 클라이밍 모임/크루 문화, 가족 클라이밍, 데이트로 클라이밍, 클라이밍과 명상.
개인적이고 공감 가능한 톤으로 작성하세요.`
  }
];

// ── 오늘의 카테고리 (순환) ──
function getTodayCategory() {
  const today = new Date();
  const epoch = new Date("2026-07-28"); // 시작일
  const daysSinceEpoch = Math.floor((today - epoch) / (1000 * 60 * 60 * 24));
  const index = Math.abs(daysSinceEpoch) % CATEGORIES.length;
  return CATEGORIES[index];
}

// ── 기존 글 제목 목록 (중복 방지) ──
function getExistingTitles() {
  if (!fs.existsSync(BLOG_DIR)) {
    fs.mkdirSync(BLOG_DIR, { recursive: true });
    return [];
  }
  return fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith(".html") && f !== "index.html")
    .map(f => {
      const content = fs.readFileSync(path.join(BLOG_DIR, f), "utf-8");
      const titleMatch = content.match(/<title>([^<]+)<\/title>/);
      return titleMatch?.[1]?.replace(/ — .+$/, "") || f;
    });
}

// ── 오늘 날짜 ──
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── 이미 오늘 글이 있는지 ──
function alreadyPostedToday() {
  const today = todayStr();
  if (!fs.existsSync(BLOG_DIR)) return false;
  return fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith(".html") && f !== "index.html")
    .some(f => f.startsWith(today));
}

// ── slug 생성 ──
function makeSlug(title) {
  return title
    .replace(/[^\w\sㄱ-힣]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .substring(0, 60);
}

// ── Claude API로 포스트 생성 ──
async function generatePost(category, existingTitles) {
  const client = new Anthropic();
  const today = todayStr();

  const existingList = existingTitles.slice(-20).map(t => `- ${t}`).join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: `당신은 일산 클라이밍 전문 블로거입니다. 클라이밍 하이프렉스(경기도 고양시 일산서구 덕이로 20, 1E동 B1, 031-922-8848)의 블로그에 글을 씁니다.

오늘의 카테고리: **${category.name}** — ${category.description}
${category.prompt}

## 규칙
1. 제목은 검색에 잘 걸리는 구체적인 한글 제목 (30자 이내)
2. 본문은 1200~1800자, 자연스러운 구어체
3. 소제목(h2/h3) 3~4개로 구조화
4. SEO 키워드를 자연스럽게 포함: ${category.keywords}
5. "클라이밍 하이프렉스", "일산 클라이밍", "일산서구 클라이밍"을 본문에 1~2회 자연스럽게 녹여주세요
6. 광고 느낌 없이, 진짜 정보를 주는 블로그 글처럼 작성
7. 글 끝에 하이프렉스를 자연스럽게 한 줄로 언급 (전화번호 포함)
8. 오늘 날짜: ${today}

## 이미 작성된 글 (중복 금지)
${existingList || "(아직 없음)"}

## 출력 형식
아래 형식 그대로 출력하세요. HTML 코드만 출력하고 다른 설명은 하지 마세요.

\`\`\`html
<article>
<h1>제목</h1>
<p class="meta"><time>${today}</time> · ${category.name}</p>

본문 내용 (h2, h3, p, ul/li 태그 사용)

</article>
\`\`\`

HTML 코드 블록만 출력하세요.`
    }]
  });

  const text = response.content[0].text;
  const articleMatch = text.match(/<article>[\s\S]+<\/article>/);
  if (!articleMatch) throw new Error("Failed to extract article HTML");

  const titleMatch = articleMatch[0].match(/<h1>([^<]+)<\/h1>/);
  const title = titleMatch?.[1] || `${category.name} — ${today}`;

  return { title, article: articleMatch[0], category };
}

// ── 전체 HTML 페이지 래핑 ──
function wrapInPage(title, article, category, date) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — 클라이밍 하이프렉스</title>
<meta name="description" content="${title}. 일산 클라이밍 하이프렉스 블로그.">
<link rel="canonical" href="${SITE_URL}/blog/${date}-${makeSlug(title)}.html">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:url" content="${SITE_URL}/blog/${date}-${makeSlug(title)}.html">
<meta property="og:site_name" content="클라이밍 하이프렉스">
<meta name="keywords" content="${category.keywords}">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "${title.replace(/"/g, '\\"')}",
  "datePublished": "${date}",
  "author": {"@type": "Organization", "name": "클라이밍 하이프렉스"},
  "publisher": {"@type": "Organization", "name": "클라이밍 하이프렉스", "url": "${SITE_URL}"},
  "mainEntityOfPage": "${SITE_URL}/blog/${date}-${makeSlug(title)}.html"
}
</script>
<style>
:root{--bg:#15161A;--surface:#1C1E24;--text:#F3F1EA;--muted:#8A8D95;--line:rgba(243,241,234,.13);--primary:#E8FF35;--accent:#FF3B2F;--on-primary:#0F1013}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Pretendard',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.75;-webkit-font-smoothing:antialiased}
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}
nav{border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(21,22,26,.88);backdrop-filter:blur(10px);z-index:10}
.navin{max-width:760px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between}
.brand{font-weight:900;font-size:18px;letter-spacing:-.5px;color:var(--text)}
.navlinks{display:flex;gap:18px;font-weight:700;font-size:13px}
.navlinks a{color:var(--muted)}
.navlinks a:hover{color:var(--primary);text-decoration:none}
.post-wrap{max-width:720px;margin:0 auto;padding:60px 24px 80px}
article h1{font-size:clamp(26px,4.5vw,38px);font-weight:900;letter-spacing:-1px;line-height:1.3;margin-bottom:8px}
article .meta{font-size:13px;color:var(--muted);margin-bottom:40px;padding-bottom:20px;border-bottom:1px solid var(--line)}
article h2{font-size:22px;font-weight:800;margin:36px 0 14px;color:var(--primary);letter-spacing:-.3px}
article h3{font-size:18px;font-weight:700;margin:28px 0 10px}
article p{margin-bottom:16px;font-size:16px;color:var(--text)}
article ul,article ol{margin:12px 0 20px 24px;font-size:15px;color:var(--muted)}
article li{margin-bottom:6px}
.back{display:inline-block;margin-top:40px;padding:12px 24px;border:2px solid var(--line);font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);text-decoration:none}
.back:hover{border-color:var(--primary);color:var(--primary);text-decoration:none}
footer{border-top:1px solid var(--line);padding:24px;text-align:center;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<nav><div class="navin"><a href="/" class="brand">HIGHFLEX.</a><div class="navlinks"><a href="/">홈</a><a href="/blog/">블로그</a><a href="tel:031-922-8848">전화</a></div></div></nav>
<div class="post-wrap">
${article}
<a href="/blog/" class="back">← 목록으로</a>
</div>
<footer>© 2026 클라이밍 하이프렉스 — climbingstudios.com</footer>
</body>
</html>`;
}

// ── 블로그 목록 페이지 재생성 ──
function regenerateIndex() {
  const files = fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith(".html") && f !== "index.html")
    .sort()
    .reverse();

  const cards = files.map(f => {
    const content = fs.readFileSync(path.join(BLOG_DIR, f), "utf-8");
    const titleMatch = content.match(/<h1>([^<]+)<\/h1>/);
    const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})/);
    const descMatch = content.match(/<meta name="description" content="([^"]+)"/);
    const catMatch = content.match(/<time>[^<]+<\/time>\s*·\s*([^<]+)/);
    return `      <a href="/blog/${f}" class="post-card">
        <div class="date">${dateMatch?.[1] || ""} · ${catMatch?.[1]?.trim() || ""}</div>
        <div class="title">${titleMatch?.[1] || f}</div>
        <div class="desc">${descMatch?.[1]?.replace(/ — .+$/, "").substring(0, 80) || ""}</div>
      </a>`;
  }).join("\n");

  const indexHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>블로그 — 클라이밍 하이프렉스</title>
<meta name="description" content="클라이밍 하이프렉스 블로그. 일산 소식, 클라이밍 가이드, 운동 정보.">
<link rel="canonical" href="${SITE_URL}/blog/">
<meta property="og:type" content="website">
<meta property="og:title" content="블로그 — 클라이밍 하이프렉스">
<link rel="preconnect" href="https://cdn.jsdelivr.net">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Blog","name":"클라이밍 하이프렉스 블로그","url":"${SITE_URL}/blog/","publisher":{"@type":"Organization","name":"클라이밍 하이프렉스"}}
</script>
<style>
:root{--bg:#15161A;--surface:#1C1E24;--text:#F3F1EA;--muted:#8A8D95;--line:rgba(243,241,234,.13);--primary:#E8FF35;--accent:#FF3B2F;--on-primary:#0F1013}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Pretendard',-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
nav{border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(21,22,26,.88);backdrop-filter:blur(10px);z-index:10}
.navin{max-width:880px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between}
.brand{font-weight:900;font-size:18px;letter-spacing:-.5px}
.navlinks{display:flex;gap:18px;font-weight:700;font-size:13px}
.navlinks a{color:var(--muted)}.navlinks a:hover{color:var(--primary)}
.wrap{max-width:880px;margin:0 auto;padding:0 24px}
.blog-hero{padding:60px 0 36px;border-bottom:1px solid var(--line);margin-bottom:32px}
.blog-hero .tag{font-size:13px;font-weight:800;letter-spacing:1.5px;color:var(--primary);text-transform:uppercase}
.blog-hero h1{font-size:clamp(28px,5vw,44px);font-weight:900;letter-spacing:-1.5px;margin-top:12px}
.blog-hero p{color:var(--muted);font-size:15px;margin-top:10px;max-width:500px}
.post-list{display:grid;gap:14px;padding-bottom:60px}
.post-card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:24px 26px;transition:.18s}
.post-card:hover{transform:translateY(-3px);border-color:var(--primary);box-shadow:0 12px 32px rgba(0,0,0,.08)}
.post-card .date{font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.3px}
.post-card .title{font-size:19px;font-weight:900;letter-spacing:-.5px;margin:7px 0 8px;line-height:1.35}
.post-card .desc{font-size:14px;color:var(--muted);line-height:1.6}
footer{border-top:1px solid var(--line);padding:24px;text-align:center;font-size:12px;color:var(--muted)}
</style>
</head>
<body>
<nav><div class="navin"><a href="/" class="brand">HIGHFLEX.</a><div class="navlinks"><a href="/">홈</a><a href="/blog/">블로그</a><a href="tel:031-922-8848">전화</a></div></div></nav>
<div class="wrap">
  <div class="blog-hero">
    <div class="tag">Blog</div>
    <h1>하이프렉스 블로그</h1>
    <p>일산 소식, 클라이밍 가이드, 운동·건강 정보를 매일 업데이트합니다.</p>
  </div>
  <div class="post-list">
${cards || '    <p style="color:var(--muted);text-align:center;padding:40px 0">아직 포스트가 없습니다. 곧 시작됩니다!</p>'}
  </div>
</div>
<footer>© 2026 클라이밍 하이프렉스 — climbingstudios.com</footer>
</body>
</html>`;

  fs.writeFileSync(path.join(BLOG_DIR, "index.html"), indexHtml, "utf-8");
}

// ── 메인 ──
async function main() {
  console.log("🧗 클라이밍 하이프렉스 블로그 자동 생성기");

  if (alreadyPostedToday()) {
    console.log("✅ 오늘 이미 포스트가 있습니다. 건너뜁니다.");
    return;
  }

  const category = getTodayCategory();
  console.log(`📂 오늘의 카테고리: ${category.name} (${category.id})`);

  const existingTitles = getExistingTitles();
  console.log(`📝 기존 글 ${existingTitles.length}편`);

  const { title, article, category: cat } = await generatePost(category, existingTitles);
  const today = todayStr();
  const slug = makeSlug(title);
  const filename = `${today}-${slug}.html`;

  const fullHtml = wrapInPage(title, article, cat, today);
  fs.writeFileSync(path.join(BLOG_DIR, filename), fullHtml, "utf-8");
  console.log(`✨ 생성: blog/${filename}`);
  console.log(`   제목: ${title}`);

  // 블로그 목록 페이지 재생성
  regenerateIndex();
  console.log("📋 blog/index.html 목록 업데이트 완료");

  // sitemap에 새 포스트 추가
  updateSitemap(filename, today);
  console.log("🗺️ sitemap.xml 업데이트 완료");
}

// ── sitemap 업데이트 ──
function updateSitemap(filename, date) {
  const sitemapPath = path.join(__dirname, "..", "sitemap.xml");
  let sitemap = fs.readFileSync(sitemapPath, "utf-8");

  const newEntry = `  <url>
    <loc>${SITE_URL}/blog/${filename}</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`;

  // blog/index.html도 추가 (없으면)
  if (!sitemap.includes("/blog/")) {
    const blogIndex = `  <url>
    <loc>${SITE_URL}/blog/</loc>
    <lastmod>${date}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;
    sitemap = sitemap.replace("</urlset>", `${blogIndex}\n</urlset>`);
  } else {
    // blog/ lastmod 업데이트
    sitemap = sitemap.replace(
      /(<loc>https:\/\/climbingstudios\.com\/blog\/<\/loc>\s*<lastmod>)\d{4}-\d{2}-\d{2}/,
      `$1${date}`
    );
  }

  sitemap = sitemap.replace("</urlset>", `${newEntry}\n</urlset>`);
  fs.writeFileSync(sitemapPath, sitemap, "utf-8");
}

main().catch(err => {
  console.error("❌ 에러:", err.message);
  process.exit(1);
});
