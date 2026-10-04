const $ = id => document.getElementById(id);
let tabs = [];
let availableGroups = [];
let descriptions = new Map();
let selectedTabIds = new Set();
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

function updateSelectionControls() {
  const count = selectedTabIds.size;
  const target = $('groupTarget').value;
  const missingNewGroupName = target === 'new' && !$('newGroupName').value.trim();
  $('selectedCount').textContent = count;
  $('clearSelection').disabled = operationBusy || count === 0;
  $('ungroupAll').disabled = operationBusy || availableGroups.length === 0;
  $('applyGroup').disabled = operationBusy || count === 0 || !target || missingNewGroupName;
  $('categorize').disabled = operationBusy || count === 0;
}

function populateGroupTargets() {
  const current = $('groupTarget').value;
  $('groupTarget').querySelectorAll('optgroup').forEach(node => node.remove());
  const groupsByWindow = new Map();
  for (const group of availableGroups) {
    if (!groupsByWindow.has(group.windowId)) groupsByWindow.set(group.windowId, new Map());
    groupsByWindow.get(group.windowId).set(group.id, group);
  }
  for (const [windowId, groups] of [...groupsByWindow].sort((a, b) => a[0] - b[0])) {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = `Existing groups · Window ${windowId}`;
    for (const group of [...groups.values()].sort((a, b) => a.title.localeCompare(b.title))) {
      const option = document.createElement('option');
      option.value = `group:${group.id}`;
      option.textContent = group.title;
      optionGroup.append(option);
    }
    $('groupTarget').append(optionGroup);
  }
  if ([...$('groupTarget').options].some(option => option.value === current)) $('groupTarget').value = current;
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
    const groupTabIds = tabs.filter(item => item.groupKey === items[0].groupKey).map(item => item.tabId);
    const selectGroup = groupNode.querySelector('.select-group');
    const wholeGroupSelected = groupTabIds.every(id => selectedTabIds.has(id));
    selectGroup.textContent = wholeGroupSelected ? 'Clear group selection' : 'Select group';
    selectGroup.addEventListener('click', () => {
      for (const id of groupTabIds) {
        if (wholeGroupSelected) selectedTabIds.delete(id);
        else selectedTabIds.add(id);
      }
      render();
    });
    const grid = groupNode.querySelector('.tab-grid');
    for (const item of items) {
      const tabNode = $('tabTemplate').content.cloneNode(true);
      const card = tabNode.querySelector('.tab-card');
      card.dataset.tabId = item.tabId;
      const checkbox = tabNode.querySelector('.tab-select');
      checkbox.checked = selectedTabIds.has(item.tabId);
      checkbox.setAttribute('aria-label', `Select ${item.title} for regrouping`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedTabIds.add(item.tabId);
        else selectedTabIds.delete(item.tabId);
        updateSelectionControls();
      });
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
  if (operationBusy) {
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    for (const checkbox of document.querySelectorAll('.tab-select')) checkbox.disabled = true;
  }
  updateSelectionControls();
}

function setBusy(busy) {
  operationBusy = busy;
  for (const button of document.querySelectorAll('button')) button.disabled = busy;
  for (const control of [$('groupTarget'), $('newGroupName'), $('newGroupColor'), ...document.querySelectorAll('.tab-select')]) control.disabled = busy;
  updateSelectionControls();
}

async function runAction(action, details = {}) {
  const response = await chrome.runtime.sendMessage({action, ...details});
  if (!response?.ok) throw new Error(response?.error || 'The extension could not complete that action.');
  return response.result;
}

async function loadTabs(message = '') {
  setBusy(true);
  try {
    [tabs, availableGroups] = await Promise.all([
      runAction('getDashboardTabs'),
      runAction('getTabGroups')
    ]);
    const openIds = new Set(tabs.map(item => item.tabId));
    selectedTabIds = new Set([...selectedTabIds].filter(id => openIds.has(id)));
    populateGroupTargets();
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
    const languageOptions = {
      expectedInputs: [{type: 'text', languages: ['en']}],
      expectedOutputs: [{type: 'text', languages: ['en']}]
    };
    const availability = await LanguageModel.availability(languageOptions);
    if (availability === 'unavailable') throw new Error('Chrome on-device AI is unavailable.');
    const session = await LanguageModel.create({
      ...languageOptions,
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
$('selectVisible').addEventListener('click', () => {
  for (const item of filteredTabs()) selectedTabIds.add(item.tabId);
  render();
});
$('clearSelection').addEventListener('click', () => {
  selectedTabIds.clear();
  render();
});
$('ungroupAll').addEventListener('click', async () => {
  const groupedCount = tabs.filter(item => item.group.id !== null).length;
  if (!availableGroups.length) {
    $('status').textContent = 'There are no tab groups to remove.';
    return;
  }
  const scope = groupedCount ? `${groupedCount} collected grouped tab${groupedCount === 1 ? '' : 's'}` : 'all grouped tabs';
  if (!confirm(`Remove all Chrome tab groups across every open window? This will ungroup ${scope}, but will not close any tabs.`)) return;
  setBusy(true);
  try {
    const result = await runAction('ungroupAllTabs');
    selectedTabIds.clear();
    await loadTabs(`Removed all groups from ${result.updated} tab${result.updated === 1 ? '' : 's'}. Select tabs below to build new groups.`);
  } catch (error) {
    $('status').textContent = `Error: ${error.message}`;
    setBusy(false);
  }
});
$('groupTarget').addEventListener('change', () => {
  const creating = $('groupTarget').value === 'new';
  $('newGroupName').hidden = !creating;
  $('newGroupColor').hidden = !creating;
  updateSelectionControls();
  if (creating) $('newGroupName').focus();
});
$('newGroupName').addEventListener('input', updateSelectionControls);
$('newGroupName').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !$('applyGroup').disabled) $('applyGroup').click();
});
$('applyGroup').addEventListener('click', async () => {
  if (!selectedTabIds.size || !$('groupTarget').value) return;
  setBusy(true);
  try {
    const result = await runAction('regroupTabs', {
      tabIds: [...selectedTabIds],
      target: $('groupTarget').value,
      name: $('newGroupName').value,
      color: $('newGroupColor').value
    });
    const message = `Updated ${result.updated} tab${result.updated === 1 ? '' : 's'}${result.groupsCreated ? ` in ${result.groupsCreated} new group${result.groupsCreated === 1 ? '' : 's'}` : ''}.`;
    selectedTabIds.clear();
    await loadTabs(message);
  } catch (error) {
    $('status').textContent = `Error: ${error.message}`;
    setBusy(false);
  }
});
$('categorize').addEventListener('click', async () => {
  if (!selectedTabIds.size) return;
  setBusy(true);
  try {
    const result = await runAction('categorizeTabs', {tabIds: [...selectedTabIds]});
    selectedTabIds.clear();
    const skipped = result.skippedPinned ? ` ${result.skippedPinned} pinned tab${result.skippedPinned === 1 ? ' was' : 's were'} left unchanged.` : '';
    await loadTabs(`Grouped ${result.updated} tab${result.updated === 1 ? '' : 's'} into ${result.groupsCreated} categor${result.groupsCreated === 1 ? 'y' : 'ies'}.${skipped}`);
  } catch (error) {
    $('status').textContent = `Error: ${error.message}`;
    setBusy(false);
  }
});
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
chrome.tabs.onAttached.addListener(scheduleReload);
chrome.tabs.onDetached.addListener(scheduleReload);
chrome.tabGroups.onCreated.addListener(scheduleReload);
chrome.tabGroups.onMoved.addListener(scheduleReload);
chrome.tabGroups.onRemoved.addListener(scheduleReload);
chrome.tabGroups.onUpdated.addListener(scheduleReload);
loadTabs();
