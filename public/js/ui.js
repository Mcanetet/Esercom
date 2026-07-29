/* Shared UI helpers for module pages */
function flash(msg, isError) {
  let el = document.getElementById('flash');
  if (!el) {
    const content = document.getElementById('app-content');
    if (!content) return;
    content.insertAdjacentHTML('afterbegin', '<div id="flash"></div>');
    el = document.getElementById('flash');
  }
  el.innerHTML = `<div class="alert ${isError ? 'alert-error' : 'alert-ok'}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4000);
}

function badge(text, color) {
  return `<span class="badge" style="background:${color || '#64748b'}">${text || '—'}</span>`;
}

function statusColor(estado) {
  const s = String(estado || '').toLowerCase();
  if (s.includes('aprob') || s.includes('cerrad') || s.includes('ok') || s.includes('valid')) return '#22c55e';
  if (s.includes('pend') || s.includes('abiert') || s.includes('borrador') || s.includes('program')) return '#f59e0b';
  if (s.includes('rechaz') || s.includes('anul')) return '#ef4444';
  if (s.includes('entreg') || s.includes('asign') || s.includes('proceso')) return '#3b82f6';
  return '#64748b';
}

function optionList(items, valueKey, labelFn, selected) {
  return (items || []).map((i) => {
    const v = i[valueKey];
    const label = typeof labelFn === 'function' ? labelFn(i) : i[labelFn];
    return `<option value="${v}" ${String(v) === String(selected) ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function emptyRow(cols, text) {
  return `<tr><td colspan="${cols}" class="empty">${text || 'Sin registros'}</td></tr>`;
}

async function loadCecos() {
  const { data } = await Auth.api('/api/catalogos/cecos');
  return data;
}

async function loadUsuarios(flag) {
  const url = flag
    ? `/api/catalogos/usuarios?flag=${encodeURIComponent(flag)}`
    : '/api/catalogos/usuarios';
  const { data } = await Auth.api(url);
  return data;
}

async function loadProveedores() {
  const { data } = await Auth.api('/api/catalogos/proveedores');
  return data;
}

async function loadMateriales(q) {
  const url = q ? `/api/catalogos/materiales?q=${encodeURIComponent(q)}` : '/api/catalogos/materiales';
  const { data } = await Auth.api(url);
  return data;
}

function hasFlag(user, flag) {
  if (!user) return false;
  const rol = String(user.rol || '').toLowerCase();
  if (user.rol_id === 1 || rol.includes('admin')) return true;
  return !!user[flag];
}

window.UI = { flash, badge, statusColor, optionList, emptyRow, loadCecos, loadUsuarios, loadProveedores, loadMateriales, hasFlag };
