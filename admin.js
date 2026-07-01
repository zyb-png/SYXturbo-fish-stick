const adminState = {
  session: null,
  accounts: [],
  projects: [],
  pricing: [],
  billing: null,
  managementMode: 'accounts',
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  bindAdminEvents();
  await loadAdminData();
});

function bindAdminEvents() {
  $('accountsModeBtn').addEventListener('click', () => switchManagementMode('accounts'));
  $('projectsModeBtn').addEventListener('click', () => switchManagementMode('projects'));
  $('refreshAccountsBtn').addEventListener('click', loadAccounts);
  $('refreshProjectsBtn').addEventListener('click', loadProjects);
  $('accountForm').addEventListener('submit', createAccount);
  $('projectForm').addEventListener('submit', createProject);
  $('usageFilter').addEventListener('submit', event => {
    event.preventDefault();
    loadUsage();
    loadBillingRecords();
  });
  $('refreshBillingBtn').addEventListener('click', loadBillingRecords);
  $('savePricingBtn').addEventListener('click', savePricing);
  $('syncPricingBtn').addEventListener('click', syncPricing);
  $('adminDialogBackdrop').addEventListener('click', closeAdminDialog);
  $('adminDialogCancel').addEventListener('click', closeAdminDialog);
}

async function loadAdminData() {
  try {
    adminState.session = await api('/api/session');
    if (!['admin', 'super_admin'].includes(adminState.session.account.role)) {
      location.href = '/';
      return;
    }
    renderSession();
    switchManagementMode(adminState.managementMode);
    await Promise.all([loadAccounts(), loadProjects(), loadPricing()]);
    await loadUsage();
    await loadBillingRecords();
  } catch (error) {
    if (error.status === 401) location.href = '/login';
    toast(error.message, 'error');
  }
}

async function refreshSession() {
  adminState.session = await api('/api/session');
  renderSession();
}

function switchManagementMode(mode) {
  adminState.managementMode = mode;
  const isAccounts = mode === 'accounts';
  $('accountsPane').hidden = !isAccounts;
  $('projectsPane').hidden = isAccounts;
  $('accountsModeBtn').classList.toggle('active', isAccounts);
  $('projectsModeBtn').classList.toggle('active', !isAccounts);
  $('accountsModeBtn').setAttribute('aria-selected', String(isAccounts));
  $('projectsModeBtn').setAttribute('aria-selected', String(!isAccounts));
  $('refreshAccountsBtn').hidden = !isAccounts;
  $('refreshProjectsBtn').hidden = isAccounts;
  $('managementHint').textContent = isAccounts
    ? '新建、禁用、软删除账号，并按金额分配额度。'
    : '创建项目、暂停项目，并查看项目预算和已用金额。';
}

function renderSession() {
  const { account, quota } = adminState.session;
  const roleName = account.role === 'super_admin' ? '超级管理员' : '管理员';
  const apiBalanceText = adminState.session.manfei_balance_rmb !== undefined
    ? ` · Manfei API 总余额 ${adminState.session.manfei_balance_rmb} 元`
    : '';
  $('adminTitle').textContent = account.role === 'super_admin' ? '超级管理员后台' : '管理员后台';
  $('adminSubtitle').textContent = account.role === 'super_admin'
    ? `全局账号、管理员额度、项目、用量与价格表${apiBalanceText}`
    : `管理自己名下的用户、项目、额度与报表${apiBalanceText}`;
  $('adminAccount').textContent = `${account.display_name || account.username} · ${roleName}`;
  const showApiBalance = ['super_admin', 'admin'].includes(account.role) && adminState.session.manfei_balance_rmb !== undefined;
  const balanceText = showApiBalance ? `${adminState.session.manfei_balance_rmb} 元` : `${quota.total_rmb} 元`;
  $('adminQuotaTotal').textContent = balanceText;
  $('adminQuotaUsed').textContent = `${quota.used_rmb} 元`;
  $('adminQuotaFrozen').textContent = `${quota.frozen_rmb} 元`;
  $('superLink').hidden = account.role !== 'super_admin';
  $('pricingCard').hidden = account.role !== 'super_admin';
  $('accountRole').hidden = account.role !== 'super_admin';
  $('accountAdminId').hidden = account.role !== 'super_admin';
  $('projectAdminId').hidden = account.role !== 'super_admin';
}

async function loadAccounts() {
  const result = await api('/api/accounts');
  adminState.accounts = result.items || [];
  renderAccountSelectors();
  renderAccountsTable();
}

function renderAccountSelectors() {
  const admins = adminState.accounts.filter(account => account.role === 'admin');
  for (const select of [$('accountAdminId'), $('projectAdminId')]) {
    select.innerHTML = '';
    admins.forEach(admin => {
      const option = document.createElement('option');
      option.value = admin.id;
      option.textContent = admin.display_name || admin.username;
      select.appendChild(option);
    });
  }
  $('filterAccount').innerHTML = '<option value="">全部账号</option>';
  adminState.accounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = `${account.display_name || account.username} · ${roleName(account.role)}`;
    $('filterAccount').appendChild(option);
  });
}

function renderAccountsTable() {
  const rows = adminState.accounts.map(account => `
    <tr>
      <td>${escapeHtml(account.username)}</td>
      <td>${escapeHtml(account.display_name || '')}</td>
      <td>${roleName(account.role)}</td>
      <td>${account.status === 'active' ? '启用' : '停用'}</td>
      <td>${account.quota?.total_rmb ?? 0} 元</td>
      <td>${account.quota?.used_rmb ?? 0} 元</td>
      <td>${account.quota?.remaining_rmb ?? 0} 元</td>
      <td>
        ${account.id === adminState.session?.account?.id
          ? '<button type="button" disabled>当前</button>'
          : `<button data-account-action="toggle" data-id="${account.id}" type="button">${account.status === 'active' ? '禁用' : '启用'}</button>`}
        <button data-account-action="quota" data-id="${account.id}" type="button">额度</button>
        <button data-account-action="password" data-id="${account.id}" type="button">改密</button>
        <button data-account-action="rename" data-id="${account.id}" type="button">改名</button>
        ${account.role === 'super_admin' ? '' : `<button data-account-action="delete" data-id="${account.id}" type="button">删除</button>`}
      </td>
    </tr>
  `).join('');
  $('accountsTable').innerHTML = table(['账号', '名称', '角色', '状态', '总额度', '已用', '剩余', '操作'], rows);
  $('accountsTable').querySelectorAll('[data-account-action]').forEach(button => {
    button.addEventListener('click', () => handleAccountAction(button.dataset.accountAction, button.dataset.id));
  });
}

async function handleAccountAction(action, accountId) {
  const account = adminState.accounts.find(item => item.id === accountId);
  if (!account) return;
  try {
    if (action === 'toggle') {
      if (account.id === adminState.session?.account?.id) {
        toast('不能禁用当前正在登录的账号', 'error');
        return;
      }
      toast('正在更新账号状态...');
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: { status: account.status === 'active' ? 'disabled' : 'active' },
      });
      toast('账号状态已更新');
    } else if (action === 'quota') {
      const value = await openAdminDialog({
        title: '设置账号额度',
        hint: `账号：${account.username}。额度单位为元，不能超过 Manfei API 当前余额。`,
        value: account.quota?.total_rmb ?? 0,
        type: 'number',
        step: '0.01',
        min: '0',
      });
      if (value === null) return;
      if (!Number.isFinite(Number(value)) || Number(value) < 0) {
        toast('请输入有效的额度金额', 'error');
        return;
      }
      toast('正在更新额度...');
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: { total_rmb: Number(value) },
      });
      toast('额度已更新');
    } else if (action === 'password') {
      const value = await openAdminDialog({
        title: '修改账号密码',
        hint: `账号：${account.username}。请输入新密码。`,
        value: '',
        type: 'text',
        placeholder: '新密码',
      });
      if (!value) return;
      toast('正在更新密码...');
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: { password: value },
      });
      toast('密码已更新');
    } else if (action === 'rename') {
      const value = await openAdminDialog({
        title: '修改账号名称',
        hint: `账号：${account.username}。请输入新的显示名称。`,
        value: account.display_name || account.username,
        type: 'text',
        placeholder: '显示名称',
      });
      if (value === null) return;
      const displayName = String(value).trim();
      if (!displayName) {
        toast('显示名称不能为空', 'error');
        return;
      }
      toast('正在更新名称...');
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: { display_name: displayName },
      });
      toast('名称已更新');
    } else if (action === 'delete') {
      if (!confirm(`软删除账号「${account.username}」？历史记录会保留。`)) return;
      toast('正在软删除账号...');
      await api(`/api/accounts/${accountId}`, { method: 'DELETE' });
      toast('账号已软删除');
    }
    await refreshSession();
    await loadAccounts();
    await loadUsage();
  } catch (error) {
    toast(`操作失败：${error.message}`, 'error');
  }
}

async function createAccount(event) {
  event.preventDefault();
  try {
    const role = adminState.session.account.role === 'super_admin' ? $('accountRole').value : 'user';
    toast('正在创建账号...');
    await api('/api/accounts', {
      method: 'POST',
      body: {
        username: $('accountUsername').value.trim(),
        display_name: $('accountDisplayName').value.trim() || $('accountUsername').value.trim(),
        password: $('accountPassword').value,
        role,
        admin_id: $('accountAdminId').value || undefined,
        total_rmb: Number($('accountQuota').value || 0),
      },
    });
    $('accountForm').reset();
    toast('账号已创建');
    await refreshSession();
    await loadAccounts();
  } catch (error) {
    toast(`创建失败：${error.message}`, 'error');
  }
}

async function loadProjects() {
  const result = await api('/api/projects');
  adminState.projects = result.items || [];
  renderProjectSelectors();
  renderProjectsTable();
}

function renderProjectSelectors() {
  $('filterProject').innerHTML = '<option value="">全部项目</option>';
  adminState.projects.forEach(project => {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    $('filterProject').appendChild(option);
  });
}

function renderProjectsTable() {
  const rows = adminState.projects.map(project => `
    <tr>
      <td>${escapeHtml(project.name)}</td>
      <td>${project.status}</td>
      <td>${project.budget_rmb || 0} 元</td>
      <td>${project.used_rmb || 0} 元</td>
      <td>${project.remaining_budget_rmb === null ? '不限' : `${project.remaining_budget_rmb} 元`}${project.budget_exceeded ? ' · 已达预算' : ''}</td>
      <td>${escapeHtml(project.notes || '')}</td>
      <td>
        <button data-project-action="toggle" data-id="${project.id}" type="button">${project.status === 'active' ? '暂停' : '启用'}</button>
        <button data-project-action="delete" data-id="${project.id}" type="button">删除</button>
      </td>
    </tr>
  `).join('');
  $('projectsTable').innerHTML = table(['项目', '状态', '预算', '已占用', '剩余预算', '备注', '操作'], rows);
  $('projectsTable').querySelectorAll('[data-project-action]').forEach(button => {
    button.addEventListener('click', () => handleProjectAction(button.dataset.projectAction, button.dataset.id));
  });
}

async function handleProjectAction(action, projectId) {
  const project = adminState.projects.find(item => item.id === projectId);
  if (!project) return;
  if (action === 'toggle') {
    await api(`/api/projects/${projectId}`, {
      method: 'PATCH',
      body: { status: project.status === 'active' ? 'paused' : 'active' },
    });
    toast('项目状态已更新');
  } else if (action === 'delete') {
    if (!confirm(`删除项目「${project.name}」？历史任务仍会保留。`)) return;
    await api(`/api/projects/${projectId}`, { method: 'DELETE' });
    toast('项目已删除');
  }
  await loadProjects();
  await loadUsage();
}

async function createProject(event) {
  event.preventDefault();
  await api('/api/projects', {
    method: 'POST',
    body: {
      name: $('projectName').value.trim(),
      admin_id: $('projectAdminId').value || undefined,
      budget_rmb: Number($('projectBudget').value || 0),
      notes: $('projectNotes').value.trim(),
    },
  });
  $('projectForm').reset();
  toast('项目已创建');
  await loadProjects();
}

async function loadUsage() {
  const query = buildUsageQuery();
  const result = await api(`/api/usage-report${query}`);
  $('usageTotal').textContent = `总金额：${result.total_rmb ?? 0} 元`;
  $('exportLink').href = `/api/export.xlsx${query}`;
  const rows = (result.items || []).map(item => `
    <tr>
      <td>${escapeHtml(item.created_at || '')}</td>
      <td>${escapeHtml(item.username || '')}</td>
      <td>${escapeHtml(item.project_name || '')}</td>
      <td>${escapeHtml(item.id || '')}</td>
      <td>${escapeHtml(item.status || '')}</td>
      <td>${escapeHtml(item.model || '')}</td>
      <td>${item.actual_rmb ?? 0} 元</td>
      <td>${escapeHtml(item.billing_status || '')}</td>
    </tr>
  `).join('');
  $('usageTable').innerHTML = table(['时间', '账号', '项目', '任务ID', '状态', '模型', '实际金额', '结算'], rows);
}

async function loadBillingRecords() {
  try {
    const query = buildBillingQuery();
    const result = await api(`/api/billing-records${query}`);
    adminState.billing = result;
    renderBillingRecords();
  } catch (error) {
    $('billingSummary').innerHTML = `<span class="admin-error">扣款记录读取失败：${escapeHtml(error.message)}</span>`;
    $('billingTable').innerHTML = table(['时间', '类型', '任务ID', '金额', '余额变化'], '');
  }
}

function renderBillingRecords() {
  const result = adminState.billing || { items: [], summary: {} };
  const items = result.items || [];
  const positive = items.reduce((sum, item) => sum + Math.max(0, Number(item.amount_rmb) || 0), 0);
  const negative = items.reduce((sum, item) => sum + Math.min(0, Number(item.amount_rmb) || 0), 0);
  const unmatched = items.filter(item => !item.matched_local_task).length;
  $('billingSummary').innerHTML = `
    <article><span>记录数</span><strong>${items.length}</strong></article>
    <article><span>净额</span><strong>${result.summary?.total_rmb ?? 0} 元</strong></article>
    <article><span>扣费合计</span><strong>${positive.toFixed(2)} 元</strong></article>
    <article><span>退款/调差</span><strong>${negative.toFixed(2)} 元</strong></article>
    <article><span>未匹配任务</span><strong>${unmatched}</strong></article>
  `;
  const rows = items.map(item => {
    const amountClass = Number(item.amount_rmb) < 0 ? 'billing-refund' : 'billing-charge';
    const isMatched = Boolean(item.matched_local_task);
    const account = item.account_display_name || item.account_username || '';
    const admin = item.admin_display_name || item.admin_username || '';
    const project = item.project_name || '';
    const ownerCell = isMatched
      ? `<strong class="billing-owner">${escapeHtml(account || '未知账号')}</strong><small>${escapeHtml(item.account_username || '')}</small>`
      : '<span class="billing-unmatched-badge">未匹配本地任务</span><small>无法判断操作账号</small>';
    return `
      <tr class="${isMatched ? '' : 'billing-row-unmatched'}">
        <td>${escapeHtml(item.created_at || '')}</td>
        <td>${escapeHtml(item.endpoint || '')}</td>
        <td>${escapeHtml(item.task_id || '')}</td>
        <td class="billing-person-cell">${ownerCell}</td>
        <td>${escapeHtml(admin || (isMatched ? '未设置管理员' : '未匹配'))}</td>
        <td>${escapeHtml(project || (isMatched ? '未设置项目' : '未匹配'))}</td>
        <td class="${amountClass}">${item.amount_rmb ?? 0} 元</td>
        <td>${formatBalanceChange(item)}</td>
        <td>${escapeHtml(item.request_id || '')}</td>
      </tr>
    `;
  }).join('');
  $('billingTable').innerHTML = table(['时间', '扣款类型', '任务ID', '操作人', '管理员', '项目', '金额', '余额变化', 'Request ID'], rows);
}

function formatBalanceChange(item) {
  const before = item.balance_before;
  const after = item.balance_after;
  if (before === null || before === undefined || after === null || after === undefined) return '';
  return `${before} → ${after}`;
}

function buildBillingQuery() {
  const params = new URLSearchParams();
  params.set('limit', '100');
  params.set('pages', '3');
  if ($('dateFrom').value) params.set('date_from', $('dateFrom').value);
  if ($('dateTo').value) params.set('date_to', $('dateTo').value);
  if ($('filterAccount').value) params.set('account_id', $('filterAccount').value);
  if ($('filterProject').value) params.set('project_id', $('filterProject').value);
  return `?${params.toString()}`;
}

function buildUsageQuery() {
  const params = new URLSearchParams();
  params.set('sync_billing', 'true');
  if ($('dateFrom').value) params.set('date_from', $('dateFrom').value);
  if ($('dateTo').value) params.set('date_to', $('dateTo').value);
  if ($('filterAccount').value) params.set('account_id', $('filterAccount').value);
  if ($('filterProject').value) params.set('project_id', $('filterProject').value);
  const value = params.toString();
  return value ? `?${value}` : '';
}

async function loadPricing() {
  if (adminState.session?.account.role !== 'super_admin') return;
  const result = await api('/api/pricing');
  adminState.pricing = result.items || [];
  renderPricing();
}

function renderPricing() {
  const rows = adminState.pricing.map(rule => `
    <tr>
      <td><input data-price-id="${rule.id}" data-field="model" value="${escapeAttr(rule.model)}"></td>
      <td><input data-price-id="${rule.id}" data-field="resolution" value="${escapeAttr(rule.resolution)}"></td>
      <td><input data-price-id="${rule.id}" data-field="per_second_rmb" type="number" min="0" step="0.01" value="${rule.per_second_rmb ?? rule.amount_rmb ?? 0}"></td>
    </tr>
  `).join('');
  $('pricingTable').innerHTML = table(['模型', '分辨率', '每秒价格（元/秒）'], rows);
}

async function savePricing() {
  const items = [];
  const grouped = new Map();
  $('pricingTable').querySelectorAll('input[data-price-id]').forEach(input => {
    const id = input.dataset.priceId;
    if (!grouped.has(id)) grouped.set(id, {});
    grouped.get(id)[input.dataset.field] = input.type === 'number' ? Number(input.value) : input.value.trim();
  });
  grouped.forEach(item => items.push(item));
  await api('/api/pricing', { method: 'PUT', body: { items } });
  toast('价格表已保存');
  await loadPricing();
}

async function syncPricing() {
  if (!confirm('将根据 Manfei 实际扣款记录折算每秒单价。仅同步能匹配到本地任务的记录，是否继续？')) return;
  const button = $('syncPricingBtn');
  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = '同步中';
  try {
    const result = await api('/api/pricing/sync', { method: 'POST', body: { limit: 200, pages: 5 } });
    const summary = `已同步 ${result.updated || 0} 组每秒单价，匹配 ${result.matched_records || 0} 条真实扣款，跳过 ${result.unmatched_records || 0} 条未匹配记录`;
    toast(summary);
    await Promise.all([loadPricing(), loadBillingRecords()]);
  } catch (error) {
    toast(`同步失败：${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(data.error || data.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function table(headers, rows) {
  return `
    <table>
      <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${headers.length}">暂无数据</td></tr>`}</tbody>
    </table>
  `;
}

function openAdminDialog({ title, hint = '', value = '', type = 'text', placeholder = '', min = '', step = '' }) {
  const dialog = $('adminDialog');
  const form = $('adminDialogForm');
  const input = $('adminDialogInput');
  $('adminDialogTitle').textContent = title;
  $('adminDialogHint').textContent = hint;
  input.type = type;
  input.placeholder = placeholder;
  input.min = min;
  input.step = step;
  input.value = value;
  dialog.hidden = false;
  input.focus();
  input.select();
  return new Promise(resolve => {
    const cleanup = (result) => {
      form.removeEventListener('submit', onSubmit);
      dialog.dataset.resolve = '';
      dialog.hidden = true;
      resolve(result);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      cleanup(input.value);
    };
    form.addEventListener('submit', onSubmit);
    dialog._resolve = cleanup;
  });
}

function closeAdminDialog() {
  const dialog = $('adminDialog');
  if (dialog?._resolve) {
    dialog._resolve(null);
    dialog._resolve = null;
  } else if (dialog) {
    dialog.hidden = true;
  }
}

function roleName(role) {
  return { super_admin: '超级管理员', admin: '管理员', user: '普通用户' }[role] || role;
}

function toast(message, tone = 'success') {
  const box = $('adminToast');
  box.textContent = message;
  box.className = `admin-toast ${tone}`;
  box.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    box.hidden = true;
  }, 2800);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
