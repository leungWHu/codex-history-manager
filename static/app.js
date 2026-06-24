const listEl = document.querySelector('#sessions');
const mainEl = document.querySelector('#main');
const queryEl = document.querySelector('#query');
const countEl = document.querySelector('#count');
const langToggleEl = document.querySelector('#lang-toggle');
const themeToggleEl = document.querySelector('#theme-toggle');
let selectedId = '';
let timer;
let renderedGroups = new Map();
let lastSessions = [];

const savedTheme = localStorage.getItem('codex-history-theme');
const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
let theme = savedTheme || preferredTheme;
const savedLanguage = localStorage.getItem('codex-history-language');
let language = savedLanguage || 'zh';

const i18n = {
  zh: {
    locale: 'zh-CN',
    langButton: 'EN',
    switchLanguage: 'Switch to English',
    themeLight: '切换到浅色主题',
    themeDark: '切换到深色主题',
    searchPlaceholder: '搜索会话、目录…',
    loadingSessions: '正在读取本地会话…',
    emptyTitle: '本地会话档案',
    emptyBody: '从左侧选择一段对话。数据仅由本机 Python 服务读取。',
    noMatches: '没有找到匹配的会话',
    readFailed: '读取失败：{message}',
    oldBackend: '后台服务版本过旧，请在终端按 Ctrl+C 后重新运行 python server.py',
    unknown: '未知',
    uncategorizedProject: '未归类项目',
    temporaryProject: '临时会话',
    temporaryPath: '未指定项目的对话',
    archivedProject: '归档会话',
    archivedPath: '已归档的 Codex 历史会话',
    updatedAt: '更新于 {time}',
    messages: '{count} 条消息',
    user: '你',
    finalReply: '最终回复',
    legacyReply: '历史回复',
    progress: '处理过程',
    steps: '{count} 条',
    step: '步骤 {index}',
    copySessionPath: '复制会话文件路径',
    deleteSession: '删除会话',
    deleteGroup: '删除整个分组的会话',
    arranging: '正在整理对话…',
    sessionNotFound: '会话不存在或已移动',
    createdAt: '创建时间',
    updatedAtLabel: '更新时间',
    project: '项目',
    workPathCopy: '工作路径 · 点击复制',
    historyPathCopy: '会话记录文件 · 点击复制',
    fileAvailable: '文件存在',
    fileMissing: '路径失效',
    unknownDirectory: '未知目录',
    noSessionPath: '未能从会话索引定位文件',
    noVisibleMessages: '这段会话没有可展示的用户或助手消息',
    cannotOpen: '无法打开',
    pathCopied: '本地路径已复制',
    noCopyPath: '没有可复制的会话路径',
    copyFailed: '复制失败，请检查浏览器权限',
    deletePlanFailed: '无法生成安全删除计划',
    deleteFailed: '删除失败',
    httpReturned: '服务返回了 HTTP {status}',
    deletedTitle: '会话已删除',
    deletedBody: '请从左侧选择另一段对话。',
    sessionDeleted: '会话已完整删除（清理 {count} 条关联记录）',
    deleteDialogTitle: '永久删除会话',
    copyShortIdLabel: '复制此短 ID',
    confirmShortIdLabel: '输入或粘贴短 ID 以确认',
    copy: '复制',
    cancel: '取消',
    permanentDelete: '永久删除',
    deleteSummary: '“{title}”将清理 {rows} 条 SQLite 记录、{files} 个会话文件，并重写 Codex 索引与全局状态。此操作无法撤销。',
    shortIdCopied: '短 ID 已复制',
    groupPlanOutdated: '后台服务版本过旧：请在终端按 Ctrl+C，然后重新运行 python server.py',
    groupPlanFailed: '无法生成分组删除计划',
    groupDeleteFailed: '分组删除失败',
    groupDeletedTitle: '分组会话已删除',
    groupDeletedBody: '实际工作目录及其中的文件未受影响。',
    groupDeleted: '已删除 {count} 个会话，工作目录未修改',
    groupDeleteSummary: '“{label}”中的 {sessions} 个会话将被永久删除；预计清理 {rows} 条 SQLite 记录、{files} 个 Codex 会话文件。实际工作目录及其中的项目文件不会被删除或修改。',
    confirmTextCopied: '确认文本已复制',
    deleteCodeLabel: '复制此短 ID',
    groupCodeLabel: '复制确认文本',
    groupConfirmLabel: '输入或粘贴确认文本以继续',
  },
  en: {
    locale: 'en-US',
    langButton: '中',
    switchLanguage: '切换到中文',
    themeLight: 'Switch to light theme',
    themeDark: 'Switch to dark theme',
    searchPlaceholder: 'Search sessions, folders…',
    loadingSessions: 'Reading local sessions…',
    emptyTitle: 'Local Session Archive',
    emptyBody: 'Choose a conversation from the left. Data is read only by the local Python service.',
    noMatches: 'No matching sessions found',
    readFailed: 'Failed to read: {message}',
    oldBackend: 'Backend is outdated. Press Ctrl+C in the terminal, then run python server.py again.',
    unknown: 'Unknown',
    uncategorizedProject: 'Uncategorized project',
    temporaryProject: 'Temporary sessions',
    temporaryPath: 'Conversations without a selected project',
    archivedProject: 'Archived sessions',
    archivedPath: 'Archived Codex history sessions',
    updatedAt: 'Updated {time}',
    messages: '{count} messages',
    user: 'You',
    finalReply: 'Final reply',
    legacyReply: 'History reply',
    progress: 'Process',
    steps: '{count} items',
    step: 'Step {index}',
    copySessionPath: 'Copy session file path',
    deleteSession: 'Delete session',
    deleteGroup: 'Delete all sessions in this group',
    arranging: 'Preparing conversation…',
    sessionNotFound: 'Session does not exist or was moved',
    createdAt: 'Created',
    updatedAtLabel: 'Updated',
    project: 'Project',
    workPathCopy: 'Work path · click to copy',
    historyPathCopy: 'Session record · click to copy',
    fileAvailable: 'File exists',
    fileMissing: 'Missing path',
    unknownDirectory: 'Unknown directory',
    noSessionPath: 'Could not locate the session file from the index',
    noVisibleMessages: 'This session has no displayable user or assistant messages',
    cannotOpen: 'Cannot open',
    pathCopied: 'Local path copied',
    noCopyPath: 'No session path to copy',
    copyFailed: 'Copy failed. Check browser permissions.',
    deletePlanFailed: 'Could not generate a safe deletion plan',
    deleteFailed: 'Deletion failed',
    httpReturned: 'Server returned HTTP {status}',
    deletedTitle: 'Session deleted',
    deletedBody: 'Choose another conversation from the left.',
    sessionDeleted: 'Session fully deleted ({count} related records cleaned)',
    deleteDialogTitle: 'Permanently delete session',
    copyShortIdLabel: 'Copy this short ID',
    confirmShortIdLabel: 'Enter or paste the short ID to confirm',
    copy: 'Copy',
    cancel: 'Cancel',
    permanentDelete: 'Permanently delete',
    deleteSummary: '“{title}” will clean {rows} SQLite records, {files} session files, and rewrite Codex indexes and global state. This cannot be undone.',
    shortIdCopied: 'Short ID copied',
    groupPlanOutdated: 'Backend is outdated. Press Ctrl+C in the terminal, then run python server.py again.',
    groupPlanFailed: 'Could not generate a group deletion plan',
    groupDeleteFailed: 'Group deletion failed',
    groupDeletedTitle: 'Group sessions deleted',
    groupDeletedBody: 'The actual working directory and project files were not modified.',
    groupDeleted: 'Deleted {count} sessions. Working directories were not modified.',
    groupDeleteSummary: '{sessions} sessions in “{label}” will be permanently deleted. Expected cleanup: {rows} SQLite records and {files} Codex session files. The actual working directory and project files will not be deleted or modified.',
    confirmTextCopied: 'Confirmation text copied',
    deleteCodeLabel: 'Copy this short ID',
    groupCodeLabel: 'Copy confirmation text',
    groupConfirmLabel: 'Enter or paste the confirmation text to continue',
  },
};

const text = (key, params = {}) => {
  const template = i18n[language][key] || i18n.zh[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
};

function applyTheme(nextTheme) {
  theme = nextTheme;
  document.documentElement.dataset.theme = theme;
  const button = themeToggleEl;
  if (button) {
    button.querySelector('.theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
    button.title = theme === 'dark' ? text('themeLight') : text('themeDark');
    button.setAttribute('aria-label', button.title);
  }
}

const escapeHtml = (value = '') => String(value).replace(
  /[&<>'"]/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char],
);

const dateText = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(i18n[language].locale, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(date);
};

const fullDateText = value => {
  if (!value) return text('unknown');
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(i18n[language].locale, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(date);
};

const projectName = cwd => {
  if (!cwd) return text('uncategorizedProject');
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.at(-1) || cwd;
};

function renderEmptyState(title = text('emptyTitle'), body = text('emptyBody'), busy = false) {
  mainEl.innerHTML = `
    <div class="empty">
      ${busy ? '<div class="spinner"></div>' : '<div class="orb">C</div>'}
      ${title ? `<h1>${escapeHtml(title)}</h1>` : ''}
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
    </div>`;
}

function applyLanguage(nextLanguage) {
  language = nextLanguage;
  localStorage.setItem('codex-history-language', language);
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  langToggleEl.textContent = text('langButton');
  langToggleEl.title = text('switchLanguage');
  langToggleEl.setAttribute('aria-label', text('switchLanguage'));
  queryEl.placeholder = text('searchPlaceholder');
  document.querySelector('#delete-dialog-title').textContent = text('deleteDialogTitle');
  document.querySelector('.dialog-close').setAttribute('aria-label', text('cancel'));
  document.querySelector('#copy-delete-id').textContent = text('copy');
  document.querySelector('.cancel-button').textContent = text('cancel');
  document.querySelector('#confirm-delete-button').textContent = text('permanentDelete');
  const warning = document.querySelector('.version-warning');
  if (warning) warning.textContent = text('oldBackend');
  applyTheme(theme);
  if (lastSessions.length) renderSessions(lastSessions);
  if (selectedId) {
    openSession(selectedId);
  } else {
    renderEmptyState();
  }
}

function renderMessage(message) {
  const isUser = message.role === 'user';
  const kindLabel = message.kind === 'final' ? text('finalReply') : text('legacyReply');
  return `
    <section class="message ${message.role} ${message.kind || 'legacy'}">
      <div class="avatar">${isUser ? text('user') : 'C'}</div>
      <div class="bubble">
        <div class="role">
          <span>${isUser ? text('user') : 'Codex'}</span>
          ${isUser ? '' : `<em class="message-kind">${kindLabel}</em>`}
          <time>${dateText(message.timestamp)}</time>
        </div>
        <div class="text">${escapeHtml(message.text)}</div>
      </div>
    </section>`;
}

function renderProcessGroup(messages) {
  if (!messages.length) return '';
  const firstTime = dateText(messages[0].timestamp);
  const lastTime = dateText(messages.at(-1).timestamp);
  const timeRange = firstTime === lastTime ? firstTime : `${firstTime} – ${lastTime}`;
  return `
    <section class="process-bundle">
      <div class="avatar">C</div>
      <details class="process-details">
        <summary>
          <span class="process-arrow">›</span>
          <strong>${text('progress')}</strong>
          <em>${text('steps', { count: messages.length })}</em>
          <time>${timeRange}</time>
        </summary>
        <div class="process-steps">
          ${messages.map((message, index) => `
            <div class="process-step">
              <div class="step-meta"><span>${text('step', { index: index + 1 })}</span><time>${dateText(message.timestamp)}</time></div>
              <div class="text">${escapeHtml(message.text)}</div>
            </div>`).join('')}
        </div>
      </details>
    </section>`;
}

function renderConversation(messages) {
  const output = [];
  let progress = [];
  const flushProgress = () => {
    if (progress.length) output.push(renderProcessGroup(progress));
    progress = [];
  };
  for (const message of messages) {
    if (message.role === 'assistant' && message.kind === 'progress') {
      progress.push(message);
      continue;
    }
    flushProgress();
    output.push(renderMessage(message));
  }
  flushProgress();
  return output.join('');
}

function renderSessions(sessions) {
  lastSessions = sessions;
  if (!sessions.length) {
    listEl.innerHTML = `<div class="hint">${text('noMatches')}</div>`;
    return;
  }

  const groups = new Map();
  for (const session of sessions) {
    const key = session.is_archived ? '__archived__' : (session.is_temporary ? '__temporary__' : (session.cwd || '__temporary__'));
    if (!groups.has(key)) {
      groups.set(key, {
        cwd: session.cwd,
        archived: Boolean(session.is_archived),
        temporary: !session.is_archived && session.is_temporary,
        items: [],
        latest: 0,
      });
    }
    const group = groups.get(key);
    group.items.push(session);
    group.latest = Math.max(group.latest, Date.parse(session.updated_at) || 0);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => {
    if (a.archived !== b.archived) return Number(a.archived) - Number(b.archived);
    if (a.temporary !== b.temporary) return Number(a.temporary) - Number(b.temporary);
    return b.latest - a.latest;
  });
  renderedGroups = new Map();
  listEl.innerHTML = orderedGroups.map((group, groupIndex) => {
    const groupKey = `group-${groupIndex}`;
    renderedGroups.set(groupKey, group);
    const { cwd, items, archived, temporary } = group;
    items.sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
    const path = archived ? text('archivedPath') : (temporary ? text('temporaryPath') : cwd);
    const label = archived ? text('archivedProject') : (temporary ? text('temporaryProject') : projectName(cwd));
    return `
      <details class="project ${temporary ? 'temporary-project' : ''} ${archived ? 'archived-project' : ''}" open>
        <summary>
          <span class="project-arrow">›</span>
          <span class="project-info">
            <strong>${escapeHtml(label)}</strong>
            <small title="${escapeHtml(path)}">${escapeHtml(path)} · ${text('updatedAt', { time: dateText(group.latest) })}</small>
          </span>
          <span class="project-count">${items.length}</span>
          <button class="group-delete-action" data-group-key="${groupKey}" title="${text('deleteGroup')}" aria-label="${text('deleteGroup')}">×</button>
        </summary>
        <div class="project-sessions">
          ${items.map(session => `
            <div class="session ${session.id === selectedId ? 'active' : ''}" data-id="${session.id}"
                 data-path="${escapeHtml(session.local_path)}" role="button" tabindex="0">
              <div class="session-body">
                <span class="title">${escapeHtml(session.title)}</span>
                <span class="meta">
                  <time>${dateText(session.updated_at)}</time>
                  <i>${text('messages', { count: session.message_count })}</i>
                </span>
              </div>
              <div class="session-actions">
                <button class="session-action copy-action" title="${text('copySessionPath')}" aria-label="${text('copySessionPath')}">⧉</button>
                <button class="session-action delete-action" title="${text('deleteSession')}" aria-label="${text('deleteSession')}">×</button>
              </div>
            </div>`).join('')}
        </div>
      </details>`;
  }).join('');
}

async function loadSessions() {
  listEl.classList.add('loading');
  try {
    const response = await fetch(`/api/sessions?q=${encodeURIComponent(queryEl.value)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { sessions } = await response.json();
    countEl.textContent = sessions.length;
    renderSessions(sessions);
  } catch (error) {
    listEl.innerHTML = `<div class="hint error">${escapeHtml(text('readFailed', { message: error.message }))}</div>`;
  } finally {
    listEl.classList.remove('loading');
  }
}

async function checkBackendVersion() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    if ((status.api_version || 0) >= 2) return;
    const warning = document.createElement('div');
    warning.className = 'version-warning';
    warning.textContent = text('oldBackend');
    listEl.before(warning);
  } catch {
    // The normal session request will surface connectivity errors.
  }
}

async function openSession(id) {
  selectedId = id;
  document.querySelectorAll('.session').forEach(element => {
    element.classList.toggle('active', element.dataset.id === id);
  });
  renderEmptyState('', text('arranging'), true);
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(text('sessionNotFound'));
    const session = await response.json();
    const currentProject = session.is_archived ? text('archivedProject') : (session.is_temporary ? text('temporaryProject') : projectName(session.cwd));
    mainEl.innerHTML = `
      <div class="conversation-head">
        <div class="head-title">
          <span class="eyebrow">${escapeHtml(currentProject)} · ${text('messages', { count: session.message_count })}</span>
          <h1>${escapeHtml(session.title)}</h1>
        </div>
        <div class="session-facts">
          <div class="fact"><span>${text('createdAt')}</span><strong>${fullDateText(session.created_at)}</strong></div>
          <div class="fact"><span>${text('updatedAtLabel')}</span><strong>${fullDateText(session.updated_at)}</strong></div>
          <div class="fact"><span>${text('project')}</span><strong>${escapeHtml(currentProject)}</strong></div>
          <button class="fact copyable-fact work-path-fact" data-copy-path="${escapeHtml(session.cwd)}" title="${text('workPathCopy')}">
            <span>${text('workPathCopy')}</span><strong>${escapeHtml(session.cwd || text('unknownDirectory'))}</strong><i>⧉</i>
          </button>
          <button class="fact copyable-fact history-path-fact" data-copy-path="${escapeHtml(session.local_path)}" title="${text('historyPathCopy')}">
            <span>${text('historyPathCopy')} <b class="path-state ${session.local_path_exists ? 'available' : 'missing'}">${session.local_path_exists ? text('fileAvailable') : text('fileMissing')}</b></span>
            <strong>${escapeHtml(session.local_path || text('noSessionPath'))}</strong><i>⧉</i>
          </button>
        </div>
      </div>
      <article>${session.messages.length ? renderConversation(session.messages) : `<div class="hint">${text('noVisibleMessages')}</div>`}</article>`;
    mainEl.scrollTop = 0;
  } catch (error) {
    renderEmptyState(text('cannotOpen'), error.message);
  }
}

function showToast(message, kind = '') {
  let toast = document.querySelector('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = `toast show ${kind}`;
  toast.textContent = message;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

async function copyPath(path, successMessage = text('pathCopied')) {
  if (!path) {
    showToast(text('noCopyPath'), 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(path);
    showToast(successMessage);
  } catch {
    const input = document.createElement('textarea');
    input.value = path;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    showToast(copied ? successMessage : text('copyFailed'), copied ? '' : 'error');
  }
}

async function deleteSession(item) {
  const title = item.querySelector('.title')?.textContent || text('deleteSession');
  const id = item.dataset.id;
  try {
    const planResponse = await fetch(`/api/sessions/${encodeURIComponent(id)}/delete-plan`);
    const plan = await planResponse.json().catch(() => ({ error: text('httpReturned', { status: planResponse.status }) }));
    if (!planResponse.ok) throw new Error(plan.error || text('deletePlanFailed'));
    const confirmation = await requestDeleteConfirmation(plan, title);
    if (confirmation === null) return;
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    });
    const result = await response.json().catch(() => ({ error: text('httpReturned', { status: response.status }) }));
    if (!response.ok) throw new Error(result.error || text('deleteFailed'));
    if (selectedId === id) {
      selectedId = '';
      renderEmptyState(text('deletedTitle'), text('deletedBody'));
    }
    await loadSessions();
    const changedRows = Object.values(result.sqlite_rows || {}).reduce((sum, value) => sum + value, 0);
    showToast(text('sessionDeleted', { count: changedRows }));
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function requestDeleteConfirmation(plan, title) {
  const dialog = document.querySelector('#delete-dialog');
  const shortId = document.querySelector('#delete-short-id');
  const input = document.querySelector('#delete-confirm-input');
  const confirmButton = document.querySelector('#confirm-delete-button');
  const copyButton = document.querySelector('#copy-delete-id');
  document.querySelector('#delete-dialog-title').textContent = text('deleteDialogTitle');
  document.querySelector('#delete-code-label').textContent = text('deleteCodeLabel');
  document.querySelector('#delete-input-label').textContent = text('confirmShortIdLabel');
  document.querySelector('#delete-summary').textContent = text('deleteSummary', {
    title,
    rows: plan.sqlite_rows_total,
    files: plan.files_total,
  });
  shortId.textContent = plan.short_id;
  input.value = '';
  confirmButton.disabled = true;
  input.oninput = () => {
    confirmButton.disabled = input.value.trim().toLowerCase() !== plan.short_id.toLowerCase();
  };
  copyButton.onclick = async () => {
    await copyPath(plan.short_id, text('shortIdCopied'));
    input.focus();
  };
  shortId.onclick = () => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(shortId);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  return new Promise(resolve => {
    dialog.onclose = () => resolve(dialog.returnValue === 'confirm' ? input.value.trim() : null);
    dialog.showModal();
  });
}

async function deleteGroup(group) {
  const label = group.archived ? text('archivedProject') : (group.temporary ? text('temporaryProject') : projectName(group.cwd));
  const sessionIds = group.items.map(item => item.id);
  try {
    const planResponse = await fetch('/api/session-groups/delete-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds }),
    });
    const plan = await planResponse.json().catch(() => ({ error: text('httpReturned', { status: planResponse.status }) }));
    if (!planResponse.ok) {
      if (planResponse.status === 404) {
        throw new Error(text('groupPlanOutdated'));
      }
      throw new Error(plan.error || text('groupPlanFailed'));
    }
    const confirmation = await requestGroupDeleteConfirmation(plan, label);
    if (confirmation === null) return;
    const response = await fetch('/api/session-groups/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds, confirmation }),
    });
    const result = await response.json().catch(() => ({ error: text('httpReturned', { status: response.status }) }));
    if (!response.ok) throw new Error(result.error || text('groupDeleteFailed'));
    if (group.items.some(item => item.id === selectedId)) {
      selectedId = '';
      renderEmptyState(text('groupDeletedTitle'), text('groupDeletedBody'));
    }
    await loadSessions();
    showToast(text('groupDeleted', { count: result.sessions_deleted }));
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function requestGroupDeleteConfirmation(plan, label) {
  const dialog = document.querySelector('#delete-dialog');
  const phrase = plan.confirmation;
  const shortId = document.querySelector('#delete-short-id');
  const input = document.querySelector('#delete-confirm-input');
  const confirmButton = document.querySelector('#confirm-delete-button');
  const copyButton = document.querySelector('#copy-delete-id');
  document.querySelector('#delete-dialog-title').textContent = text('deleteDialogTitle');
  document.querySelector('#delete-code-label').textContent = text('groupCodeLabel');
  document.querySelector('#delete-input-label').textContent = text('groupConfirmLabel');
  document.querySelector('#delete-summary').textContent = text('groupDeleteSummary', {
    label,
    sessions: plan.sessions,
    rows: plan.sqlite_rows_total,
    files: plan.files_total,
  });
  shortId.textContent = phrase;
  input.value = '';
  confirmButton.disabled = true;
  input.oninput = () => { confirmButton.disabled = input.value.trim() !== phrase; };
  copyButton.onclick = async () => { await copyPath(phrase, text('confirmTextCopied')); input.focus(); };
  shortId.onclick = () => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(shortId);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  return new Promise(resolve => {
    dialog.onclose = () => resolve(dialog.returnValue === 'confirm' ? input.value.trim() : null);
    dialog.showModal();
  });
}

listEl.addEventListener('click', event => {
  const groupDelete = event.target.closest('.group-delete-action');
  if (groupDelete) {
    event.preventDefault();
    event.stopPropagation();
    const group = renderedGroups.get(groupDelete.dataset.groupKey);
    if (group) deleteGroup(group);
    return;
  }
  const item = event.target.closest('.session');
  if (!item) return;
  if (event.target.closest('.copy-action')) {
    copyPath(item.dataset.path);
  } else if (event.target.closest('.delete-action')) {
    deleteSession(item);
  } else {
    openSession(item.dataset.id);
  }
});

listEl.addEventListener('keydown', event => {
  const item = event.target.closest('.session');
  if (item && event.target === item && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    openSession(item.dataset.id);
  }
});

themeToggleEl.addEventListener('click', () => {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('codex-history-theme', nextTheme);
  applyTheme(nextTheme);
});

langToggleEl.addEventListener('click', () => {
  applyLanguage(language === 'zh' ? 'en' : 'zh');
});

mainEl.addEventListener('click', event => {
  const copyTarget = event.target.closest('.copyable-fact');
  if (copyTarget) copyPath(copyTarget.dataset.copyPath);
});

queryEl.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(loadSessions, 220);
});

applyLanguage(language);
checkBackendVersion();
loadSessions();
