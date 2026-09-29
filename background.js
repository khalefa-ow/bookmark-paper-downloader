const STATE_KEY = 'paperSweeperState';
const TRACKERS = /^(utm_.+|fbclid|gclid|dclid|mc_cid|mc_eid|ref|source)$/i;

function cleanUrl(raw) {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKERS.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function paperInfo(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeURIComponent(url.pathname);
  const directPdf = /\.pdf$/i.test(path) || /[?&](format|type)=pdf(?:&|$)/i.test(url.search);

  if (directPdf) return {kind: 'PDF', pdfUrl: raw, confidence: 'direct'};

  let match;
  if (host === 'arxiv.org' && (match = path.match(/^\/(?:abs|pdf)\/([^/]+?)(?:\.pdf)?$/i))) {
    return {kind: 'arXiv paper', pdfUrl: `https://arxiv.org/pdf/${match[1]}.pdf`, confidence: 'known-host'};
  }
  if (host === 'openreview.net' && path === '/forum' && url.searchParams.get('id')) {
    return {kind: 'OpenReview paper', pdfUrl: `https://openreview.net/pdf?id=${encodeURIComponent(url.searchParams.get('id'))}`, confidence: 'known-host'};
  }
  if ((host === 'biorxiv.org' || host === 'medrxiv.org') && /^\/content\//.test(path)) {
    const base = `${url.origin}${path}`.replace(/\.full(?:\.pdf)?$/i, '');
    return {kind: host.startsWith('bio') ? 'bioRxiv paper' : 'medRxiv paper', pdfUrl: `${base}.full.pdf`, confidence: 'known-host'};
  }
  if (host === 'aclanthology.org' && /^\/[\w.-]+\/?$/.test(path)) {
    return {kind: 'ACL paper', pdfUrl: `${url.origin}${path.replace(/\/$/, '')}.pdf`, confidence: 'known-host'};
  }
  if (host === 'proceedings.mlr.press' && (match = path.match(/^(\/v\d+\/[^/]+)\.html$/i))) {
    return {kind: 'PMLR paper', pdfUrl: `${url.origin}${match[1]}.pdf`, confidence: 'known-host'};
  }
  if (/^(dl\.)?acm\.org$/.test(host) && path.startsWith('/doi/')) return {kind: 'ACM paper', pdfUrl: null, confidence: 'paper'};
  if (/^(ieeexplore\.ieee\.org|link\.springer\.com|nature\.com|science\.org|sciencedirect\.com)$/.test(host)) return {kind: 'Publisher paper', pdfUrl: null, confidence: 'paper'};
  if (host === 'doi.org') return {kind: 'DOI paper', pdfUrl: null, confidence: 'paper'};
  if (/\b(paper|article|publication|proceedings|preprint)\b/i.test(path)) return {kind: 'Likely paper', pdfUrl: null, confidence: 'heuristic'};
  return null;
}

function technicalPageInfo(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeURIComponent(url.pathname).toLowerCase();

  if (/^(developer\.mozilla\.org|docs\.python\.org|docs\.github\.com|learn\.microsoft\.com|developer\.apple\.com|developer\.android\.com)$/.test(host)) return {kind: 'Documentation'};
  if (/^(stackoverflow\.com|serverfault\.com|superuser\.com)$/.test(host) && /^\/questions\//.test(path)) return {kind: 'Q&A'};
  if (host === 'github.com' && /^\/[^/]+\/[^/]+/.test(path)) return {kind: 'Repository'};
  if (/^(dev\.to|medium\.com|hackernoon\.com|css-tricks\.com|smashingmagazine\.com)$/.test(host)) return {kind: 'Technical article'};
  if (/\/(docs?|documentation|reference|api|sdk|guides?|tutorials?|manual)(?:\/|$)/.test(path)) return {kind: 'Documentation'};
  return null;
}

function safeFilename(item) {
  const title = (item.title || 'paper').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  return `Bookmark Papers/${title || 'paper'}.pdf`;
}

async function save(patch) {
  const old = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || {};
  const next = {...old, ...patch, updatedAt: Date.now()};
  await chrome.storage.local.set({[STATE_KEY]: next});
  return next;
}

async function scan({folderId = null, folderName = 'All groups', includeOpenTabs = false, tabGroupId = null} = {}) {
  await save({status: 'scanning', message: folderId ? `Scanning ${folderName}\u2026` : 'Scanning every bookmark group\u2026', folderId, includeOpenTabs, tabGroupId});
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = [];
  let selectedGroupFound = !folderId;
  const walk = (nodes, folders = [], inSelectedGroup = !folderId) => {
    for (const node of nodes) {
      const selected = inSelectedGroup || node.id === folderId;
      if (node.id === folderId) selectedGroupFound = true;
      if (node.url && selected) bookmarks.push({id: node.id, title: node.title || 'Untitled', url: node.url, folder: folders.join(' / ') || 'Bookmarks'});
      if (node.children) walk(node.children, node.id === '0' ? folders : [...folders, node.title || 'Unnamed folder'], selected);
    }
  };
  walk(tree);
  if (!selectedGroupFound) throw new Error('The selected bookmark group no longer exists.');
  const bookmarkItems = [...bookmarks];
  if (includeOpenTabs) {
    const [tabs, tabGroups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
    const groupsById = new Map(tabGroups.map(group => [group.id, group]));
    if (tabGroupId !== null && tabGroupId !== -1 && !groupsById.has(tabGroupId)) throw new Error('The selected tab group no longer exists.');
    for (const tab of tabs) {
      if (!tab.url || (tabGroupId !== null && tab.groupId !== tabGroupId)) continue;
      const group = groupsById.get(tab.groupId);
      const groupName = group ? group.title || 'Unnamed tab group' : 'Ungrouped';
      bookmarks.push({id: `tab:${tab.id}`, title: tab.title || 'Untitled tab', url: tab.url, folder: `Open tabs / ${groupName} / Window ${tab.windowId}`, source: 'tab', tabGroupId: tab.groupId});
    }
  }

  const byUrl = new Map();
  for (const bookmark of bookmarkItems) {
    const key = cleanUrl(bookmark.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(bookmark);
  }
  const duplicateGroups = [...byUrl.entries()].filter(([, items]) => items.length > 1).map(([url, items]) => ({url, keep: items[0], remove: items.slice(1)}));
  const papers = bookmarks.map(item => ({...item, info: paperInfo(item.url)})).filter(item => item.info);
  const paperIds = new Set(papers.map(item => item.id));
  const technicalPages = bookmarks.filter(item => !paperIds.has(item.id)).map(item => ({...item, info: technicalPageInfo(item.url)})).filter(item => item.info);
  const downloadable = papers.filter(item => item.info.pdfUrl);
  return save({status: 'ready', message: `${folderId ? folderName + ": " : ""}Found ${papers.length} papers, ${technicalPages.length} technical pages, ${downloadable.length} downloadable PDFs, and ${duplicateGroups.reduce((n, g) => n + g.remove.length, 0)} duplicate bookmarks.`, scanned: bookmarks.length, includeOpenTabs, tabGroupId, papers, technicalPages, duplicateGroups, removed: 0, downloaded: 0, failed: []});
}

async function removeDuplicates() {
  const state = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  if (!state?.duplicateGroups) throw new Error('Scan bookmarks first.');
  const ids = state.duplicateGroups.flatMap(group => group.remove.map(item => item.id));
  let removed = 0;
  const failed = [];
  for (const id of ids) {
    try { await chrome.bookmarks.remove(id); removed++; }
    catch (error) { failed.push(`Bookmark ${id}: ${error.message}`); }
  }
  await save({removed, duplicateGroups: [], status: 'ready', message: `Removed ${removed} duplicate bookmark${removed === 1 ? '' : 's'}.`, failed});
  return {removed, failed};
}

async function downloadPdfs() {
  const state = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  if (!state?.papers) throw new Error('Scan bookmarks first.');
  const unique = new Map();
  for (const item of state.papers) if (item.info.pdfUrl) unique.set(cleanUrl(item.info.pdfUrl), item);
  let downloaded = 0;
  const failed = [];
  await save({status: 'downloading', message: `Starting ${unique.size} PDF downloads…`, downloaded: 0, failed: []});
  for (const item of unique.values()) {
    try {
      await chrome.downloads.download({url: item.info.pdfUrl, filename: safeFilename(item), conflictAction: 'uniquify', saveAs: false});
      downloaded++;
      await save({downloaded, message: `Started ${downloaded} of ${unique.size} downloads…`});
    } catch (error) { failed.push(`${item.title}: ${error.message}`); }
  }
  await save({status: 'ready', downloaded, failed, message: `Started ${downloaded} unique PDF download${downloaded === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed` : ''}.`});
  return {downloaded, failed};
}

chrome.runtime.onInstalled.addListener(() => save({status: 'idle', message: 'Ready to scan your bookmarks.'}));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const actions = {scan, removeDuplicates, downloadPdfs};
  if (!actions[message.action]) return;
  actions[message.action](message).then(result => respond({ok: true, result})).catch(error => respond({ok: false, error: error.message}));
  return true;
});
