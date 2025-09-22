/// facebook-feeds-filter.js (refactor nhỏ, không đổi logic)
(function () {
  const categoriesToHide = '{{1}}';  // Optional argument to filter posts by their category
  const setOfCategoriesToHide = (() => {
    if (categoriesToHide === '' || categoriesToHide === '{{1}}') return new Set();
    return new Set(categoriesToHide.split(/\s*\|\s*/).map(s => s.toUpperCase()));
  })();

  const categoryMap = {
    UNKNOWN: 0, ORGANIC: 1, ENGAGEMENT: 2, FIXED_POSITION: 3, PROMOTION: 4, SPONSORED: 5,
    END_OF_FEED_CONTENT: 6, FB_STORIES: 7, HIGH_VALUE_PROMOTION: 8, FB_STORIES_ENGAGEMENT: 9,
    SHOWCASE: 10, FB_SHORTS: 11, TRENDING: 12, ENGAGEMENT_QP: 13, MULTI_FB_STORIES_TRAY: 14,
    END_OF_FEED_REELS: 15, FB_SHORTS_FALLBACK: 16
  };
  const categoryMapEntries = Object.entries(categoryMap);

  const magic = String.fromCharCode((Date.now() % 26) + 97) +
    Math.floor(Math.random() * 982451653 + 982451653).toString(36);

  // --- caches & guards ---
  const processed = new WeakSet();          // tránh xử lý lại cùng node
  const postHashCache = new Map();          // post_id -> sha256(post_id)
  const encProbeCache = new Map();          // b+'|'+catId -> sha256(b+catId)
  const encToCategoryCache = new Map();     // enc -> category

  const sha256 = async (message) => {
    const msgUint8 = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const fromObfuscatedCategory = async (node, enc, post_id) => {
    if (encToCategoryCache.has(enc)) return { node, category: encToCategoryCache.get(enc) };

    let b = postHashCache.get(post_id);
    if (!b) { b = await sha256(post_id); postHashCache.set(post_id, b); }

    for (let i = 0; i < categoryMapEntries.length; i++) {
      const [g, id] = categoryMapEntries[i];
      const key = b + '|' + id;
      let probe = encProbeCache.get(key);
      if (!probe) { probe = await sha256(b + id); encProbeCache.set(key, probe); }
      if (probe === enc) { encToCategoryCache.set(enc, g); return { node, category: g }; }
    }
    return undefined;
  };

  // BFS tìm field khớp pattern, ưu tiên tầng nông
  const findNestedProperty = (obj, patt, fn, depth) => {
    const isRe = typeof patt.test === 'function';
    const queue = [obj];
    let lvl = 0;
    while (queue.length && lvl <= depth) {
      const size = queue.length;
      for (let i = 0; i < size; i++) {
        const cur = queue.shift();
        if (!cur || typeof cur !== 'object') continue;
        const keys = Object.keys(cur).filter(k => isRe ? patt.test(k) : (k.match(patt)));
        if (keys.length === 1) {
          try { return fn(cur[keys[0]]); } catch { return undefined; }
        }
        for (const v of Object.values(cur)) if (v && typeof v === 'object') queue.push(v);
      }
      lvl++;
    }
    return undefined;
  };

  const processInsertedFeedUnit = (feedUnit, category) => {
    switch (category) {
      case 'ORGANIC':
        break; // không ẩn
      case 'SPONSORED':
        feedUnit.classList.add(magic);
        break;
      default:
        if (setOfCategoriesToHide.has(category)) feedUnit.classList.add(magic);
    }
  };

  const extractReactProps = (node) => {
    const ks = Object.keys(node).filter(k => k.startsWith('__reactProps'));
    if (ks.length !== 1) return null;
    return node[ks[0]];
  };

  const checkWhetherFeedUnit = (node) => {
    if (!(node instanceof HTMLDivElement)) return;
    if (processed.has(node)) return;

    const o = extractReactProps(node);
    if (!o) return;

    let down;
    try { down = o.children?.props?.children?.props?.children?.props; } catch {}
    if (!down) down = o.children?.props ?? o.props ?? o;
    if (!down) return;

    const feed = findNestedProperty(down, /feed/, x => x, 4);
    if (!feed) return;

    // Case cũ: category plain
    const plain = findNestedProperty(feed, /category/, x => x, 0);
    if (plain && (plain in categoryMap)) {
      processInsertedFeedUnit(node, plain);
      processed.add(node);
      return;
    }

    // Case mới: category obfuscated
    const enc = findNestedProperty(
      feed,
      /cat.*[sS]ens/,
      x => findNestedProperty(x, /enc/, y => y, 0),
      0
    );
    const post_id = findNestedProperty(feed, /post_id/, x => x, 2);

    if (enc && post_id) {
      fromObfuscatedCategory(node, enc, post_id).then(ctx => {
        if (ctx && (ctx.category in categoryMap)) {
          processInsertedFeedUnit(ctx.node, ctx.category);
          processed.add(ctx.node);
        }
      }).catch(() => {});
      return;
    }

    // Fallback: cùng nhánh có "cat"
    if (!enc) {
      const cat2 = findNestedProperty(
        feed,
        /cat.*[sS]ens/,
        x => findNestedProperty(x, /cat/, y => y, 0),
        0
      );
      if (cat2 && (cat2 in categoryMap)) {
        processInsertedFeedUnit(node, cat2);
        processed.add(node);
      }
    }
  };

  const start = () => {
    const style = document.createElement('style');
    style.textContent = `.${magic}{display:none!important}`;
    document.head.appendChild(style);

    const observer = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          checkWhetherFeedUnit(node);
          if (node.querySelectorAll) node.querySelectorAll('div').forEach(checkWhetherFeedUnit);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
