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
  if (/\b(paper|publication|proceedings|preprint)\b/i.test(path)) return {kind: 'Likely paper', pdfUrl: null, confidence: 'heuristic'};
  return null;
}

function technicalPageInfo(raw, title = '') {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = decodeURIComponent(url.pathname).toLowerCase();
  const text = `${title} ${host} ${path}`.toLowerCase();

  const databaseHost = /(^|\.)(postgresql\.org|mysql\.com|mariadb\.com|sqlite\.org|mongodb\.com|redis\.io|duckdb\.org|clickhouse\.com|cassandra\.apache\.org|couchdb\.apache\.org|neo4j\.com|influxdata\.com|elastic\.co|opensearch\.org|cockroachlabs\.com|planetscale\.com|supabase\.com|firebase\.google\.com|snowflake\.com|databricks\.com|dynamodb\.amazon\.com)$/.test(host);
  if (databaseHost || /\b(database|databases|dbms|sql|nosql|postgres(?:ql)?|mysql|mariadb|sqlite|mongodb|redis|duckdb|clickhouse|cassandra|couchdb|neo4j|dynamodb|data warehouse|query optimizer|transaction isolation)\b/.test(text)) return {kind: 'Database'};

  if (/^(developer\.mozilla\.org|docs\.python\.org|docs\.github\.com|learn\.microsoft\.com|developer\.apple\.com|developer\.android\.com)$/.test(host)) return {kind: 'Documentation'};
  if (/^(stackoverflow\.com|serverfault\.com|superuser\.com|stackexchange\.com)$/.test(host) && /^\/questions\//.test(path)) return {kind: 'Q&A'};
  if (/^(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)$/.test(host) && /^\/[^/]+\/[^/]+/.test(path)) return {kind: 'Repository'};
  if (/^(npmjs\.com|pypi\.org|crates\.io|pkg\.go\.dev|rubygems\.org|packagist\.org|nuget\.org|mvnrepository\.com)$/.test(host)) return {kind: 'Package'};
  if (/^(rfc-editor\.org|ietf\.org|w3\.org|tc39\.es|whatwg\.org|kubernetes\.io|docker\.com)$/.test(host)) return {kind: 'Standard / platform'};
  if (/^(dblp\.org|semanticscholar\.org|paperswithcode\.com|scholar\.google\.com|researchgate\.net)$/.test(host)) return {kind: 'Computer science research'};
  if (/\.edu$/.test(host) && /\/(courses?|classes?|teaching|lectures?|research|publications?|~[^/]+\/)/.test(path)) return {kind: 'Computer science education'};
  if (/^(dev\.to|medium\.com|hackernoon\.com|css-tricks\.com|smashingmagazine\.com|martinfowler\.com|infoq\.com|dzone\.com)$/.test(host)) return {kind: 'Technical article'};
  if (/^(docs?|developer|developers|learn|help|reference)\./.test(host) || /\/(docs?|documentation|reference|api|sdk|guides?|tutorials?|manual|cookbook|examples?)(?:\/|$)/.test(path)) return {kind: 'Documentation'};
  if (/\b(algorithms?|data structures?|distributed systems?|operating systems?|compilers?|programming language|software engineering|computer science|machine learning|deep learning|neural network|computer vision|natural language processing|cybersecurity|cryptography|web development|cloud computing|kubernetes|docker|linux kernel|source code)\b/.test(text)) return {kind: 'Computer science'};
  return null;
}

async function getTabGroups() {
  const groups = await chrome.tabGroups.query({});
  const withCounts = await Promise.all(groups.map(async group => ({
    ...group,
    tabCount: (await chrome.tabs.query({groupId: group.id})).length
  })));
  return withCounts.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
}

function tabGroupKey(tab, group) {
  return group ? `group:${tab.windowId}:${group.id}` : `ungrouped:${tab.windowId}`;
}

async function getDashboardTabs() {
  const [tabs, groups, stored, downloads] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.storage.local.get(STATE_KEY),
    chrome.downloads.search({limit: 1000, orderBy: ['-startTime']})
  ]);
  const extensionOrigin = chrome.runtime.getURL('');
  const groupsById = new Map(groups.map(group => [`${group.windowId}:${group.id}`, group]));
  const downloadedUrls = new Set(stored[STATE_KEY]?.downloadedUrls || []);
  for (const download of downloads) {
    for (const candidate of [download.url, download.finalUrl]) {
      if (candidate) downloadedUrls.add(cleanUrl(candidate));
    }
  }

  const records = tabs
    .filter(tab => tab.id && tab.url && !tab.url.startsWith(extensionOrigin) && /^https?:/i.test(tab.url))
    .map(tab => {
      const group = tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
        ? null
        : groupsById.get(`${tab.windowId}:${tab.groupId}`) || null;
      const classified = classifyItem({
        id: `tab:${tab.id}`,
        tabId: tab.id,
        windowId: tab.windowId,
        title: tab.title || 'Untitled tab',
        url: tab.url,
        source: 'tab',
        pinned: Boolean(tab.pinned),
        active: Boolean(tab.active),
        addedToScanAt: tab.lastAccessed
      });
      const downloadUrl = classified.info?.pdfUrl;
      return {
        ...classified,
        groupKey: tabGroupKey(tab, group),
        group: group ? {
          id: group.id,
          title: group.title || 'Unnamed group',
          color: group.color,
          collapsed: group.collapsed,
          windowId: group.windowId
        } : {
          id: null,
          title: `Ungrouped · Window ${tab.windowId}`,
          color: 'grey',
          collapsed: false,
          windowId: tab.windowId
        },
        downloadStatus: downloadUrl && downloadedUrls.has(cleanUrl(downloadUrl)) ? 'downloaded' : 'not-downloaded'
      };
    });

  records.sort((a, b) =>
    a.group.title.localeCompare(b.group.title) ||
    a.windowId - b.windowId ||
    a.title.localeCompare(b.title)
  );
  return records;
}

async function organizeTabs({tabIds = []} = {}) {
  const records = (await getDashboardTabs()).filter(item => tabIds.length === 0 || tabIds.includes(item.tabId));
  if (!records.length) throw new Error('There are no open web tabs to organize.');

  const created = await chrome.windows.create({url: chrome.runtime.getURL('dashboard.html'), focused: true});
  const validIds = new Set((await chrome.tabs.query({})).map(tab => tab.id));
  const movable = records.filter(item => validIds.has(item.tabId));
  if (!movable.length) throw new Error('The selected tabs are no longer open.');
  const pinned = movable.filter(item => item.pinned);
  const unpinned = movable.filter(item => !item.pinned);
  if (pinned.length) await chrome.tabs.move(pinned.map(item => item.tabId), {windowId: created.id, index: 0});
  if (unpinned.length) await chrome.tabs.move(unpinned.map(item => item.tabId), {windowId: created.id, index: -1});

  const grouped = new Map();
  for (const item of unpinned) {
    if (!grouped.has(item.groupKey)) grouped.set(item.groupKey, []);
    grouped.get(item.groupKey).push(item);
  }
  for (const items of grouped.values()) {
    const groupId = await chrome.tabs.group({tabIds: items.map(item => item.tabId), createProperties: {windowId: created.id}});
    const source = items[0].group;
    await chrome.tabGroups.update(groupId, {
      title: source.title,
      color: source.color || 'grey',
      collapsed: Boolean(source.collapsed)
    });
  }
  return {windowId: created.id, organized: movable.length, pinned: pinned.length};
}

async function closeDashboardTabs({tabIds = []} = {}) {
  if (!tabIds.length) throw new Error('No tabs were selected to close.');
  const openIds = new Set((await chrome.tabs.query({})).map(tab => tab.id));
  const ids = [...new Set(tabIds)].filter(id => Number.isInteger(id) && openIds.has(id));
  if (ids.length) await chrome.tabs.remove(ids);
  return {closed: ids.length};
}
function paperReason(info) {
  const reasons = {
    direct: 'Direct PDF URL',
    'known-host': 'Recognized paper host',
    paper: 'Recognized publisher or DOI',
    heuristic: 'Paper terms in URL'
  };
  return reasons[info.confidence] || 'Matched paper rule';
}

function classifyItem(item) {
  const paper = paperInfo(item.url);
  if (paper) {
    return {...item, classification: 'Paper', reason: paperReason(paper), info: paper};
  }

  const technical = technicalPageInfo(item.url, item.title);
  if (technical) {
    return {...item, classification: 'Technical', reason: `Matched ${technical.kind} rule`, info: technical};
  }

  try {
    if (!/^https?:$/.test(new URL(item.url).protocol)) {
      return {...item, classification: 'Filtered', reason: 'Unsupported URL scheme', info: null};
    }
  } catch {
    return {...item, classification: 'Filtered', reason: 'Invalid URL', info: null};
  }

  return {...item, classification: 'Other', reason: 'Valid web link; no paper or technical rule matched', info: null};
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

async function scan({folderId = null, folderName = 'All groups', includeBookmarks = true, includeTabGroups = false, includeOpenTabs = false, tabGroupId = null} = {}) {
  if (!includeBookmarks && !includeTabGroups && !includeOpenTabs) {
    throw new Error('Choose at least one page source to scan.');
  }

  const scanStartedAt = Date.now();
  await save({
    status: 'scanning',
    message: 'Scanning selected pages…',
    folderId,
    includeBookmarks,
    includeTabGroups,
    includeOpenTabs,
    tabGroupId
  });

  const items = [];
  const bookmarkItems = [];

  if (includeBookmarks) {
    const tree = await chrome.bookmarks.getTree();
    let selectedGroupFound = !folderId;

    const walk = (nodes, folders = [], inSelectedGroup = !folderId) => {
      for (const node of nodes) {
        const selected = inSelectedGroup || node.id === folderId;
        if (node.id === folderId) selectedGroupFound = true;

        if (node.url && selected) {
          const bookmark = {
            id: node.id,
            title: node.title || 'Untitled',
            url: node.url,
            folder: folders.join(' / ') || 'Bookmarks',
            source: 'bookmark',
            dateAdded: node.dateAdded
          };
          items.push(bookmark);
          bookmarkItems.push(bookmark);
        }

        if (node.children) {
          const nextFolders = node.id === '0' ? folders : [...folders, node.title || 'Unnamed folder'];
          walk(node.children, nextFolders, selected);
        }
      }
    };

    walk(tree);
    if (!selectedGroupFound) throw new Error('The selected bookmark group no longer exists.');
  }

  if (includeTabGroups) {
    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({}),
      chrome.tabGroups.query({})
    ]);
    const groupsById = new Map(groups.map(group => [group.id, group]));

    for (const tab of tabs) {
      if (!tab.url || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
      if (tabGroupId !== null && tab.groupId !== tabGroupId) continue;

      const group = groupsById.get(tab.groupId);
      if (!group) continue;

      items.push({
        id: `tab:${tab.id}`,
        title: tab.title || 'Untitled tab',
        url: tab.url,
        folder: `Tab groups / ${group.title || 'Unnamed tab group'} / Window ${tab.windowId}`,
        source: 'tab',
        tabGroupId: group.id,
        tabGroupName: group.title || 'Unnamed tab group',
        addedToScanAt: tab.lastAccessed || scanStartedAt
      });
    }
  }

  if (includeOpenTabs) {
    const tabs = await chrome.tabs.query({groupId: chrome.tabGroups.TAB_GROUP_ID_NONE});
    for (const tab of tabs) {
      if (!tab.url) continue;
      items.push({
        id: `tab:${tab.id}`,
        title: tab.title || 'Untitled tab',
        url: tab.url,
        folder: `Open tabs / Ungrouped / Window ${tab.windowId}`,
        source: 'tab',
        tabGroupId: chrome.tabGroups.TAB_GROUP_ID_NONE,
        addedToScanAt: tab.lastAccessed || scanStartedAt
      });
    }
  }

  const byUrl = new Map();
  for (const bookmark of bookmarkItems) {
    const key = cleanUrl(bookmark.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(bookmark);
  }

  const duplicateGroups = [...byUrl.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([url, matches]) => ({url, keep: matches[0], remove: matches.slice(1)}));

  const linkReport = items.map(classifyItem);
  const papers = linkReport.filter(item => item.classification === 'Paper');
  const technicalPages = linkReport.filter(item => item.classification === 'Technical');
  const otherPages = linkReport.filter(item => item.classification === 'Other');
  const filteredPages = linkReport.filter(item => item.classification === 'Filtered');
  const scope = includeBookmarks && folderId ? `${folderName}: ` : '';

  return save({
    status: 'ready',
    message: `${scope}Classified ${items.length} links: ${papers.length} papers, ${technicalPages.length} technical, ${otherPages.length} other, and ${filteredPages.length} filtered.`,
    scanned: items.length,
    includeBookmarks,
    includeTabGroups,
    includeOpenTabs,
    tabGroupId,
    papers,
    technicalPages,
    otherPages,
    filteredPages,
    linkReport,
    duplicateGroups,
    removed: 0,
    downloaded: 0,
    failed: []
  });
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
  const downloadedUrls = new Set(state.downloadedUrls || []);
  await save({status: 'downloading', message: `Starting ${unique.size} PDF downloads…`, downloaded: 0, failed: []});
  for (const item of unique.values()) {
    try {
      await chrome.downloads.download({url: item.info.pdfUrl, filename: safeFilename(item), conflictAction: 'uniquify', saveAs: false});
      downloaded++;
      downloadedUrls.add(cleanUrl(item.info.pdfUrl));
      await save({downloaded, downloadedUrls: [...downloadedUrls], message: `Started ${downloaded} of ${unique.size} downloads…`});
    } catch (error) { failed.push(`${item.title}: ${error.message}`); }
  }
  await save({status: 'ready', downloaded, failed, message: `Started ${downloaded} unique PDF download${downloaded === 1 ? '' : 's'}${failed.length ? `; ${failed.length} failed` : ''}.`});
  return {downloaded, failed};
}

function uniqueUrlRecords(state) {
  const records = [];
  const seen = new Set();
  for (const item of state.linkReport || [...(state.papers || []), ...(state.technicalPages || [])]) {
    const key = cleanUrl(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push({
      url: item.url,
      classification: item.classification || (item.info ? 'Detected' : 'Filtered'),
      type: item.info?.kind || null,
      reason: item.reason || null,
      location: item.folder,
      title: item.title,
      source: item.source || 'bookmark',
      addedAt: item.dateAdded || item.addedToScanAt ? new Date(item.dateAdded || item.addedToScanAt).toISOString() : null
    });
  }
  return records;
}

async function exportUniqueUrls() {
  const state = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY];
  if (!state?.linkReport && !state?.papers && !state?.technicalPages) throw new Error('Scan pages first.');
  const records = uniqueUrlRecords(state);
  const payload = JSON.stringify({generatedAt: new Date().toISOString(), count: records.length, urls: records}, null, 2);
  const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`;
  const fileName = 'Bookmark Papers/classification-report.json';
  await chrome.downloads.download({url: dataUrl, filename: fileName, conflictAction: 'uniquify', saveAs: false});
  await save({status: 'ready', message: `Exported classification decisions for ${records.length} unique URL${records.length === 1 ? '' : 's'}.`, failed: []});
  return {count: records.length, fileName};
}

chrome.runtime.onInstalled.addListener(() => {
  save({status: 'idle', message: 'Ready to scan your pages.'});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const actions = {scan, removeDuplicates, downloadPdfs, exportUniqueUrls, getTabGroups, getDashboardTabs, organizeTabs, closeDashboardTabs};
  if (!actions[message.action]) return;
  actions[message.action](message).then(result => respond({ok: true, result})).catch(error => respond({ok: false, error: error.message}));
  return true;
});
