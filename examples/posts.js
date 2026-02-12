/**
 * TikTok Creator Posts Fetcher
 *
 * Fetch all posts for a TikTok creator via /api/post/item_list/.
 * Supports username (auto-resolves to secUid) or direct secUid input.
 * Full parameter coverage matching the latest TikTok web client.
 *
 * Usage:
 *   1. Start the server: npm start
 *   2. Run:
 *      node examples/posts.js --username=trashisfortossers
 *      node examples/posts.js --secUid=MS4wLjABAAAAcNwhYBR6...
 *      node examples/posts.js --username=tiktok --pages=5 --count=35 --output=posts.json
 *      node examples/posts.js --secUid=... --cookie="sessionid=abc;tt_webid=123"
 *
 * Options:
 *   --username    TikTok username (will resolve to secUid automatically)
 *   --secUid      Direct secUid (skip username resolution)
 *   --count       Videos per page (default: 35)
 *   --pages       Max pages to fetch (default: 1, use 0 for all)
 *   --output      Save results to JSON file
 *   --cookieFile  Path to cookie.json (default: ./cookie.json, browser export format)
 *   --cookie      Custom cookie string (overrides cookieFile)
 *   --delay       Delay between pages in ms (default: 1500)
 *   --server      Signature server URL (default: http://localhost:8080)
 */

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, ...rest] = arg.slice(2).split("=");
      args[key] = rest.length ? rest.join("=") : true;
    } else if (!args._positional) {
      // Treat bare argument as username for convenience
      args._positional = arg;
    }
  }
  return args;
}

const args = parseArgs();

// ---------------------------------------------------------------------------
// Cookie loading: auto-load from cookie.json if present
// ---------------------------------------------------------------------------

function loadCookiesFromFile(filepath) {
  try {
    const { readFileSync } = require("node:fs");
    const { resolve } = require("node:path");
    const abs = resolve(filepath);
    const raw = JSON.parse(readFileSync(abs, "utf-8"));
    const cookies = raw.cookies || raw;
    if (!Array.isArray(cookies)) return null;
    const str = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    console.log(`Loaded ${cookies.length} cookies from ${abs}`);
    return str;
  } catch {
    return null;
  }
}

function resolveCookie() {
  // Explicit --cookie string takes priority
  if (args.cookie) return args.cookie;
  // Then try --cookieFile or default cookie.json
  const file = args.cookieFile || "cookie.json";
  return loadCookiesFromFile(file);
}

const CONFIG = {
  SERVER_URL: args.server || "http://localhost:8080",
  USERNAME: args.username || args._positional || null,
  SEC_UID: args.secUid || null,
  COUNT: parseInt(args.count) || 35,
  MAX_PAGES: args.pages != null ? parseInt(args.pages) : 1,
  OUTPUT_FILE: args.output || null,
  CUSTOM_COOKIE: resolveCookie(),
  DELAY_MS: parseInt(args.delay) || 1500,
  DEVICE_ID: args.deviceId || "7541351101384803853",
};

if (!CONFIG.USERNAME && !CONFIG.SEC_UID) {
  console.error(
    "Error: Provide --username=<name> or --secUid=<id>\n\n" +
      "Examples:\n" +
      "  node examples/posts.js --username=trashisfortossers\n" +
      "  node examples/posts.js --secUid=MS4wLjABAAAA...\n" +
      '  node examples/posts.js --username=tiktok --pages=3 --output=posts.json\n',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Signature helpers
// ---------------------------------------------------------------------------

async function getSignedUrl(url) {
  const res = await fetch(`${CONFIG.SERVER_URL}/signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json();
  if (json.status !== "ok") {
    throw new Error(json.message || "Signature generation failed");
  }
  return json.data;
}

async function fetchFromTikTok(signedData) {
  const headers = {
    "User-Agent": signedData.navigator.user_agent,
    Cookie: CONFIG.CUSTOM_COOKIE || signedData.cookies,
    Accept: "application/json",
    Referer: "https://www.tiktok.com/",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  };

  const res = await fetch(signedData.signed_url, { headers });
  const text = await res.text();
  if (!text || text.length === 0) return null;

  try {
    return JSON.parse(text);
  } catch {
    console.error("Failed to parse TikTok response:", text.substring(0, 200));
    return null;
  }
}

async function fetchViaBrowser(url) {
  const res = await fetch(`${CONFIG.SERVER_URL}/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json();
  if (json.status !== "ok") {
    throw new Error(json.message || "Browser fetch failed");
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Username -> secUid resolution
// ---------------------------------------------------------------------------

function buildUserDetailUrl(username) {
  const params = new URLSearchParams({
    WebIdLastTime: Date.now().toString(),
    aid: "1988",
    app_language: "en",
    app_name: "tiktok_web",
    browser_language: "en-US",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "MacIntel",
    browser_version:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    cookie_enabled: "true",
    device_id: CONFIG.DEVICE_ID,
    device_platform: "web_pc",
    focus_state: "true",
    history_len: "2",
    is_fullscreen: "false",
    is_page_visible: "true",
    language: "en",
    os: "mac",
    priority_region: "US",
    region: "US",
    screen_height: "1117",
    screen_width: "1728",
    tz_name: "America/New_York",
    uniqueId: username,
    webcast_language: "en",
  });

  return `https://www.tiktok.com/api/user/detail/?${params.toString()}`;
}

async function resolveSecUid(username) {
  console.log(`Resolving secUid for @${username}...`);

  const url = buildUserDetailUrl(username);

  // Try /signature + external request first
  let data;
  try {
    const signedData = await getSignedUrl(url);
    data = await fetchFromTikTok(signedData);
  } catch (e) {
    console.log("External request failed:", e.message);
    data = null;
  }

  // Fallback to browser fetch
  if (!data || !data.userInfo) {
    console.log("Falling back to browser fetch for user detail...");
    data = await fetchViaBrowser(url);
  }

  if (data) {
    console.log(`User detail response keys: [${Object.keys(data).join(", ")}]`);
  }

  const user = data?.userInfo?.user;
  const stats = data?.userInfo?.stats;
  if (!user || !user.secUid) {
    console.error("Full user detail response:");
    console.error(JSON.stringify(data, null, 2)?.substring(0, 1000));
    throw new Error(
      `Could not resolve secUid for @${username}. ` +
        "The user may not exist or TikTok blocked the request.",
    );
  }

  console.log(`Resolved: @${user.uniqueId} (${user.nickname})`);
  console.log(`secUid:   ${user.secUid}`);
  console.log(
    `Stats:    ${stats?.followerCount?.toLocaleString() || user.followerCount?.toLocaleString() || "?"} followers, ` +
      `${stats?.heartCount?.toLocaleString() || user.heartCount?.toLocaleString() || "?"} likes, ` +
      `${stats?.videoCount?.toLocaleString() || user.videoCount?.toLocaleString() || "?"} videos`,
  );
  console.log("");

  return { secUid: user.secUid, userInfo: user };
}

// ---------------------------------------------------------------------------
// Post list API
// ---------------------------------------------------------------------------

function buildPostListUrl(secUid, cursor = 0, count = 35) {
  const params = new URLSearchParams({
    WebIdLastTime: Date.now().toString(),
    aid: "1988",
    app_language: "en-GB",
    app_name: "tiktok_web",
    browser_language: "en-GB",
    browser_name: "Mozilla",
    browser_online: "true",
    browser_platform: "MacIntel",
    browser_version:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    channel: "tiktok_web",
    cookie_enabled: "true",
    count: count.toString(),
    coverFormat: "2",
    cursor: cursor.toString(),
    data_collection_enabled: "true",
    device_id: CONFIG.DEVICE_ID,
    device_platform: "web_pc",
    focus_state: "true",
    history_len: "2",
    is_fullscreen: "false",
    is_page_visible: "true",
    language: "en-GB",
    os: "mac",
    priority_region: "US",
    referer: "",
    region: "US",
    screen_height: "1117",
    screen_width: "1728",
    secUid: secUid,
    tz_name: "Asia/Shanghai",
    video_encoding: "mp4",
    webcast_language: "en-GB",
  });

  return `https://www.tiktok.com/api/post/item_list/?${params.toString()}`;
}

async function fetchPostPage(secUid, cursor = 0, count = 35) {
  const url = buildPostListUrl(secUid, cursor, count);

  let data;

  // Try /signature + external request
  try {
    const signedData = await getSignedUrl(url);
    console.log(`  Signed URL: ${signedData.signed_url.substring(0, 120)}...`);
    data = await fetchFromTikTok(signedData);
    if (data) {
      console.log(
        `  Response keys: [${Object.keys(data).join(", ")}]`,
      );
      if (data.statusCode != null) {
        console.log(`  statusCode: ${data.statusCode}, statusMsg: ${data.statusMsg || ""}`);
      }
      if (data.itemList) {
        console.log(`  itemList length: ${data.itemList.length}`);
      } else {
        console.log(`  No itemList in response. Full response preview:`);
        console.log(`  ${JSON.stringify(data).substring(0, 500)}`);
      }
    } else {
      console.log("  External request returned null/empty");
    }
  } catch (e) {
    console.log("  External request failed:", e.message);
    data = null;
  }

  // Fallback
  if (!data || !data.itemList) {
    console.log("  Falling back to browser fetch...");
    try {
      data = await fetchViaBrowser(url);
      if (data) {
        console.log(
          `  [Fallback] Response keys: [${Object.keys(data).join(", ")}]`,
        );
        if (data.itemList) {
          console.log(`  [Fallback] itemList length: ${data.itemList.length}`);
        } else {
          console.log(`  [Fallback] No itemList. Response preview:`);
          console.log(`  ${JSON.stringify(data).substring(0, 500)}`);
        }
      }
    } catch (e) {
      console.log("  Browser fetch also failed:", e.message);
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

async function fetchAllPosts(secUid) {
  const allItems = [];
  let cursor = 0;
  let hasMore = true;
  let page = 0;
  const maxPages = CONFIG.MAX_PAGES === 0 ? Infinity : CONFIG.MAX_PAGES;

  while (hasMore && page < maxPages) {
    page++;
    console.log(
      `[Page ${page}] Fetching ${CONFIG.COUNT} posts (cursor=${cursor})...`,
    );

    const data = await fetchPostPage(secUid, cursor, CONFIG.COUNT);

    if (!data || !data.itemList || data.itemList.length === 0) {
      console.log(`[Page ${page}] No items returned. Stopping.`);
      break;
    }

    allItems.push(...data.itemList);
    console.log(
      `[Page ${page}] Got ${data.itemList.length} posts (total: ${allItems.length})`,
    );

    hasMore = !!data.hasMore;
    cursor = data.cursor || 0;

    if (hasMore && page < maxPages) {
      console.log(`  Waiting ${CONFIG.DELAY_MS}ms before next page...`);
      await new Promise((r) => setTimeout(r, CONFIG.DELAY_MS));
    }
  }

  return { itemList: allItems, hasMore, cursor };
}

// ---------------------------------------------------------------------------
// Display & output
// ---------------------------------------------------------------------------

function formatNumber(n) {
  if (n == null) return "N/A";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function displayPosts(items) {
  console.log("\n" + "=".repeat(70));
  console.log(`RESULTS: ${items.length} posts`);
  console.log("=".repeat(70));

  items.forEach((video, i) => {
    const desc = (video.desc || "").substring(0, 60);
    const date = new Date(video.createTime * 1000).toISOString().split("T")[0];
    const s = video.stats || {};

    console.log(
      `\n${String(i + 1).padStart(3)}. [${date}] ${video.id}`,
    );
    if (desc) console.log(`     ${desc}${video.desc?.length > 60 ? "..." : ""}`);
    console.log(
      `     Views: ${formatNumber(s.playCount)}  ` +
        `Likes: ${formatNumber(s.diggCount)}  ` +
        `Comments: ${formatNumber(s.commentCount)}  ` +
        `Shares: ${formatNumber(s.shareCount)}`,
    );
    if (video.video?.duration) {
      console.log(`     Duration: ${video.video.duration}s`);
    }
  });

  console.log("\n" + "=".repeat(70));
}

async function saveToFile(filepath, data) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filepath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\nResults saved to ${filepath}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let secUid = CONFIG.SEC_UID;
  let userInfo = null;

  // Resolve username -> secUid if needed
  if (!secUid) {
    const resolved = await resolveSecUid(CONFIG.USERNAME);
    secUid = resolved.secUid;
    userInfo = resolved.userInfo;
  }

  // Fetch posts
  const result = await fetchAllPosts(secUid);

  if (!result.itemList || result.itemList.length === 0) {
    console.log("\nNo posts found for this user.");
    process.exit(0);
  }

  // Display
  displayPosts(result.itemList);

  if (result.hasMore) {
    console.log(
      `\nNote: More posts available (next cursor: ${result.cursor}). ` +
        "Use --pages=0 to fetch all.",
    );
  }

  // Save to file
  if (CONFIG.OUTPUT_FILE) {
    const output = {
      fetchedAt: new Date().toISOString(),
      secUid,
      userInfo: userInfo || null,
      totalPosts: result.itemList.length,
      hasMore: result.hasMore,
      nextCursor: result.cursor,
      posts: result.itemList,
    };
    await saveToFile(CONFIG.OUTPUT_FILE, output);
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
