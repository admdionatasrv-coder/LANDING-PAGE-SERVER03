(() => {
'use strict';
// ATLAS GESTÃO – versão sem servidor. Dados salvos no localStorage deste navegador.
const KEY = 'atlas_gestao_v1', $ = id => document.getElementById(id);
const MODS = {
  despesas:     { title: 'Despesas', fields: [['desc','Descrição','text'],['valor','Valor (R$)','number'],['venc','Vencimento','date']], sum: 'valor', date: 'venc', soon: 7, flag: 'Pago' },
  documentos:   { title: 'Documentos', fields: [['nome','Nome do documento','text'],['tipo','Tipo','text'],['validade','Validade','date']], date: 'validade', soon: 30 },
  funcionarios: { title: 'Funcionários', fields: [['nome','Nome','text'],['cargo','Cargo','text'],['salario','Salário (R$)','number']], sum: 'salario' },
  notas:        { title: 'Notas fiscais', fields: [['numero','Número','text'],['cliente','Cliente / fornecedor','text'],['valor','Valor (R$)','number']], sum: 'valor', flag: 'Paga' }
};
let mod = 'geral', cur = null, editing = null, memStore = null;

/* ---------- armazenamento ---------- */
const load = () => { try { const t = localStorage.getItem(KEY); if (t) return JSON.parse(t); } catch (e) {} return memStore || { accounts: [], session: null, next: 1 }; };
const save = st => { memStore = st; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { alert('Não foi possível salvar neste navegador (armazenamento bloqueado ou cheio).'); } };
const acc = st => st.accounts.find(a => a.id === cur);

/* ---------- utilidades ---------- */
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const digits = s => String(s).replace(/\D/g, '');
const fmtCnpj = c => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmt = (v, type) => type === 'number' ? brl(Number(v) || 0) : type === 'date' && v ? v.split('-').reverse().join('/') : esc(v);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
function validCnpj(c) {
  c = digits(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = n => { const w = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let t = 0; for (let i = 0; i < n; i++) t += c[i] * w[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) == c[12] && dv(13) == c[13];
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function derive(pw, saltHex) {
  if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error('Este navegador não permite criptografia aqui. Abra o site por HTTPS ou localhost.'));
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
    .then(k => crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, k, 256)).then(hex);
}
function status(M, r) {           // 'late' | 'soon' | null
  if (!M.date || !r[M.date] || r.ok) return null;
  if (r[M.date] < iso(new Date())) return 'late';
  return r[M.date] <= inDays(M.soon) ? 'soon' : null;
}
const badge = st => st === 'late' ? '<span class="badge late">Vencido</span>' : st === 'soon' ? '<span class="badge soon">Vence em breve</span>' : '';

/* ---------- autenticação ---------- */
const msg = (t, ok) => { const b = $('authMessage'); b.textContent = t; b.className = 'authmessage show' + (ok ? ' ok' : ''); };
const clearMsg = () => { const b = $('authMessage'); b.textContent = ''; b.className = 'authmessage'; };
function authMode(m) { clearMsg(); const l = m === 'login'; $('loginView').style.display = l ? 'block' : 'none'; $('registerView').style.display = l ? 'none' : 'block'; $('loginTab').classList.toggle('active', l); $('registerTab').classList.toggle('active', !l); }
const openAuth = m => { authMode(m); $('authScreen').classList.add('open'); };
const closeAuth = () => $('authScreen').classList.remove('open');
document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => openAuth(b.dataset.auth)));
$('closeAuth').addEventListener('click', closeAuth);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAuth(); });
$('loginTab').addEventListener('click', () => authMode('login'));
$('registerTab').addEventListener('click', () => authMode('register'));

function enter(a) {
  cur = a.id; closeAuth(); $('landing').style.display = 'none'; $('mainApp').classList.add('open');
  $('activeCompanyName').textContent = a.company; $('activeCompanyCnpj').textContent = fmtCnpj(a.cnpj); setMod('geral');
}
function leave() { cur = null; const st = load(); st.session = null; save(st); $('mainApp').classList.remove('open'); $('landing').style.display = 'block'; $('loginPassword').value = ''; window.scrollTo(0, 0); }

$('registerForm').addEventListener('submit', e => {
  e.preventDefault(); clearMsg();
  const company = $('regCompany').value.trim(), cnpj = digits($('regCnpj').value), email = $('regEmail').value.trim().toLowerCase(), pw = $('regPassword').value;
  if (pw !== $('regConfirm').value) return msg('As senhas não coincidem. Confira os dois campos.');
  if (pw.length < 8) return msg('A senha precisa ter ao menos 8 caracteres.');
  if (!validCnpj(cnpj)) return msg('CNPJ inválido. Confira os 14 dígitos.');
  if (load().accounts.some(a => a.email === email || a.cnpj === cnpj)) return msg('Já existe uma conta com esse e-mail ou CNPJ neste navegador.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  derive(pw, salt).then(h => {
    const st = load(), data = {}; Object.keys(MODS).forEach(k => data[k] = []);
    st.accounts.push({ id: st.next++, company, cnpj, email, salt, hash: h, data, seq: 1 }); save(st);
    $('loginEmail').value = email; $('loginPassword').value = ''; authMode('login'); msg('Empresa cadastrada. Entre com o e-mail e a senha criados.', true);
  }).catch(x => msg(x.message));
});
$('loginForm').addEventListener('submit', e => {
  e.preventDefault(); clearMsg();
  const a = load().accounts.find(x => x.email === $('loginEmail').value.trim().toLowerCase());
  if (!a) return msg('E-mail ou senha incorretos.');
  derive($('loginPassword').value, a.salt).then(h => {
    if (h !== a.hash) return msg('E-mail ou senha incorretos.');
    const st = load(); st.session = a.id; save(st); enter(a);
  }).catch(x => msg(x.message));
});
$('logoutBtn').addEventListener('click', leave);

/* ---------- backup ---------- */
$('backupBtn').addEventListener('click', () => {
  const a = acc(load()); if (!a) return;
  const blob = new Blob([JSON.stringify({ empresa: a.company, cnpj: a.cnpj, exportado_em: new Date().toISOString(), dados: a.data }, null, 2)], { type: 'application/json' });
  const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'backup-' + a.cnpj + '.json';
  document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(l.href), 1000);
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  f.text().then(t => {
    let o; try { o = JSON.parse(t); } catch (x) { return alert('Arquivo inválido: não é um backup do ATLAS.'); }
    const st = load(), a = acc(st);
    if (!o || !o.dados || o.cnpj !== a.cnpj) return alert('Este backup é de outra empresa ou está em formato inválido.');
    if (!confirm('Importar vai substituir os dados atuais desta empresa. Continuar?')) return;
    Object.keys(MODS).forEach(k => {
      const M = MODS[k], list = Array.isArray(o.dados[k]) ? o.dados[k].slice(0, 5000) : [];
      a.data[k] = list.map(r => { const n = { id: a.seq++, ok: !!r.ok }; M.fields.forEach(([key,,type]) => n[key] = type === 'number' ? Math.max(0, Number(r[key]) || 0) : String(r[key] ?? '').slice(0, 200)); return n; });
    });
    save(st); setMod(mod);
  });
});

/* ---------- painel ---------- */
document.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => setMod(b.dataset.mod)));
function setMod(m) {
  mod = m; editing = null; $('search').value = '';
  document.querySelectorAll('[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === m));
  const g = m === 'geral'; $('modTitle').textContent = g ? 'Visão geral' : MODS[m].title;
  $('addForm').style.display = g ? 'none' : ''; $('searchRow').style.display = g ? 'none' : '';
  renderForm(); renderTable();
}
const stat = (label, val) => `<div class="stat"><span>${label}</span><b>${val}</b></div>`;

function renderForm() {
  if (mod === 'geral') { $('addForm').innerHTML = ''; return; }
  const M = MODS[mod], r = editing ? acc(load()).data[mod].find(x => x.id === editing) || {} : {};
  $('addForm').innerHTML = M.fields.map(([k, label, type]) =>
    `<input name="${k}" type="${type}" placeholder="${label}" aria-label="${label}" value="${esc(r[k] ?? '')}" required${type === 'number' ? ' step="0.01" min="0"' : ''}>`).join('')
    + `<button class="btn" type="submit">${editing ? 'Salvar alterações' : 'Adicionar'}</button>`
    + (editing ? '<button class="btn ghost" type="button" id="cancelEdit">Cancelar</button>' : '');
  const c = $('cancelEdit'); if (c) c.addEventListener('click', () => { editing = null; renderForm(); });
}

function renderTable() {
  const a = acc(load());
  if (mod === 'geral') {
    const d = a.data, pend = [];
    let aberto = 0, nAberto = 0, atras = 0;
    ['despesas', 'documentos'].forEach(k => d[k].forEach(r => { const s = status(MODS[k], r); if (s) { pend.push({ k, r, s }); if (s === 'late') atras++; } }));
    d.despesas.forEach(r => { if (!r.ok) aberto += Number(r.valor) || 0; });
    d.notas.forEach(r => { if (!r.ok) nAberto += Number(r.valor) || 0; });
    const folha = d.funcionarios.reduce((s, r) => s + (Number(r.salario) || 0), 0);
    $('stats').innerHTML = stat('Despesas em aberto', brl(aberto)) + stat('Notas a receber/pagar', brl(nAberto)) + stat('Funcionários', d.funcionarios.length + ' · ' + brl(folha)) + stat('Itens vencidos', atras);
    pend.sort((x, y) => x.r[MODS[x.k].date].localeCompare(y.r[MODS[y.k].date]));
    $('tableBox').innerHTML = '<h3 class="subt">Vencimentos e pendências</h3>' + (pend.length
      ? '<table><thead><tr><th>Módulo</th><th>Item</th><th>Data</th><th>Situação</th></tr></thead><tbody>' + pend.map(({ k, r, s }) => { const M = MODS[k]; return `<tr><td>${M.title}</td><td>${esc(r[M.fields[0][0]])}</td><td>${fmt(r[M.date], 'date')}</td><td>${badge(s)}</td></tr>`; }).join('') + '</tbody></table>'
      : '<p class="empty">Nenhuma pendência. Tudo em dia.</p>');
    return;
  }
  const M = MODS[mod], q = $('search').value.trim().toLowerCase(), all = a.data[mod];
  const rows = q ? all.filter(r => M.fields.some(([k]) => String(r[k]).toLowerCase().includes(q))) : all;
  const total = M.sum ? all.filter(r => !M.flag || !r.ok).reduce((s, r) => s + (Number(r[M.sum]) || 0), 0) : all.length;
  $('stats').innerHTML = stat('Registros', all.length) + stat(M.flag ? 'Total em aberto' : M.sum ? 'Total' : 'Cadastrados', M.sum ? brl(total) : all.length);
  const sit = M.flag || M.date;
  $('tableBox').innerHTML = rows.length
    ? '<table><thead><tr>' + M.fields.map(f => `<th>${f[1]}</th>`).join('') + (sit ? '<th>Situação</th>' : '') + '<th></th></tr></thead><tbody>'
      + rows.map(r => '<tr>' + M.fields.map(([k,, t]) => `<td>${fmt(r[k], t)}</td>`).join('')
        + (sit ? `<td>${M.flag ? `<label><input type="checkbox" data-ok="${r.id}"${r.ok ? ' checked' : ''}> ${M.flag}</label>` : ''}${badge(status(M, r))}</td>` : '')
        + `<td><button class="edit" data-edit="${r.id}" type="button">Editar</button><button data-del="${r.id}" type="button">Remover</button></td></tr>`).join('') + '</tbody></table>'
    : `<p class="empty">${q ? 'Nada encontrado para essa busca.' : 'Nenhum registro ainda. Adicione o primeiro acima.'}</p>`;
}

$('search').addEventListener('input', renderTable);
$('tableBox').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), ed = e.target.closest('[data-edit]');
  if (del && confirm('Remover este registro?')) { const st = load(), a = acc(st); a.data[mod] = a.data[mod].filter(r => r.id !== +del.dataset.del); save(st); if (editing === +del.dataset.del) editing = null; renderForm(); renderTable(); }
  if (ed) { editing = +ed.dataset.edit; renderForm(); $('addForm').scrollIntoView({ block: 'nearest' }); }
});
$('tableBox').addEventListener('change', e => {
  const c = e.target.closest('[data-ok]'); if (!c) return;
  const st = load(), r = acc(st).data[mod].find(x => x.id === +c.dataset.ok); if (r) { r.ok = c.checked; save(st); renderTable(); }
});
$('addForm').addEventListener('submit', e => {
  e.preventDefault(); const st = load(), a = acc(st), list = a.data[mod];
  const vals = {}; MODS[mod].fields.forEach(([k,, t]) => { const v = e.target.elements[k].value; vals[k] = t === 'number' ? Math.max(0, Number(v) || 0) : String(v).slice(0, 200); });
  if (editing) { const r = list.find(x => x.id === editing); if (r) Object.assign(r, vals); editing = null; }
  else list.push({ id: a.seq++, ok: false, ...vals });
  save(st); renderForm(); renderTable();
});

/* retoma a sessão ao recarregar */
const s0 = load(), a0 = s0.accounts.find(x => x.id === s0.session); if (a0) enter(a0);
})();
