const $ = id => document.getElementById(id);
const STATE_KEY = 'paperSweeperState';
let currentState = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function render(state = {}) {
  currentState = state;
  $('status').textContent = state.message || 'Ready to scan your bookmarks.';
  const busy = state.status === 'scanning' || state.status === 'downloading';
  $('scan').disabled = busy;
  $('group').disabled = busy;
  $('includeTabs').disabled = busy;
  $('tabGroup').disabled = busy || !$('includeTabs').checked;
  $('scan').textContent = state.status === 'scanning' ? 'Scanning…' : 'Scan selected group';
  if (state.folderId !== undefined) $('group').value = state.folderId || '';
  if (state.includeOpenTabs !== undefined) $('includeTabs').checked = state.includeOpenTabs;
  if (state.tabGroupId !== undefined) $('tabGroup').value = state.tabGroupId === null ? '' : String(state.tabGroupId);
  $('tabGroup').disabled = busy || !$('includeTabs').checked;
  if (!state.papers) return;
  $('summary').hidden = false;
  const downloads = new Set(state.papers.filter(p => p.info.pdfUrl).map(p => p.info.pdfUrl)).size;
  const technicalPages = state.technicalPages || [];
  const duplicateCount = (state.duplicateGroups || []).reduce((sum, group) => sum + group.remove.length, 0);
  $('paperCount').textContent = state.papers.length;
  $('technicalCount').textContent = technicalPages.length;
  $('pdfCount').textContent = downloads;
  $('duplicateCount').textContent = duplicateCount;
  $('detectedBadge').textContent = state.papers.length;
  $('duplicateBadge').textContent = duplicateCount;
  $('download').disabled = busy || downloads === 0;
  $('download').textContent = state.status === 'downloading' ? 'Downloading…' : `Download ${downloads} PDF${downloads === 1 ? '' : 's'}`;
  $('remove').disabled = busy || duplicateCount === 0;
  $('remove').textContent = `Remove ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'}`;
  $('papers').innerHTML = state.papers.map(p => `<li><span class="tag">${escapeHtml(p.info.kind)}</span>${p.source === 'tab' ? '<span class="tag">Open tab</span>' : ''}${p.info.pdfUrl ? '<span class="tag">PDF ready</span>' : ''}<a href="${escapeHtml(p.url)}" target="_blank" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</a><small><b>Listed in:</b> ${escapeHtml(p.folder)}</small></li>`).join('') || '<li>No papers detected.</li>';
  $('technicalBadge').textContent = technicalPages.length;
  $('technicalPages').innerHTML = technicalPages.map(p => `<li><span class=\"tag\">${escapeHtml(p.info.kind)}</span>${p.source === 'tab' ? '<span class="tag">Open tab</span>' : ''}<a href=\"${escapeHtml(p.url)}\" target=\"_blank\" title=\"${escapeHtml(p.title)}\">${escapeHtml(p.title)}</a><small><b>Listed in:</b> ${escapeHtml(p.folder)}</small></li>`).join('') || '<li>No technical pages detected.</li>';
  $('technicalDetails').hidden = technicalPages.length === 0;
  $('duplicates').innerHTML = (state.duplicateGroups || []).map(g => `<li><b>${escapeHtml(g.keep.title)}</b><small>Keep: ${escapeHtml(g.keep.folder)}</small><small>Remove ${g.remove.length}: ${escapeHtml(g.remove.map(x => x.folder).join(', '))}</small></li>`).join('') || '<li>No duplicate bookmarks.</li>';
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
  const groups = await chrome.tabGroups.query({});
  groups.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  $('tabGroup').insertAdjacentHTML('beforeend', groups.map(group => `<option value=\"${group.id}\">${escapeHtml(group.title || 'Unnamed tab group')} (Window ${group.windowId})</option>`).join(''));
  if (currentState?.tabGroupId !== undefined && currentState.tabGroupId !== null) $('tabGroup').value = String(currentState.tabGroupId);
}

$('includeTabs').addEventListener('change', () => {
  $('tabGroup').disabled = !$('includeTabs').checked;
});

$('scan').addEventListener('click', () => {
  const option = $('group').selectedOptions[0];
  const tabGroupValue = $('tabGroup').value;
  action('scan', {folderId: option.value || null, folderName: option.textContent, includeOpenTabs: $('includeTabs').checked, tabGroupId: tabGroupValue === '' ? null : Number(tabGroupValue)});
});
$('download').addEventListener('click', () => action('downloadPdfs'));
$('remove').addEventListener('click', () => {
  const count = (currentState?.duplicateGroups || []).reduce((sum, group) => sum + group.remove.length, 0);
  if (count && confirm(`Remove ${count} duplicate bookmark${count === 1 ? '' : 's'}? The first copy of each URL will be kept.`)) action('removeDuplicates');
});
chrome.storage.onChanged.addListener(changes => { if (changes[STATE_KEY]) render(changes[STATE_KEY].newValue); });
chrome.storage.local.get(STATE_KEY).then(stored => render(stored[STATE_KEY]));
Promise.all([loadGroups(), loadTabGroups()]).catch(error => { $('status').textContent = `Could not load groups: ${error.message}`; });
