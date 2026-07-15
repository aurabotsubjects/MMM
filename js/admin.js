let adminProfile = null;
let teachersCache = [];

async function adminInit(profile) {
    adminProfile = profile;
    document.getElementById('adminName').textContent = profile.display_name || profile.email;
    await refreshTeacherList();
}

async function refreshTeacherList() {
    const pendingBody = document.getElementById('pendingTableBody');
    const teacherBody = document.getElementById('teacherTableBody');
    pendingBody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-muted);">Loading…</td></tr>';
    teacherBody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Loading…</td></tr>';

    const { data, error } = await sb
        .from('profiles')
        .select('id,email,display_name,class_name,class_code,status,created_at')
        .eq('role', 'teacher')
        .order('created_at', { ascending: false });

    if (error) {
        pendingBody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:#dc3545;">${escapeHtml(error.message)}</td></tr>`;
        teacherBody.innerHTML = '';
        return;
    }

    teachersCache = data || [];
    renderPendingList(teachersCache.filter(t => t.status === 'pending'));
    renderTeacherList(teachersCache.filter(t => t.status !== 'pending'));
}

function renderPendingList(pending) {
    const tbody = document.getElementById('pendingTableBody');
    const section = document.getElementById('pendingSection');
    section.style.display = pending.length > 0 ? '' : 'none';
    if (pending.length === 0) { tbody.innerHTML = ''; return; }

    tbody.innerHTML = '';
    pending.forEach(t => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(t.display_name)}</strong><br><span style="color:var(--text-muted);font-size:12px;">${escapeHtml(t.email)}</span></td>
            <td>${escapeHtml(t.class_name || '—')}</td>
            <td style="min-width:170px;">
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    <button class="btn btn-primary" style="font-size:12px;padding:6px 12px;" onclick="approveTeacher('${t.id}')">✓ Approve</button>
                    <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="declineTeacher('${t.id}')">✗ Decline</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTeacherList(teachers) {
    const tbody = document.getElementById('teacherTableBody');
    if (teachers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">No approved teacher accounts yet.</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    teachers.forEach(t => {
        const statusBadge = t.status === 'rejected'
            ? '<span style="color:#dc3545;font-weight:800;font-size:11px;">DECLINED</span>'
            : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(t.display_name)}</strong> ${statusBadge}<br><span style="color:var(--text-muted);font-size:12px;">${escapeHtml(t.email)}</span></td>
            <td>${escapeHtml(t.class_name || '—')}</td>
            <td><span class="code-value">${escapeHtml(t.class_code || '—')}</span></td>
            <td>${new Date(t.created_at).toLocaleDateString()}</td>
            <td style="min-width:130px;">
                <div style="display:flex;flex-wrap:wrap;gap:2px;">
                    <button class="icon-btn" title="Rename / edit class" onclick="openEditTeacher('${t.id}')">✏️</button>
                    <button class="icon-btn" title="Send password reset email" onclick="sendResetEmail('${escapeHtml(t.email)}')">📧</button>
                    <button class="icon-btn" title="Regenerate class code" onclick="regenerateCode('${t.id}')">🔄</button>
                    <button class="icon-btn" title="Remove access" onclick="deleteTeacher('${t.id}', '${escapeHtml(t.display_name)}')">🗑️</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

async function approveTeacher(id) {
    const { error } = await sb.from('profiles').update({ status: 'approved' }).eq('id', id);
    if (error) { showAdminToast(error.message, false); return; }
    showAdminToast('Teacher approved');
    await refreshTeacherList();
}

function declineTeacher(id) {
    if (!confirm('Decline this account request?')) return;
    (async () => {
        const { error } = await sb.from('profiles').update({ status: 'rejected' }).eq('id', id);
        if (error) { showAdminToast(error.message, false); return; }
        showAdminToast('Request declined');
        await refreshTeacherList();
    })();
}

function openEditTeacher(id) {
    const t = teachersCache.find(x => x.id === id);
    if (!t) return;
    const display_name = prompt('Teacher name:', t.display_name);
    if (display_name === null) return;
    const class_name = prompt('Class name:', t.class_name);
    if (class_name === null) return;
    (async () => {
        const { error } = await sb.from('profiles').update({ display_name, class_name }).eq('id', id);
        if (error) { showAdminToast(error.message, false); return; }
        showAdminToast('Teacher updated');
        await refreshTeacherList();
    })();
}

async function sendResetEmail(email) {
    const { error } = await mmmResetPassword(email);
    if (error) { showAdminToast(error.message, false); return; }
    showAdminToast(`Password reset email sent to ${email}`);
}

function regenerateCode(id) {
    if (!confirm('Generate a new class code for this teacher? The old code will stop working immediately.')) return;
    (async () => {
        let newCode = mmmGenerateClassCode(), lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            const { error } = await sb.from('profiles').update({ class_code: newCode }).eq('id', id);
            lastErr = error;
            if (!error) break;
            newCode = mmmGenerateClassCode();
        }
        if (lastErr) { showAdminToast(lastErr.message, false); return; }
        showAdminToast('Class code regenerated');
        await refreshTeacherList();
    })();
}

function deleteTeacher(id, name) {
    if (!confirm(`Remove ${name}'s access to MMM Classroom Tools? Their students and scores will also be removed. (Their login itself stays in Supabase — remove it from Authentication → Users there too if you want it fully gone.)`)) return;
    (async () => {
        const { error } = await sb.from('profiles').delete().eq('id', id);
        if (error) { showAdminToast(error.message, false); return; }
        showAdminToast('Teacher access removed');
        await refreshTeacherList();
    })();
}

async function changeAdminPassword() {
    const input = document.getElementById('adminNewPassword');
    const np = input.value;
    if (!np) { showAdminToast('Enter a new password first', false); return; }
    if (np.length < 6) { showAdminToast('Password must be at least 6 characters', false); return; }
    const { error } = await sb.auth.updateUser({ password: np });
    if (error) { showAdminToast(error.message, false); return; }
    showAdminToast('Password updated');
    input.value = '';
}

function showAdminToast(msg, green = true) {
    const t = document.getElementById('adminToast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (green ? ' green' : '');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}
