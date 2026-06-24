const listEl = document.querySelector('#sessions');
const mainEl = document.querySelector('#main');
const queryEl = document.querySelector('#query');
const countEl = document.querySelector('#count');
let selectedId = '';
let timer;
let renderedGroups = new Map();

const savedTheme = localStorage.getItem('codex-history-theme');
const preferredTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
let theme = savedTheme || preferredTheme;

function applyTheme(nextTheme) {
  theme = nextTheme;
  document.documentElement.dataset.theme = theme;
  const button = document.querySelector('#theme-toggle');
  if (button) {
    button.querySelector('.theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
    button.title = theme === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  }
}

applyTheme(theme);

const escapeHtml = (value = '') => String(value).replace(
  /[&<>'"]/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char],
);

const dateText = value => {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(date);
};

const fullDateText = value => {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).format(date);
};

const projectName = cwd => {
  if (!cwd) return '未归类项目';
  const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.at(-1) || cwd;
};

function renderMessage(message) {
  const isUser = message.role === 'user';
  const kindLabel = message.kind === 'final' ? '最终回复' : '历史回复';
  return `
    <section class="message ${message.role} ${message.kind || 'legacy'}">
      <div class="avatar">${isUser ? '你' : 'C'}</div>
      <div class="bubble">
        <div class="role">
          <span>${isUser ? '你' : 'Codex'}</span>
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
          <strong>处理过程</strong>
          <em>${messages.length} 条</em>
          <time>${timeRange}</time>
        </summary>
        <div class="process-steps">
          ${messages.map((message, index) => `
            <div class="process-step">
              <div class="step-meta"><span>步骤 ${index + 1}</span><time>${dateText(message.timestamp)}</time></div>
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
  if (!sessions.length) {
    listEl.innerHTML = '<div class="hint">没有找到匹配的会话</div>';
    return;
  }

  const groups = new Map();
  for (const session of sessions) {
    const key = session.is_temporary ? '__temporary__' : (session.cwd || '__temporary__');
    if (!groups.has(key)) groups.set(key, { cwd: session.cwd, temporary: session.is_temporary, items: [], latest: 0 });
    const group = groups.get(key);
    group.items.push(session);
    group.latest = Math.max(group.latest, Date.parse(session.updated_at) || 0);
  }

  const orderedGroups = [...groups.values()].sort((a, b) => {
    if (a.temporary !== b.temporary) return Number(a.temporary) - Number(b.temporary);
    return b.latest - a.latest;
  });
  renderedGroups = new Map();
  listEl.innerHTML = orderedGroups.map((group, groupIndex) => {
    const groupKey = `group-${groupIndex}`;
    renderedGroups.set(groupKey, group);
    const { cwd, items, temporary } = group;
    items.sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));
    const path = temporary ? '未指定项目的对话' : cwd;
    const label = temporary ? '临时会话' : projectName(cwd);
    return `
      <details class="project ${temporary ? 'temporary-project' : ''}" open>
        <summary>
          <span class="project-arrow">›</span>
          <span class="project-info">
            <strong>${escapeHtml(label)}</strong>
            <small title="${escapeHtml(path)}">${escapeHtml(path)} · 更新于 ${dateText(group.latest)}</small>
          </span>
          <span class="project-count">${items.length}</span>
          <button class="group-delete-action" data-group-key="${groupKey}" title="删除整个分组的会话" aria-label="删除整个分组的会话">×</button>
        </summary>
        <div class="project-sessions">
          ${items.map(session => `
            <div class="session ${session.id === selectedId ? 'active' : ''}" data-id="${session.id}"
                 data-path="${escapeHtml(session.local_path)}" role="button" tabindex="0">
              <div class="session-body">
                <span class="title">${escapeHtml(session.title)}</span>
                <span class="meta">
                  <time>${dateText(session.updated_at)}</time>
                  <i>${session.message_count} 条消息</i>
                </span>
              </div>
              <div class="session-actions">
                <button class="session-action copy-action" title="复制会话文件路径" aria-label="复制会话文件路径">⧉</button>
                <button class="session-action delete-action" title="删除会话" aria-label="删除会话">×</button>
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
    listEl.innerHTML = `<div class="hint error">读取失败：${escapeHtml(error.message)}</div>`;
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
    warning.textContent = '后台服务版本过旧，请在终端按 Ctrl+C 后重新运行 python server.py';
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
  mainEl.innerHTML = '<div class="empty"><div class="spinner"></div><p>正在整理对话…</p></div>';
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('会话不存在或已移动');
    const session = await response.json();
    const currentProject = session.is_temporary ? '临时会话' : projectName(session.cwd);
    mainEl.innerHTML = `
      <div class="conversation-head">
        <div class="head-title">
          <span class="eyebrow">${escapeHtml(currentProject)} · ${session.message_count} 条消息</span>
          <h1>${escapeHtml(session.title)}</h1>
        </div>
        <div class="session-facts">
          <div class="fact"><span>创建时间</span><strong>${fullDateText(session.created_at)}</strong></div>
          <div class="fact"><span>更新时间</span><strong>${fullDateText(session.updated_at)}</strong></div>
          <div class="fact"><span>项目</span><strong>${escapeHtml(currentProject)}</strong></div>
          <button class="fact copyable-fact work-path-fact" data-copy-path="${escapeHtml(session.cwd)}" title="点击复制工作路径">
            <span>工作路径 · 点击复制</span><strong>${escapeHtml(session.cwd || '未知目录')}</strong><i>⧉</i>
          </button>
          <button class="fact copyable-fact history-path-fact" data-copy-path="${escapeHtml(session.local_path)}" title="点击复制会话记录文件路径">
            <span>会话记录文件 · 点击复制 <b class="path-state ${session.local_path_exists ? 'available' : 'missing'}">${session.local_path_exists ? '文件存在' : '路径失效'}</b></span>
            <strong>${escapeHtml(session.local_path || '未能从会话索引定位文件')}</strong><i>⧉</i>
          </button>
        </div>
      </div>
      <article>${session.messages.length ? renderConversation(session.messages) : '<div class="hint">这段会话没有可展示的用户或助手消息</div>'}</article>`;
    mainEl.scrollTop = 0;
  } catch (error) {
    mainEl.innerHTML = `<div class="empty"><h1>无法打开</h1><p>${escapeHtml(error.message)}</p></div>`;
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

async function copyPath(path, successMessage = '本地路径已复制') {
  if (!path) {
    showToast('没有可复制的会话路径', 'error');
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
    showToast(copied ? successMessage : '复制失败，请检查浏览器权限', copied ? '' : 'error');
  }
}

async function deleteSession(item) {
  const title = item.querySelector('.title')?.textContent || '该会话';
  const id = item.dataset.id;
  try {
    const planResponse = await fetch(`/api/sessions/${encodeURIComponent(id)}/delete-plan`);
    const plan = await planResponse.json().catch(() => ({ error: `服务返回了 HTTP ${planResponse.status}` }));
    if (!planResponse.ok) throw new Error(plan.error || '无法生成安全删除计划');
    const confirmation = await requestDeleteConfirmation(plan, title);
    if (confirmation === null) return;
    const response = await fetch(`/api/sessions/${encodeURIComponent(id)}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation }),
    });
    const result = await response.json().catch(() => ({ error: `服务返回了 HTTP ${response.status}` }));
    if (!response.ok) throw new Error(result.error || '删除失败');
    if (selectedId === id) {
      selectedId = '';
      mainEl.innerHTML = '<div class="empty"><div class="orb">C</div><h1>会话已删除</h1><p>请从左侧选择另一段对话。</p></div>';
    }
    await loadSessions();
    const changedRows = Object.values(result.sqlite_rows || {}).reduce((sum, value) => sum + value, 0);
    showToast(`会话已完整删除（清理 ${changedRows} 条关联记录）`);
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
  document.querySelector('#delete-summary').textContent =
    `“${title}”将清理 ${plan.sqlite_rows_total} 条 SQLite 记录、${plan.files_total} 个会话文件，` +
    '并重写 Codex 索引与全局状态。此操作无法撤销。';
  shortId.textContent = plan.short_id;
  input.value = '';
  confirmButton.disabled = true;
  input.oninput = () => {
    confirmButton.disabled = input.value.trim().toLowerCase() !== plan.short_id.toLowerCase();
  };
  copyButton.onclick = async () => {
    await copyPath(plan.short_id, '短 ID 已复制');
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
  const label = group.temporary ? '临时会话' : projectName(group.cwd);
  const sessionIds = group.items.map(item => item.id);
  try {
    const planResponse = await fetch('/api/session-groups/delete-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds }),
    });
    const plan = await planResponse.json().catch(() => ({ error: `服务返回了 HTTP ${planResponse.status}` }));
    if (!planResponse.ok) {
      if (planResponse.status === 404 && plan.error === '接口不存在') {
        throw new Error('后台服务版本过旧：请在终端按 Ctrl+C，然后重新运行 python server.py');
      }
      throw new Error(plan.error || '无法生成分组删除计划');
    }
    const confirmation = await requestGroupDeleteConfirmation(plan, label);
    if (confirmation === null) return;
    const response = await fetch('/api/session-groups/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_ids: sessionIds, confirmation }),
    });
    const result = await response.json().catch(() => ({ error: `服务返回了 HTTP ${response.status}` }));
    if (!response.ok) throw new Error(result.error || '分组删除失败');
    if (group.items.some(item => item.id === selectedId)) {
      selectedId = '';
      mainEl.innerHTML = '<div class="empty"><div class="orb">C</div><h1>分组会话已删除</h1><p>实际工作目录及其中的文件未受影响。</p></div>';
    }
    await loadSessions();
    showToast(`已删除 ${result.sessions_deleted} 个会话，工作目录未修改`);
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
  document.querySelector('#delete-summary').textContent =
    `“${label}”中的 ${plan.sessions} 个会话将被永久删除；预计清理 ${plan.sqlite_rows_total} 条 SQLite 记录、` +
    `${plan.files_total} 个 Codex 会话文件。实际工作目录及其中的项目文件不会被删除或修改。`;
  shortId.textContent = phrase;
  input.value = '';
  confirmButton.disabled = true;
  input.oninput = () => { confirmButton.disabled = input.value.trim() !== phrase; };
  copyButton.onclick = async () => { await copyPath(phrase, '确认文本已复制'); input.focus(); };
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

document.querySelector('#theme-toggle').addEventListener('click', () => {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('codex-history-theme', nextTheme);
  applyTheme(nextTheme);
});

mainEl.addEventListener('click', event => {
  const copyTarget = event.target.closest('.copyable-fact');
  if (copyTarget) copyPath(copyTarget.dataset.copyPath);
});

queryEl.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(loadSessions, 220);
});

checkBackendVersion();
loadSessions();
