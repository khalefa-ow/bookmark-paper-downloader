const $ = id => document.getElementById(id);
let tabs = [];
let descriptions = new Map();
let reloadTimer;
let operationBusy = false;

function domainFor(raw) {
  try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return raw; }
}

function fallbackDescription(item) {
  const domain = domainFor(item.url);
  const kind = item.info?.kind || item.classification.toLowerCase();
  if (item.classification === 'Paper') return `${kind} from ${domain}; ${item.info?.pdfUrl ? 'a PDF is available for download.' : 'open the publisher page to read or download it.'}`;
  if (item.classification === 'Technical') return `${kind} resource on ${domain}, kept for technical reference.`;
  return `Web page from ${domain}, collected from ${item.group.title}.`;
}

function filteredTabs() {
  const query = $('search').value.trim().toLowerCase();
  const download = $('downloadFilter').value;
  const type = $('typeFilter').value;
  return tabs.filter(item => {
    const haystack = `${item.title} ${item.url} ${item.group.title}`.toLowerCase();
    return (!query || haystack.includes(query)) &&
      (download === 'all' || item.downloadStatus === download) &&
      (type === 'all' || item.classification === type);
  });
}

function render() {
  const visible = filteredTabs();
  const byGroup = new Map();
  for (const item of visible) {
    if (!byGroup.has(item.groupKey)) byGroup.set(item.groupKey, []);
    byGroup.get(item.groupKey).push(item);
  }
  $('groups').replaceChildren();
  for (const items of byGroup.values()) {
    const groupNode = $('groupTemplate').content.cloneNode(true);
    const section = groupNode.querySelector('.group-card');
    const heading = groupNode.querySelector('.group-heading');
    const group = items[0].group;
    groupNode.querySelector('.color-dot').dataset.color = group.color;
    groupNode.querySelector('.color-dot').style.backgroundColor = ({grey:'#909892', blue:'#4d83c4', red:'#c95b55', yellow:'#d5a632', green:'#4b956f', pink:'#ca6f9c', purple:'#886fc4', cyan:'#4e9da5', orange:'#ce7f39'})[group.color] || '#909892';
    groupNode.querySelector('.group-title').textContent = group.title;
    groupNode.querySelector('.group-meta').textContent = `Window ${group.windowId} · ${items.length} tab${items.length === 1 ? '' : 's'}`;
    heading.addEventListener('click', () => heading.setAttribute('aria-expanded', String(heading.getAttribute('aria-expanded') !== 'true')));
    const grid = groupNode.querySelector('.tab-grid');
    for (const item of items) {
      const tabNode = $('tabTemplate').content.cloneNode(true);
      const card = tabNode.querySelector('.tab-card');
      card.dataset.tabId = item.tabId;
      const favicon = tabNode.querySelector('.favicon');
      favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=32`;
      favicon.addEventListener('error', () => { favicon.hidden = true; }, {once: true});
      tabNode.querySelector('.type-chip').textContent = item.info?.kind || item.classification;
      const status = tabNode.querySelector('.download-chip');
      status.textContent = item.downloadStatus === 'downloaded' ? 'Downloaded' : 'Not downloaded';
      status.classList.add(item.downloadStatus);
      const link = tabNode.querySelector('.tab-title');
      link.href = item.url;
      link.textContent = item.title;
      link.title = item.title;
      tabNode.querySelector('.domain').textContent = domainFor(item.url);
      tabNode.querySelector('.description').textContent = descriptions.get(item.tabId) || fallbackDescription(item);
      tabNode.querySelector('.close-one').addEventListener('click', async () => {
        if (!confirm(`Close “${item.title}”?`)) return;
        try {
          await runAction('closeDashboardTabs', {tabIds: [item.tabId]});
          await loadTabs('Tab closed.');
        } catch (error) { $('status').textContent = `Error: ${error.message}`; }
      });
      grid.append(tabNode);
    }
    $('groups').append(section);
  }
  $('empty').hidden = visible.length > 0;
  if (operationBusy) for (const button of document.querySelectorAll('button')) button.disabled = true;
}

function setBusy(busy) {
  operationBusy = busy;
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
}

async function runAction(action, details = {}) {
  const response = await chrome.runtime.sendMessage({action, ...details});
  if (!response?.ok) throw new Error(response?.error || 'The extension could not complete that action.');
  return response.result;
}

async function loadTabs(message = '') {
  setBusy(true);
  try {
    tabs = await runAction('getDashboardTabs');
    const groups = new Set(tabs.map(item => item.groupKey));
    const downloaded = tabs.filter(item => item.downloadStatus === 'downloaded').length;
    $('tabCount').textContent = tabs.length;
    $('groupCount').textContent = groups.size;
    $('downloadedCount').textContent = downloaded;
    $('pendingCount').textContent = tabs.length - downloaded;
    $('status').textContent = message || `Collected ${tabs.length} web tab${tabs.length === 1 ? '' : 's'} from every open window.`;
    render();
  } catch (error) {
    $('status').textContent = `Error: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

async function createDescriptions() {
  setBusy(true);
  $('status').textContent = 'Creating short descriptions…';
  try {
    if (!globalThis.LanguageModel) {
      for (const item of tabs) descriptions.set(item.tabId, fallbackDescription(item));
      $('status').textContent = 'Chrome on-device AI is unavailable, so local descriptions are shown.';
      render();
      return;
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') throw new Error('Chrome on-device AI is unavailable.');
    const session = await LanguageModel.create({
      initialPrompts: [{role: 'system', content: 'Write one factual sentence of at most 18 words describing a browser link. Use only the supplied title, domain, and category. Do not invent details.'}]
    });
    for (let index = 0; index < tabs.length; index++) {
      const item = tabs[index];
      $('status').textContent = `Creating description ${index + 1} of ${tabs.length}…`;
      const result = await session.prompt(`Title: ${item.title}\nDomain: ${domainFor(item.url)}\nCategory: ${item.info?.kind || item.classification}`);
      descriptions.set(item.tabId, result.trim());
      if (index % 4 === 0) render();
    }
    session.destroy();
    $('status').textContent = `Created ${tabs.length} short descriptions with Chrome on-device AI.`;
    render();
  } catch (error) {
    for (const item of tabs) if (!descriptions.has(item.tabId)) descriptions.set(item.tabId, fallbackDescription(item));
    $('status').textContent = `${error.message} Local descriptions are shown instead.`;
    render();
  } finally {
    setBusy(false);
  }
}

$('refresh').addEventListener('click', () => loadTabs());
$('describe').addEventListener('click', createDescriptions);
$('organize').addEventListener('click', async () => {
  if (!tabs.length) return;
  if (!confirm(`Move ${tabs.length} collected tabs into a new window and recreate their groups?`)) return;
  setBusy(true);
  try {
    const result = await runAction('organizeTabs', {tabIds: tabs.map(item => item.tabId)});
    $('status').textContent = `Organized ${result.organized} tabs in the new window.`;
  } catch (error) { $('status').textContent = `Error: ${error.message}`; }
  finally { setBusy(false); }
});
$('closeAll').addEventListener('click', async () => {
  if (!tabs.length) return;
  if (!confirm(`Close all ${tabs.length} collected tabs? This cannot be undone.`)) return;
  setBusy(true);
  try {
    const result = await runAction('closeDashboardTabs', {tabIds: tabs.map(item => item.tabId)});
    await loadTabs(`Closed ${result.closed} tabs.`);
  } catch (error) { $('status').textContent = `Error: ${error.message}`; setBusy(false); }
});
for (const control of [$('search'), $('downloadFilter'), $('typeFilter')]) control.addEventListener('input', render);
function scheduleReload() {
  if (operationBusy) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadTabs(), 180);
}
chrome.tabs.onCreated.addListener(scheduleReload);
chrome.tabs.onRemoved.addListener(scheduleReload);
chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url || change.title) scheduleReload(); });
chrome.tabs.onMoved.addListener(scheduleReload);
loadTabs();
