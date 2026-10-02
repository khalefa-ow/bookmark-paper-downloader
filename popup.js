const $ = id => document.getElementById(id);
const STATE_KEY = 'paperSweeperState';
let currentState = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function formatAddedDate(item) {
  const timestamp = item.dateAdded || item.addedToScanAt;
  if (!timestamp) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(timestamp));
}

function resultItem(item, pdfReady = false) {
  const sourceLabel = item.source === 'tab' ? (item.tabGroupId === -1 ? 'Open tab' : 'Grouped tab') : 'Bookmark';
  const dateLabel = item.dateAdded ? 'Added' : 'Added to scan';
  return `<li><span class="tag">${escapeHtml(item.info?.kind || item.classification)}</span><span class="tag">${sourceLabel}</span>${pdfReady ? '<span class="tag">PDF ready</span>' : ''}<a href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a><small><b>Listed in:</b> ${escapeHtml(item.folder)}</small><small><b>${dateLabel}:</b> ${escapeHtml(formatAddedDate(item))}</small></li>`;
}

function reportItem(item) {
  const kind = item.info?.kind || 'No match';
  return `<li><span class="tag">${escapeHtml(item.classification)}</span><span class="tag">${escapeHtml(kind)}</span><a href="${escapeHtml(item.url)}" target="_blank" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a><small><b>Decision:</b> ${escapeHtml(item.reason)}</small><small><b>Source:</b> ${escapeHtml(item.folder)}</small></li>`;
}

function renderResultSection(detailsId, badgeId, listId, items, renderer, emptyText) {
  $(badgeId).textContent = items.length;
  $(listId).innerHTML = items.map(renderer).join('') || `<li>${emptyText}</li>`;
  if (detailsId) $(detailsId).hidden = items.length === 0;
}

function syncSourceControls(busy = false) {
  $('group').disabled = busy || !$('includeBookmarks').checked;
  $('tabGroup').disabled = busy || !$('includeTabGroups').checked;
}

function render(state = {}) {
  currentState = state;
  $('status').textContent = state.message || 'Ready to scan your pages.';
  const busy = state.status === 'scanning' || state.status === 'downloading';
  $('scan').disabled = busy;
  $('includeBookmarks').disabled = busy;
  $('includeTabGroups').disabled = busy;
  $('includeOpenTabs').disabled = busy;
  $('scan').textContent = state.status === 'scanning' ? 'Scanning…' : 'Scan selected pages';
  if (state.folderId !== undefined) $('group').value = state.folderId || '';
  if (state.includeBookmarks !== undefined) $('includeBookmarks').checked = state.includeBookmarks;
  if (state.includeTabGroups !== undefined) $('includeTabGroups').checked = state.includeTabGroups;
  if (state.includeOpenTabs !== undefined) $('includeOpenTabs').checked = state.includeOpenTabs;
  if (state.tabGroupId !== undefined) $('tabGroup').value = state.tabGroupId === null ? '' : String(state.tabGroupId);
  syncSourceControls(busy);
  if (!state.papers) return;
  $('summary').hidden = false;
  const downloads = new Set(state.papers.filter(p => p.info.pdfUrl).map(p => p.info.pdfUrl)).size;
  const technicalPages = state.technicalPages || [];
  const otherPages = state.otherPages || [];
  const duplicateCount = (state.duplicateGroups || []).reduce((sum, group) => sum + group.remove.length, 0);
  $('paperCount').textContent = state.papers.length;
  $('otherCount').textContent = otherPages.length;
  $('technicalCount').textContent = technicalPages.length;
  $('pdfCount').textContent = downloads;
  $('duplicateCount').textContent = duplicateCount;
  $('detectedBadge').textContent = state.papers.length;
  $('duplicateBadge').textContent = duplicateCount;
  $('download').disabled = busy || downloads === 0;
  $('download').textContent = state.status === 'downloading' ? 'Downloading…' : `Download ${downloads} PDF${downloads === 1 ? '' : 's'}`;
  $('remove').disabled = busy || duplicateCount === 0;
  $('remove').textContent = `Remove ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}`;
  const exportCount = (state.linkReport || [...(state.papers || []), ...(state.technicalPages || [])]).length;
  $('exportJson').disabled = busy || exportCount === 0;
  $('exportJson').textContent = 'Export classification JSON';
  renderResultSection(null, 'detectedBadge', 'papers', state.papers, item => resultItem(item, Boolean(item.info.pdfUrl)), 'No papers detected.');
  renderResultSection('technicalDetails', 'technicalBadge', 'technicalPages', technicalPages, resultItem, 'No technical pages detected.');
  renderResultSection('otherDetails', 'otherBadge', 'otherPages', otherPages, resultItem, 'No other pages.');
  renderResultSection(null, 'reportBadge', 'linkReport', state.linkReport || [], reportItem, 'No links were scanned.');

  const duplicateGroups = state.duplicateGroups || [];
  $('duplicates').innerHTML = duplicateGroups.map(group => `<li><b>${escapeHtml(group.keep.title)}</b><small>Keep: ${escapeHtml(group.keep.folder)}</small><small>Remove ${group.remove.length}: ${escapeHtml(group.remove.map(item => item.folder).join(', '))}</small></li>`).join('') || '<li>No duplicate bookmarks.</li>';
  $('duplicateDetails').hidden = duplicateCount === 0;
  const errors = state.failed || [];
  $('errors').hidden = errors.length === 0;
  $('errors').textContent = errors.length ? `Could not process:\n${errors.join('\n')}` : '';
}

async function action(name, details = {}) {
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({action: name, ...details});
    if (!response?.ok) throw new Error(response?.error || 'Unknown extension error');
  } catch (error) {
    render({...currentState, status: 'ready', message: `Error: ${error.message}`});
  } finally {
    const stored = await chrome.storage.local.get(STATE_KEY);
    render(stored[STATE_KEY]);
  }
}

async function loadGroups() {
  const tree = await chrome.bookmarks.getTree();
  const groups = [];
  const walk = (nodes, parents = []) => {
    for (const node of nodes) {
      if (!node.children) continue;
      const path = node.id === '0' ? parents : [...parents, node.title || 'Unnamed group'];
      if (node.id !== '0') groups.push({id: node.id, path: path.join(' / ')});
      walk(node.children, path);
    }
  };
  walk(tree);
  $('group').insertAdjacentHTML('beforeend', groups.map(group => `<option value=\"${escapeHtml(group.id)}\">${escapeHtml(group.path)}</option>`).join(''));
  if (currentState?.folderId) $('group').value = currentState.folderId;
}

async function loadTabGroups() {
  const response = await chrome.runtime.sendMessage({action: 'getTabGroups'});
  if (!response?.ok) throw new Error(response?.error || 'Could not load tab groups.');

  const groups = response.result || [];
  $('tabGroup').insertAdjacentHTML('beforeend', groups.map(group =>
    `<option value="${group.id}">${escapeHtml(group.title || 'Unnamed tab group')} (Window ${group.windowId}, ${group.tabCount} tabs)</option>`
  ).join(''));

  if (currentState?.tabGroupId !== undefined && currentState.tabGroupId !== null) {
    $('tabGroup').value = String(currentState.tabGroupId);
  }
}

$('includeBookmarks').addEventListener('change', () => syncSourceControls());
$('includeTabGroups').addEventListener('change', () => syncSourceControls());
$('openDashboard').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('dashboard.html')}));

$('scan').addEventListener('click', () => {
  const includeBookmarks = $('includeBookmarks').checked;
  const includeTabGroups = $('includeTabGroups').checked;
  const includeOpenTabs = $('includeOpenTabs').checked;
  if (!includeBookmarks && !includeTabGroups && !includeOpenTabs) {
    render({...currentState, status: 'ready', message: 'Choose at least one page source to scan.'});
    return;
  }
  const option = $('group').selectedOptions[0];
  const tabGroupValue = $('tabGroup').value;
  action('scan', {folderId: option.value || null, folderName: option.textContent, includeBookmarks, includeTabGroups, includeOpenTabs, tabGroupId: tabGroupValue === '' ? null : Number(tabGroupValue)});
});
$('download').addEventListener('click', () => action('downloadPdfs'));
$('exportJson').addEventListener('click', () => action('exportUniqueUrls'));
$('remove').addEventListener('click', () => {
  const count = (currentState?.duplicateGroups || []).reduce((sum, group) => sum + group.remove.length, 0);
  if (count && confirm(`Remove ${count} duplicate bookmark${count === 1 ? '' : 's'}? The first copy of each URL will be kept.`)) action('removeDuplicates');
});
chrome.storage.onChanged.addListener(changes => { if (changes[STATE_KEY]) render(changes[STATE_KEY].newValue); });
chrome.storage.local.get(STATE_KEY).then(stored => render(stored[STATE_KEY]));
Promise.all([loadGroups(), loadTabGroups()]).catch(error => { $('status').textContent = `Could not load groups: ${error.message}`; });
