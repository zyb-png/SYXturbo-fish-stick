const $ = id => document.getElementById(id);
let currentUserId = '';

document.addEventListener('DOMContentLoaded', async () => {
  $('createUserForm').addEventListener('submit', createUser);
  $('refreshBtn').addEventListener('click', loadUsers);
  try {
    const session = await api('/api/session');
    currentUserId = session.id;
    await loadUsers();
  } catch (error) {
    showMessage(error.message, true);
  }
});

async function loadUsers() {
  try {
    const result = await api('/api/admin/users');
    renderSummary(result.users, result.maxAdmins);
    renderUsers(result.users);
    showMessage('账号数据已更新');
  } catch (error) {
    showMessage(error.message, true);
  }
}

function renderSummary(users, maxAdmins) {
  $('totalUsers').textContent = String(users.length);
  $('adminUsers').textContent = `${users.filter(user => user.role === 'admin').length} / ${maxAdmins}`;
  $('totalQuota').textContent = String(users.reduce((sum, user) => sum + user.quota, 0));
  $('totalUsed').textContent = String(users.reduce((sum, user) => sum + user.used, 0));
}

function renderUsers(users) {
  $('userRows').innerHTML = users.map(user => `
    <tr data-user-id="${escapeHtml(user.id)}">
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td>${user.role === 'admin' ? '管理员' : '普通账号'}</td>
      <td>${user.quota}</td>
      <td>${user.used}</td>
      <td><strong>${user.remaining}</strong></td>
      <td><span class="status ${user.enabled ? '' : 'disabled'}">${user.enabled ? '启用' : '停用'}</span></td>
      <td>${formatTime(user.lastLoginAt)}</td>
      <td>
        <div class="row-actions">
          <button data-action="quota" type="button">设置额度</button>
          <button data-action="password" type="button">重置密码</button>
          <button data-action="role" type="button">${user.role === 'admin' ? '改为普通账号' : '设为管理员'}</button>
          <button data-action="enabled" type="button">${user.enabled ? '停用' : '启用'}</button>
          <button class="danger" data-action="delete" type="button" ${user.id === currentUserId ? 'disabled' : ''}>删除</button>
        </div>
      </td>
    </tr>
  `).join('');
  $('userRows').querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', () => handleUserAction(button.closest('tr').dataset.userId, button.dataset.action, users));
  });
}

async function createUser(event) {
  event.preventDefault();
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('newUsername').value.trim(),
        password: $('newPassword').value,
        role: $('newRole').value,
        quota: Number($('newQuota').value),
      }),
    });
    event.currentTarget.reset();
    $('newQuota').value = '100';
    showMessage('账号创建成功');
    await loadUsers();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function handleUserAction(userId, action, users) {
  const user = users.find(item => item.id === userId);
  if (!user) return;
  try {
    if (action === 'quota') {
      const value = prompt(`设置 ${user.username} 的视频秒数总额度`, String(user.quota));
      if (value === null) return;
      await updateUser(userId, { quota: Number(value) });
    } else if (action === 'password') {
      const password = prompt(`输入 ${user.username} 的新密码（至少 8 位）`);
      if (!password) return;
      await updateUser(userId, { password });
    } else if (action === 'role') {
      const role = user.role === 'admin' ? 'user' : 'admin';
      if (!confirm(`确定将 ${user.username} 改为${role === 'admin' ? '管理员' : '普通账号'}？`)) return;
      await updateUser(userId, { role });
    } else if (action === 'enabled') {
      await updateUser(userId, { enabled: !user.enabled });
    } else if (action === 'delete') {
      if (!confirm(`确定删除账号 ${user.username}？此操作不可撤销。`)) return;
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    }
    await loadUsers();
  } catch (error) {
    showMessage(error.message, true);
  }
}

function updateUser(userId, payload) {
  return api(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showMessage(message, error = false) {
  $('message').hidden = false;
  $('message').classList.toggle('error', error);
  $('message').textContent = message;
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : '尚未登录';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}
