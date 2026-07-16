// ─────────────────────────────────────────
//  SHARED STATE
// ─────────────────────────────────────────
const CONFIGS = {
    skills: {
        // path inside the R2 bucket
        r2Path: 'MMM/MMM Skills for Printing.pdf',
        mapping: "8:1,9:2,10:3,11:4,12:5,13:6,14:7,15:8,16:9,17:10,18:11,19:13,20:15,21:17,22:19,23:21,24:22,25:23,26:24,27:25,28:26,29:27,30:28,31:29,32:30,33:31,34:32,35:33,36:34,37:35,38:36,39:37,40:38,41:39,42:40,43:41,44:42,45:43,46:44,47:45,48:46,49:47,50:48",
        footer: 'Pages selected from "MMM Skills for Printing.pdf"',
        downloadName: 'Custom_MMM_Skills.pdf'
    },
    tests: {
        r2Path: 'MMM/Mad Math Minute Tests.pdf',
        mapping: "8_9:1,10_11:2,12_13:3,14_15:4,16_17:5,18_19:6,20_21:7,22_23:8,24_25:9,26_27:10,28_29:11,30_31:12,32_33:13,34_35:14,36_37:15,38_39:16,40_41:17,42_43:18,44_45:19,46_47:20,48_49:21,50_50:22",
        footer: 'Pages selected from "Mad Math Minute Tests.pdf"',
        downloadName: 'Custom_MMM_Tests.pdf'
    }
};

const colorMap = {
    1:'orange',2:'orange',3:'orange',4:'orange',5:'orange',
    6:'orange',7:'orange',8:'orange',9:'green',10:'green',
    11:'green',12:'green',13:'green',14:'green',15:'green',
    16:'blue',17:'blue',18:'blue',19:'blue',20:'blue',
    21:'blue',22:'blue',23:'blue',24:'blue',25:'blue',
    26:'blue',27:'blue',28:'blue',29:'yellow',30:'yellow',
    31:'yellow',32:'yellow',33:'yellow',34:'yellow',35:'yellow',
    36:'yellow',37:'yellow',38:'purple',39:'purple',40:'purple',
    41:'purple',42:'purple',43:'purple',44:'purple',45:'purple',
    46:'purple',47:'purple',48:'purple',49:'purple',50:'purple'
};

let currentProfile = null;   // signed-in teacher's profile row
let students = [];           // [{id, name, position, is_basic_facts, basic_facts_term, basic_facts_week}]
let scoreRecords = {};       // { studentName: [{id, date, skill, score, advanced}, ...] }
let basicFactsAttempts = {}; // { studentId: [{id, term, week, correct, attempted, time_seconds, timed_out, attempted_at}, ...] }
let bfPreviewTerm = null;
let bfPreviewWeek = null;

let selectedStudent = null;  // index into students[] for the tracker modal
let clickTimer = null;
let clickCount = 0;

// print state
let currentPrintType = 'skills';
let trackerDocType = 'skills';
let originalPdfBytes = null;
let activeSkillsData = [];

// ─────────────────────────────────────────
//  APP INIT (called from index.html after login)
// ─────────────────────────────────────────
async function initApp(profile) {
    currentProfile = profile;
    document.getElementById('headerTeacherName').textContent = profile.display_name || profile.email;
    document.getElementById('headerClassName').textContent = profile.class_name || '';
    document.getElementById('headerClassCode').textContent = profile.class_code || '—';

    await loadStudents();
    await loadScores();
    await loadBasicFactsAttempts();
    initBoard();
    setPrintDocType('skills');
    populateScoreSelects();
    renderScoresTable();
    renderScoreCards();
    initBasicFactsTab();
}

// ─────────────────────────────────────────
//  DATA LOADING (Supabase)
// ─────────────────────────────────────────
async function loadStudents() {
    const { data, error } = await sb
        .from('students')
        .select('id, name, position, is_basic_facts, basic_facts_term, basic_facts_week')
        .eq('teacher_id', currentProfile.id)
        .order('position', { ascending: true });
    if (error) { console.error(error); showToast('Could not load students'); return; }
    students = data || [];
}

async function loadScores() {
    const { data, error } = await sb
        .from('score_records')
        .select('id, student_id, student_name, test_date, skill, score, advanced')
        .eq('teacher_id', currentProfile.id)
        .order('test_date', { ascending: true });
    if (error) { console.error(error); showToast('Could not load scores'); return; }
    scoreRecords = {};
    (data || []).forEach(r => {
        if (!scoreRecords[r.student_name]) scoreRecords[r.student_name] = [];
        scoreRecords[r.student_name].push({
            id: r.id, date: r.test_date, skill: r.skill, score: r.score, advanced: r.advanced
        });
    });
}

async function loadBasicFactsAttempts() {
    const { data, error } = await sb
        .from('basic_facts_attempts')
        .select('id, student_id, term, week, correct, attempted, time_seconds, timed_out, attempted_at')
        .eq('teacher_id', currentProfile.id)
        .order('attempted_at', { ascending: true });
    if (error) { console.error(error); showToast('Could not load Basic Facts history'); return; }
    basicFactsAttempts = {};
    (data || []).forEach(a => {
        if (!basicFactsAttempts[a.student_id]) basicFactsAttempts[a.student_id] = [];
        basicFactsAttempts[a.student_id].push(a);
    });
}

// ─────────────────────────────────────────
//  STUDENT TRACKER (board)
// ─────────────────────────────────────────
function initBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';
    for (let i = 1; i <= 50; i++) {
        const sq = document.createElement('div');
        sq.className = `square ${colorMap[i]}`;
        if (i === 20) sq.classList.add('unavailable');
        sq.dataset.position = i;

        const num = document.createElement('div');
        num.className = 'square-number';
        num.textContent = i;
        sq.appendChild(num);

        const sc = document.createElement('div');
        sc.className = 'students-container';
        sq.appendChild(sc);

        board.appendChild(sq);
    }
    renderStudents();
}

function renderStudents() {
    document.querySelectorAll('.students-container').forEach(c => c.innerHTML = '');
    students.forEach((student, index) => {
        if (student.is_basic_facts) return; // shown in the Basic Facts tab instead
        const container = document.querySelector(`[data-position="${student.position}"] .students-container`);
        if (container) {
            const label = document.createElement('div');
            label.className = 'student-label';
            label.textContent = student.name;
            label.dataset.studentIndex = index;
            label.addEventListener('click', e => handleStudentClick(e, index));
            container.appendChild(label);
        }
    });
    updatePrintBadge();
}

function handleStudentClick(e, idx) {
    e.stopPropagation();
    clickCount++;
    if (clickCount === 1) {
        clickTimer = setTimeout(() => {
            showStudentOptions(idx);
            clickCount = 0;
        }, 250);
    } else if (clickCount === 2) {
        clearTimeout(clickTimer);
        advanceStudent(idx);
        clickCount = 0;
    }
}

async function advanceStudent(idx) {
    const s = students[idx];
    let newPos = s.position + 1;
    if (newPos === 20) newPos++;
    if (newPos > 50) {
        await moveStudentToBasicFactsById(s.id);
    } else {
        s.position = newPos;
        await updateStudentRow(s.id, { position: newPos });
    }
    renderStudents();
}

function showStudentOptions(idx) {
    selectedStudent = idx;
    const s = students[idx];
    document.getElementById('modalTitle').textContent = `${s.name}  ·  Position ${s.position}`;
    document.getElementById('positionSelector').style.display = 'none';
    document.getElementById('renameSection').style.display = 'none';
    document.getElementById('modal').classList.add('active');
}

function showRename() {
    document.getElementById('renameSection').style.display = 'block';
    document.getElementById('positionSelector').style.display = 'none';
    document.getElementById('newName').value = students[selectedStudent].name;
    document.getElementById('newName').focus();
}

async function renameStudent() {
    const n = document.getElementById('newName').value.trim();
    if (!n) { alert('Please enter a name'); return; }
    const s = students[selectedStudent];
    s.name = n;
    await updateStudentRow(s.id, { name: n });
    renderStudents();
    closeModal();
}

function showManualPlacement() {
    document.getElementById('positionSelector').style.display = 'block';
    document.getElementById('manualPosition').value = students[selectedStudent].position;
}

async function moveToPosition() {
    const p = parseInt(document.getElementById('manualPosition').value);
    if (p >= 1 && p <= 50) {
        const s = students[selectedStudent];
        s.position = p;
        await updateStudentRow(s.id, { position: p });
        renderStudents();
        closeModal();
    } else alert('Please enter a position between 1 and 50');
}

async function deleteStudent() {
    const s = students[selectedStudent];
    if (confirm(`Delete ${s.name}?`)) {
        await deleteStudentRow(s.id);
        students.splice(selectedStudent, 1);
        renderStudents();
        closeModal();
    }
}

async function moveStudentToBasicFacts() {
    const s = students[selectedStudent];
    if (!confirm(`Move ${s.name} to Basic Facts? They'll come off the skill board and appear in the Basic Facts tab instead.`)) return;
    const ok = await moveStudentToBasicFactsById(s.id);
    await loadStudents();       // refetch to guarantee the UI matches the database
    await loadBasicFactsAttempts();
    renderStudents();
    closeModal();
    renderBfRoster();
    showToast(ok ? `${s.name} moved to Basic Facts` : `Could not move ${s.name} — please try again`, ok);
}

// Shared by the manual "Move to Basic Facts" button and by auto-advancing
// past skill 50 — defaults a student onto Term 1, Week 1 unless they're
// already on Basic Facts (keeps whatever they were already assigned).
// Returns true/false so callers can confirm the save actually succeeded.
async function moveStudentToBasicFactsById(studentId) {
    const s = students.find(x => x.id === studentId);
    if (!s) return false;
    const patch = { is_basic_facts: true };
    if (!s.basic_facts_term) patch.basic_facts_term = 1;
    const termForWeek = patch.basic_facts_term || s.basic_facts_term;
    if (!s.basic_facts_week) patch.basic_facts_week = (bfWeeksForTerm(termForWeek)[0]) || 1;
    Object.assign(s, patch);
    return await updateStudentRow(s.id, patch);
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
    selectedStudent = null;
}

async function addNewStudent() {
    const input = document.getElementById('newStudentName');
    const name = input.value.trim();
    if (!name) return;
    const { data, error } = await sb
        .from('students')
        .insert({ teacher_id: currentProfile.id, name, position: 1 })
        .select('id, name, position')
        .single();
    if (error) { console.error(error); showToast('Could not add student'); return; }
    students.push(data);
    renderStudents();
    input.value = '';
}

// ─────────────────────────────────────────
//  IMPORT FROM THE OLD LOCAL VERSION (JSON export)
// ─────────────────────────────────────────
function handleImportFileChosen(event) {
    const file = event.target.files[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    importClassData(file);
}

async function importClassData(file) {
    let payload;
    try {
        const text = await file.text();
        payload = JSON.parse(text);
    } catch (err) {
        showToast('That file is not a valid export — could not read it');
        return;
    }

    const importStudents = Array.isArray(payload.students) ? payload.students : [];
    const importScores = payload.scoreRecords && typeof payload.scoreRecords === 'object' ? payload.scoreRecords : {};

    if (importStudents.length === 0) {
        showToast('No students found in that file');
        return;
    }

    const totalScores = Object.values(importScores).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    const ok = confirm(
        `Import ${importStudents.length} student${importStudents.length !== 1 ? 's' : ''} and ${totalScores} score record${totalScores !== 1 ? 's' : ''} into this class?\n\n` +
        `Students with a name matching someone already on your tracker will be matched up rather than duplicated, and only new score records will be added.`
    );
    if (!ok) return;

    let studentsAdded = 0, studentsMatched = 0, scoresAdded = 0, scoresSkipped = 0;

    for (const imp of importStudents) {
        const name = (imp && imp.name ? String(imp.name) : '').trim();
        if (!name) continue;
        const importedPosition = Math.min(50, Math.max(1, parseInt(imp.position) || 1));

        let studentId;
        const existing = students.find(s => s.name.toLowerCase() === name.toLowerCase());

        if (existing) {
            studentId = existing.id;
            studentsMatched++;
            if (existing.position !== importedPosition) {
                existing.position = importedPosition;
                await updateStudentRow(existing.id, { position: importedPosition });
            }
        } else {
            const { data: created, error } = await sb
                .from('students')
                .insert({ teacher_id: currentProfile.id, name, position: importedPosition })
                .select('id, name, position')
                .single();
            if (error) { console.error(error); continue; }
            students.push(created);
            studentId = created.id;
            studentsAdded++;
        }

        const records = Array.isArray(importScores[name]) ? importScores[name]
            : Array.isArray(importScores[imp.name]) ? importScores[imp.name] : [];
        const existingRecords = scoreRecords[name] || [];

        for (const rec of records) {
            if (!rec || !rec.date || typeof rec.score !== 'number') continue;
            const isDuplicate = existingRecords.some(r => r.date === rec.date && r.skill === rec.skill && r.score === rec.score);
            if (isDuplicate) { scoresSkipped++; continue; }

            const { data: insertedRec, error: recErr } = await sb
                .from('score_records')
                .insert({
                    teacher_id: currentProfile.id,
                    student_id: studentId,
                    student_name: name,
                    test_date: rec.date,
                    skill: parseInt(rec.skill) || importedPosition,
                    score: parseInt(rec.score),
                    advanced: !!rec.advanced
                })
                .select()
                .single();
            if (recErr) { console.error(recErr); continue; }

            if (!scoreRecords[name]) scoreRecords[name] = [];
            scoreRecords[name].push({
                id: insertedRec.id, date: insertedRec.test_date, skill: insertedRec.skill,
                score: insertedRec.score, advanced: insertedRec.advanced
            });
            scoreRecords[name].sort((a, b) => a.date.localeCompare(b.date));
            scoresAdded++;
        }
    }

    renderStudents();
    renderScoresGrid();

    showToast(
        `Imported: ${studentsAdded} new student${studentsAdded !== 1 ? 's' : ''}` +
        (studentsMatched > 0 ? `, ${studentsMatched} matched existing` : '') +
        `, ${scoresAdded} score${scoresAdded !== 1 ? 's' : ''} added` +
        (scoresSkipped > 0 ? `, ${scoresSkipped} duplicate${scoresSkipped !== 1 ? 's' : ''} skipped` : ''),
        true
    );
}

async function updateStudentRow(id, patch) {
    const { error } = await sb.from('students').update(patch).eq('id', id);
    if (error) { console.error(error); showToast('Could not save change'); return false; }
    return true;
}

async function deleteStudentRow(id) {
    const { error } = await sb.from('students').delete().eq('id', id);
    if (error) { console.error(error); showToast('Could not delete student'); }
}

document.addEventListener('DOMContentLoaded', () => {
    const nsn = document.getElementById('newStudentName');
    if (nsn) nsn.addEventListener('keypress', e => { if (e.key === 'Enter') addNewStudent(); });
    const nn = document.getElementById('newName');
    if (nn) nn.addEventListener('keypress', e => { if (e.key === 'Enter') renameStudent(); });
    const mp = document.getElementById('manualPosition');
    if (mp) mp.addEventListener('keypress', e => { if (e.key === 'Enter') moveToPosition(); });
    const modal = document.getElementById('modal');
    if (modal) modal.addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
});

// ─────────────────────────────────────────
//  TRACKER → PRINT INTEGRATION
// ─────────────────────────────────────────
function setTrackerDocType(type) {
    trackerDocType = type;
    document.getElementById('trackerDocSkills').classList.toggle('active', type === 'skills');
    document.getElementById('trackerDocTests').classList.toggle('active', type === 'tests');
}

function updatePrintBadge() {
    const positions = new Set(students.map(s => s.position));
    const badge = document.getElementById('print-badge');
    if (positions.size > 0) {
        badge.textContent = positions.size;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function sendToPrintTab() {
    setPrintDocType(trackerDocType);
    smartSelectFromTracker();
    switchTab('printing');
}

// ─────────────────────────────────────────
//  PRINTING TAB
// ─────────────────────────────────────────
function setPrintDocType(type) {
    currentPrintType = type;
    document.getElementById('printBtnSkills').classList.toggle('active', type === 'skills');
    document.getElementById('printBtnTests').classList.toggle('active', type === 'tests');
    document.getElementById('footer-text').textContent = CONFIGS[type].footer;
    originalPdfBytes = null;
    renderTable();
    attemptAutoLoad();
}

function buildSkillsData() {
    const mappingStr = CONFIGS[currentPrintType].mapping;
    return mappingStr.split(',').map(pair => {
        const [rawId, page] = pair.split(':');
        const label = rawId.replace('_', ' – ');
        const positions = rawId.split('_').map(Number);
        return { id: rawId, label, page: parseInt(page), positions };
    });
}

function renderTable() {
    const grid = document.getElementById('skills-grid');
    grid.innerHTML = '';
    activeSkillsData = buildSkillsData();

    const posStudents = {};
    students.forEach(s => {
        if (!posStudents[s.position]) posStudents[s.position] = [];
        posStudents[s.position].push(s.name);
    });

    activeSkillsData.forEach(item => {
        const studentsByPos = item.positions.map(pos => posStudents[pos] || []);
        const studentsHere = studentsByPos.flat();

        const autoCopies = currentPrintType === 'tests'
            ? Math.max(...studentsByPos.map(arr => arr.length))
            : studentsHere.length;

        const hasStudents = studentsHere.length > 0;
        const row = document.createElement('tr');
        if (hasStudents) row.classList.add('has-students');

        let studentChipsHtml;
        if (studentsHere.length === 0) {
            studentChipsHtml = `<span style="color:var(--text-muted);font-size:12px;">—</span>`;
        } else if (currentPrintType === 'tests' && item.positions.length > 1) {
            studentChipsHtml = studentsByPos.map((arr, i) => {
                if (arr.length === 0) return '';
                const skillNum = item.positions[i];
                return `<span style="font-size:10px;color:var(--text-muted);font-weight:700;margin-right:3px;">sk${skillNum}:</span>`
                    + arr.map(n => `<span class="student-chip">${n}</span>`).join('');
            }).filter(Boolean).join('<span style="margin:0 4px;color:var(--border);">│</span>');
            studentChipsHtml = `<div class="student-chips" style="align-items:center;">${studentChipsHtml}</div>`;
        } else {
            studentChipsHtml = `<div class="student-chips">${studentsHere.map(n => `<span class="student-chip">${n}</span>`).join('')}</div>`;
        }

        row.innerHTML = `
            <td><input type="checkbox" id="check-${item.id}" class="skill-check" ${hasStudents ? 'checked' : ''}></td>
            <td class="skill-name">${currentPrintType === 'skills' ? 'Skill ' : 'Skills '}${item.label}</td>
            <td>${studentChipsHtml}</td>
            <td class="page-num">pg. ${item.page}</td>
            <td><input type="number" id="qty-${item.id}" min="1" value="${Math.max(1, autoCopies)}" class="qty-input"></td>
        `;
        grid.appendChild(row);
    });
}

function smartSelectFromTracker() {
    renderTable();
    setTimeout(() => {
        const firstChecked = document.querySelector('#skills-grid tr.has-students');
        if (firstChecked) firstChecked.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    const banner = document.querySelector('.smart-banner');
    banner.style.transition = 'transform 0.15s';
    banner.style.transform = 'scale(1.01)';
    setTimeout(() => banner.style.transform = '', 300);
}

function selectAll() { document.querySelectorAll('.skill-check').forEach(cb => cb.checked = true); }
function deselectAll() { document.querySelectorAll('.skill-check').forEach(cb => cb.checked = false); }

function showError(msg) {
    const el = document.getElementById('error-msg');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
}

// Automatically pulls the correct PDF straight from R2's public URL —
// no manual file picking, no server involved.
async function attemptAutoLoad() {
    const path = CONFIGS[currentPrintType].r2Path;
    const statusEl = document.getElementById('pdf-status');
    statusEl.innerHTML = `Connecting to "${path.split('/').pop()}"…`;

    try {
        const url = `${window.MMM_CONFIG.R2_PUBLIC_URL}/${encodeURI(path)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch_failed');

        originalPdfBytes = await res.arrayBuffer();
        statusEl.innerHTML = `<span style="color:#5a8a3a;font-weight:700;">✓ Connected</span>`;
    } catch (err) {
        console.error(err);
        statusEl.innerHTML = `<span style="color:#dc3545;font-weight:700;">⚠ Could not reach the PDF source. Check your connection and try again.</span> <button class="btn btn-secondary" style="font-size:12px;margin-left:8px;" onclick="attemptAutoLoad()">Retry</button>`;
    }
}

async function generatePDF() {
    document.getElementById('error-msg').classList.add('hidden');

    if (!originalPdfBytes) { showError('The PDF source is not connected yet — try again in a moment.'); return; }

    const items = [];
    activeSkillsData.forEach(item => {
        if (document.getElementById(`check-${item.id}`)?.checked) {
            const qty = parseInt(document.getElementById(`qty-${item.id}`).value) || 1;
            items.push({ ...item, qty });
        }
    });

    if (items.length === 0) { showError('Select at least one skill!'); return; }

    const btn = document.getElementById('generate-btn');
    btn.textContent = 'Processing…';
    btn.disabled = true;

    try {
        items.sort((a, b) => a.page - b.page);
        const { PDFDocument } = PDFLib;
        const origPdf = await PDFDocument.load(originalPdfBytes);
        const newPdf = await PDFDocument.create();
        const total = origPdf.getPageCount();

        for (const item of items) {
            const pageIdx = item.page - 1;
            if (pageIdx >= 0 && pageIdx < total) {
                const indices = Array(item.qty).fill(pageIdx);
                const copied = await newPdf.copyPages(origPdf, indices);
                copied.forEach(p => newPdf.addPage(p));
            }
        }

        const bytes = await newPdf.save();
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

        document.getElementById('pdf-preview-frame').src = url;
        document.getElementById('download-btn').onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = CONFIGS[currentPrintType].downloadName;
            a.click();
        };
        document.getElementById('print-btn').onclick = () => {
            const frame = document.getElementById('pdf-preview-frame');
            try {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            } catch (err) {
                // Fallback: open the PDF in a new tab and print from there
                const printWin = window.open(url, '_blank');
                if (printWin) {
                    printWin.addEventListener('load', () => printWin.print());
                } else {
                    showError('Please allow pop-ups to print, or use Download instead.');
                }
            }
        };

        document.getElementById('pdf-overlay').classList.add('active');
    } catch (err) {
        console.error(err);
        showError('Error generating PDF.');
    } finally {
        btn.textContent = 'Generate PDF ↗';
        btn.disabled = false;
    }
}

function closePreview() {
    document.getElementById('pdf-overlay').classList.remove('active');
    document.getElementById('pdf-preview-frame').src = '';
}

// ─────────────────────────────────────────
//  TAB SWITCHING
// ─────────────────────────────────────────
function switchTab(tab) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('panel-' + tab).classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'scores') {
        populateScoreSelects();
        renderScoresTable();
        renderScoreCards();
    }
    if (tab === 'basicfacts') {
        renderBfRoster();
    }
}

// ═══════════════════════════════════════════
//  SCORES MODULE
// ═══════════════════════════════════════════

const COLOR_PALETTE = ['#e67e50','#8fb369','#6b9ac4','#8b7ba8','#f4a261','#2a9d8f','#e9c46a','#e76f51'];

function getStudentColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function getInitials(name) {
    return name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
}

function formatDate(iso) {
    if (!iso) return '—';
    const [y,m,d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

function showToast(msg, green=false) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast' + (green ? ' green' : '');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function populateScoreSelects() {
    const dateInput = document.getElementById('scoreDate');
    if (dateInput && !dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }
}

function renderScoresTable() {
    const tbody = document.getElementById('scores-table-body');
    if (!tbody) return;

    if (!students || students.filter(s => !s.is_basic_facts).length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted);">No students on the tracker yet — add some in the Student Tracker tab.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    const sorted = students.filter(s => !s.is_basic_facts).sort((a,b) => a.name.localeCompare(b.name));
    sorted.forEach((student, rowIdx) => {
        const records = scoreRecords[student.name] || [];
        const scores  = records.map(r => r.score);
        const avg     = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
        const last    = records.length ? records[records.length-1].score + '/15' : '—';
        const color   = getStudentColor(student.name);
        const initials= getInitials(student.name);
        const skill   = student.position;

        const tr = document.createElement('tr');
        tr.innerHTML =
            '<td style="font-family:\'DM Mono\',monospace;color:var(--text-muted);font-size:12px;">' + (rowIdx+1) + '</td>' +
            '<td>' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<div style="width:30px;height:30px;border-radius:7px;background:' + color + ';display:flex;align-items:center;justify-content:center;color:white;font-weight:900;font-size:11px;flex-shrink:0;">' + initials + '</div>' +
                    '<span style="font-weight:700;">' + student.name + '</span>' +
                '</div>' +
            '</td>' +
            '<td>' +
                '<span style="display:inline-block;background:' + color + '22;color:' + color + ';' +
                      'border:1.5px solid ' + color + '44;border-radius:6px;padding:3px 10px;' +
                      'font-family:\'DM Mono\',monospace;font-size:13px;font-weight:800;">Skill ' + skill + '</span>' +
            '</td>' +
            '<td>' +
                '<input type="number" id="row-score-' + rowIdx + '" min="0" max="15" placeholder="—" ' +
                    'data-skill="' + skill + '" ' +
                    'style="width:64px;padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;' +
                           'font-family:\'DM Mono\',monospace;font-size:16px;text-align:center;' +
                           'background:var(--bg);color:var(--text);font-weight:700;" />' +
            '</td>' +
            '<td style="font-family:\'DM Mono\',monospace;font-size:13px;">' + last + '</td>' +
            '<td style="font-family:\'DM Mono\',monospace;font-size:13px;">' + avg + '</td>' +
            '<td style="font-family:\'DM Mono\',monospace;font-size:13px;">' + scores.length + '</td>' +
            '<td><button onclick="openStudentDetail(\'' + student.name.replace(/'/g,"\\'") + '\')" ' +
                        'style="background:none;border:none;cursor:pointer;font-size:16px;" title="View history">📊</button></td>';
        tbody.appendChild(tr);
    });

    sorted.forEach((student, rowIdx) => {
        const input = document.getElementById('row-score-' + rowIdx);
        if (!input) return;
        input.addEventListener('input', function() { highlightScoreInput(this); });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const next = document.getElementById('row-score-' + (rowIdx+1));
                if (next) next.focus(); else saveAllScores();
            }
        });
    });
}

function highlightScoreInput(input) {
    const v = parseInt(input.value);
    if (isNaN(v)) { input.style.borderColor='var(--border)'; input.style.background='var(--bg)'; return; }
    if (v === 15) { input.style.borderColor='#5a8a3a'; input.style.background='#d4edda'; }
    else if (v >= 12) { input.style.borderColor='#8fb369'; input.style.background='var(--bg)'; }
    else if (v >= 8)  { input.style.borderColor='#e6a817'; input.style.background='var(--bg)'; }
    else              { input.style.borderColor='#dc3545'; input.style.background='#fff0f0'; }
}

async function saveAllScores() {
    const dateEl = document.getElementById('scoreDate');
    const date   = dateEl ? dateEl.value : '';
    if (!date) { showToast('Please set a test date first'); return; }

    const snap = students.slice().sort((a,b) => a.name.localeCompare(b.name));
    const rowsToInsert = [];
    const advances = []; // {studentIdx, newPos}

    snap.forEach((student, rowIdx) => {
        const input = document.getElementById('row-score-' + rowIdx);
        if (!input || input.value === '') return;
        const score = parseInt(input.value);
        if (isNaN(score) || score < 0 || score > 15) return;

        const studentSkill = parseInt(input.getAttribute('data-skill')) || student.position;
        let didAdvance = false;

        if (score === 15) {
            const idx = students.findIndex(s => s.id === student.id);
            if (idx !== -1) {
                let newPos = students[idx].position + 1;
                if (newPos === 20) newPos++;
                didAdvance = true;
                advances.push({ idx, newPos });
            }
        }

        rowsToInsert.push({
            teacher_id: currentProfile.id,
            student_id: student.id,
            student_name: student.name,
            test_date: date,
            skill: studentSkill,
            score,
            advanced: didAdvance
        });
    });

    if (rowsToInsert.length === 0) { showToast('No scores entered — type at least one score'); return; }

    const { data: inserted, error } = await sb.from('score_records').insert(rowsToInsert).select();
    if (error) { console.error(error); showToast('Could not save scores'); return; }

    // apply advances (and Basic Facts promotion for anyone who passed position 50)
    // in the database, then reload the authoritative list to avoid any local index drift
    for (const adv of advances) {
        const s = students[adv.idx];
        if (adv.newPos > 50) {
            await moveStudentToBasicFactsById(s.id);
        } else {
            await updateStudentRow(s.id, { position: adv.newPos });
        }
    }
    await loadStudents();
    await loadBasicFactsAttempts();
    renderBfRoster();

    // update local scoreRecords cache
    (inserted || []).forEach(r => {
        if (!scoreRecords[r.student_name]) scoreRecords[r.student_name] = [];
        scoreRecords[r.student_name].push({ id: r.id, date: r.test_date, skill: r.skill, score: r.score, advanced: r.advanced });
        scoreRecords[r.student_name].sort((a,b) => a.date.localeCompare(b.date));
    });

    renderStudents();
    renderScoresGrid();

    const advancedCount = advances.length;
    const adv = advancedCount > 0 ? ' · 🎉 ' + advancedCount + ' student' + (advancedCount!==1?'s':'') + ' advanced!' : '';
    showToast('💾 ' + rowsToInsert.length + ' score' + (rowsToInsert.length!==1?'s':'') + ' saved' + adv, true);
}

function renderScoresGrid() {
    populateScoreSelects();
    renderScoresTable();
    renderScoreCards();
}

function renderScoreCards() {
    const grid    = document.getElementById('scores-grid');
    const section = document.getElementById('score-cards-section');
    if (!grid) return;
    grid.innerHTML = '';

    const allNames = [];
    students.forEach(s => { if (allNames.indexOf(s.name)<0) allNames.push(s.name); });
    Object.keys(scoreRecords).forEach(n => { if (allNames.indexOf(n)<0) allNames.push(n); });

    const withScores = allNames.filter(n => (scoreRecords[n]||[]).length > 0);
    if (section) section.style.display = withScores.length > 0 ? '' : 'none';

    allNames.forEach((name) => {
        const student = students.find(s => s.name===name);
        const records = scoreRecords[name] || [];
        if (records.length === 0) return;
        const color   = getStudentColor(name);
        const scores  = records.map(r => r.score);
        const avg     = (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1);
        const best    = Math.max(...scores);
        const perfects= scores.filter(s=>s===15).length;

        const card = document.createElement('div');
        card.className = 'student-card';
        card.onclick = () => openStudentDetail(name);

        const sparkHTML = records.length >= 2
            ? '<div class="card-sparkline"><canvas id="spark-' + name.replace(/\s/g,'_') + '" height="50"></canvas></div>'
            : '<div class="no-scores-note">First score recorded — keep going!</div>';

        card.innerHTML =
            '<div class="card-header">' +
                '<div class="card-avatar" style="background:' + color + '">' + getInitials(name) + '</div>' +
                '<div>' +
                    '<div class="card-name">' + name + '</div>' +
                    '<div class="card-pos">' + (student ? 'Position ' + student.position + ' · ' : '') + records.length + ' test' + (records.length!==1?'s':'') + '</div>' +
                '</div>' +
            '</div>' +
            '<div class="card-stats">' +
                '<div class="stat-item"><div class="stat-val">' + avg + '</div><div class="stat-lbl">Average</div></div>' +
                '<div class="stat-item"><div class="stat-val">' + best + '</div><div class="stat-lbl">Best</div></div>' +
                '<div class="stat-item"><div class="stat-val">' + perfects + '</div><div class="stat-lbl">Perfect</div></div>' +
            '</div>' +
            sparkHTML;
        grid.appendChild(card);

        if (records.length >= 2) {
            requestAnimationFrame(() => {
                const cv = document.getElementById('spark-' + name.replace(/\s/g,'_'));
                if (cv) drawSparkline(cv, records, color);
            });
        }
    });
}

function drawSparkline(canvas, records, color) {
    const w = canvas.offsetWidth || 248, h = 50;
    canvas.width = w*2; canvas.height = h*2;
    canvas.style.width = w+'px'; canvas.style.height = h+'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(2,2);
    const scores = records.map(r=>r.score);
    const pad = 6, xStep = (w-pad*2)/Math.max(scores.length-1,1);
    ctx.beginPath();
    scores.forEach((s,i)=>{ const x=pad+i*xStep,y=pad+(1-s/15)*(h-pad*2); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.lineTo(pad+(scores.length-1)*xStep,h-pad); ctx.lineTo(pad,h-pad); ctx.closePath();
    ctx.fillStyle=color+'22'; ctx.fill();
    ctx.beginPath();
    scores.forEach((s,i)=>{ const x=pad+i*xStep,y=pad+(1-s/15)*(h-pad*2); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
    scores.forEach((s,i)=>{
        const x=pad+i*xStep,y=pad+(1-s/15)*(h-pad*2);
        ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2);
        ctx.fillStyle=color; ctx.fill(); ctx.strokeStyle='white'; ctx.lineWidth=1.5; ctx.stroke();
    });
}

// ── Student Detail Modal ─────────────────────
let currentDetailStudent = null;

function openStudentDetail(name) {
    currentDetailStudent = name;
    const student = students.find(s=>s.name===name);
    const records = scoreRecords[name] || [];
    const color   = getStudentColor(name);
    const scores  = records.map(r=>r.score);
    const avg     = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
    const best    = scores.length ? Math.max(...scores) : '—';
    const perfects= scores.filter(s=>s===15).length;
    const trend   = scores.length>=2 ? (scores[scores.length-1]>=scores[scores.length-2]?'↑':'↓') : '—';

    document.getElementById('sdm-avatar').style.background = color;
    document.getElementById('sdm-avatar').textContent = getInitials(name);
    document.getElementById('sdm-name').textContent = name;
    document.getElementById('sdm-sub').textContent = student
        ? 'Position ' + student.position + ' · ' + records.length + ' test' + (records.length!==1?'s':'') + ' recorded'
        : records.length + ' tests recorded (removed from tracker)';

    document.getElementById('sdm-stats').innerHTML =
        '<div class="sdm-stat"><div class="val">' + avg + '</div><div class="lbl">Average</div></div>' +
        '<div class="sdm-stat"><div class="val">' + (best==='—'?'—':best+'/15') + '</div><div class="lbl">Best</div></div>' +
        '<div class="sdm-stat"><div class="val">' + perfects + '</div><div class="lbl">Perfect 15s</div></div>' +
        '<div class="sdm-stat"><div class="val" style="color:' + (trend==='↑'?'#5a8a3a':trend==='↓'?'#e05c3a':'#999') + '">' + trend + '</div><div class="lbl">Trend</div></div>';

    drawDetailChart(records, color);

    const tbody = document.getElementById('sdm-history-body');
    tbody.innerHTML = '';
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">No scores recorded yet</td></tr>';
    } else {
        const rev = records.slice().reverse();
        rev.forEach((rec, revIdx) => {
            const realIdx = records.length-1-revIdx;
            const cls = rec.score===15?'perfect':rec.score>=12?'high':rec.score>=8?'mid':'low';
            const result = rec.score===15?'🌟 Perfect!':rec.score>=12?'✅ Great':rec.score>=8?'👍 Good':'📚 Needs work';
            const adv = rec.advanced ? '<span class="advanced-badge">⬆ Advanced</span>' : '';
            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + formatDate(rec.date) + '</td>' +
                '<td>Skill ' + rec.skill + '</td>' +
                '<td><span class="score-pill ' + cls + '">' + rec.score + '/15</span>' + adv + '</td>' +
                '<td>' + result + '</td>' +
                '<td><button class="delete-score-btn" onclick="deleteScore(\'' + name.replace(/'/g,"\\'") + '\',' + realIdx + ')">✕</button></td>';
            tbody.appendChild(tr);
        });
    }

    document.getElementById('student-detail-overlay').classList.add('active');
}

function drawDetailChart(records, color) {
    const canvas = document.getElementById('sdm-chart');
    if (!canvas) return;
    const w = canvas.offsetWidth||580, h = 180;
    canvas.width=w*2; canvas.height=h*2; canvas.style.width=w+'px'; canvas.style.height=h+'px';
    const ctx=canvas.getContext('2d'); ctx.scale(2,2);
    const padL=36,padR=16,padT=16,padB=48,cw=w-padL-padR,ch=h-padT-padB;

    [0,5,10,15].forEach((v) => {
        const y=padT+ch*(1-v/15);
        ctx.beginPath(); ctx.strokeStyle=v===15?'#8fb36944':'#e0d8cc';
        ctx.lineWidth=v===15?1.5:1; ctx.setLineDash(v===15?[]:[3,3]);
        ctx.moveTo(padL,y); ctx.lineTo(padL+cw,y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font='10px "DM Mono",monospace'; ctx.fillStyle=v===15?'#5a8a3a':'#aaa';
        ctx.textAlign='right'; ctx.fillText(v,padL-6,y+4);
    });
    ctx.font='9px Nunito,sans-serif'; ctx.fillStyle='#5a8a3a'; ctx.textAlign='left';
    ctx.fillText('PASS',padL+4,padT+4);

    if (records.length===0) {
        ctx.font='14px Nunito,sans-serif'; ctx.fillStyle='#aaa'; ctx.textAlign='center';
        ctx.fillText('No scores yet',w/2,h/2); return;
    }

    const points=records.map(r=>({x:formatDate(r.date),y:r.score}));
    if (points.length===1) {
        const x=padL+cw/2,y=padT+ch*(1-points[0].y/15);
        ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); return;
    }
    const xStep=cw/(points.length-1);
    ctx.beginPath();
    points.forEach((p,i)=>{const x=padL+i*xStep,y=padT+ch*(1-p.y/15);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.lineTo(padL+(points.length-1)*xStep,padT+ch); ctx.lineTo(padL,padT+ch); ctx.closePath();
    ctx.fillStyle=color+'28'; ctx.fill();
    ctx.beginPath();
    points.forEach((p,i)=>{const x=padL+i*xStep,y=padT+ch*(1-p.y/15);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
    points.forEach((p,i)=>{
        const x=padL+i*xStep,y=padT+ch*(1-p.y/15);
        ctx.beginPath(); ctx.arc(x,y,p.y===15?6:4,0,Math.PI*2);
        ctx.fillStyle=p.y===15?'#5a8a3a':color; ctx.fill();
        ctx.strokeStyle='white'; ctx.lineWidth=2; ctx.stroke();
        ctx.font='bold 10px "DM Mono",monospace'; ctx.fillStyle=p.y===15?'#5a8a3a':color;
        ctx.textAlign='center'; ctx.fillText(p.y,x,y-9);
        ctx.font='9px Nunito,sans-serif'; ctx.fillStyle='#aaa';
        if (points.length>5) {
            ctx.save(); ctx.translate(x,padT+ch+14); ctx.rotate(-Math.PI/4);
            ctx.textAlign='right'; ctx.fillText(p.x,0,0); ctx.restore();
        } else { ctx.textAlign='center'; ctx.fillText(p.x,x,padT+ch+16); }
    });
}

function closeStudentDetail(e) {
    if (e && e.target !== document.getElementById('student-detail-overlay')) return;
    document.getElementById('student-detail-overlay').classList.remove('active');
    currentDetailStudent=null;
}

async function deleteScore(name, idx) {
    if(!confirm('Delete this score?')) return;
    const rec = (scoreRecords[name] || [])[idx];
    if (rec && rec.id) {
        const { error } = await sb.from('score_records').delete().eq('id', rec.id);
        if (error) { console.error(error); showToast('Could not delete score'); return; }
    }
    scoreRecords[name].splice(idx,1);
    renderScoresGrid();
    openStudentDetail(name);
}

// ── Print summaries ──────────────────────────
function buildSummaryHTML(name) {
    const student=students.find(s=>s.name===name);
    const records=scoreRecords[name]||[];
    const color=getStudentColor(name);
    const scores=records.map(r=>r.score);
    const avg=scores.length?(scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1):'—';
    const best=scores.length?Math.max(...scores):'—';
    const perfects=scores.filter(s=>s===15).length;
    const pos=student?student.position:'N/A';
    const today=new Date().toISOString().split('T')[0];
    const rows=records.slice().reverse().map((r) => {
        const res=r.score===15?'Perfect ★':r.score>=12?'Great':r.score>=8?'Good':'Needs work';
        return '<tr><td>'+formatDate(r.date)+'</td><td>Skill '+r.skill+'</td><td>'+r.score+'/15</td><td>'+res+(r.advanced?' (Advanced)':'')+'</td></tr>';
    }).join('');

    return '<div style="font-family:Nunito,sans-serif;padding:24px;max-width:700px;margin:0 auto;page-break-after:always;">' +
        '<div style="display:flex;align-items:center;gap:16px;border-bottom:3px solid '+color+';padding-bottom:16px;margin-bottom:20px;">' +
            '<div style="width:52px;height:52px;border-radius:12px;background:'+color+';display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:white;">'+getInitials(name)+'</div>' +
            '<div><div style="font-size:24px;font-weight:900;">'+name+'</div><div style="font-size:13px;color:#7a7060;">Position: '+pos+' · Generated '+formatDate(today)+'</div></div>' +
            '<div style="margin-left:auto;text-align:right;"><div style="font-size:11px;color:#aaa;">Mad Math Minute</div><div style="font-weight:800;">Student Progress</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">' +
            [['Average',avg],['Best',best+'/15'],['Tests',scores.length],['Perfect 15s',perfects]].map((pair) => {
                return '<div style="background:#f5f1e8;border-radius:10px;padding:12px;text-align:center;"><div style="font-size:22px;font-weight:900;font-family:monospace;">'+pair[1]+'</div><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#7a7060;">'+pair[0]+'</div></div>';
            }).join('') +
        '</div>' +
        (records.length>0 ? '<div style="background:#f5f1e8;border-radius:10px;padding:16px;margin-bottom:20px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:#7a7060;margin-bottom:12px;">Score Progress</div><canvas id="pchart-'+name.replace(/\s/g,'_')+'" style="width:100%;height:140px;display:block;"></canvas></div>' : '') +
        (records.length>0 ? '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f5f1e8;"><th style="text-align:left;padding:7px 10px;">Date</th><th style="text-align:left;padding:7px 10px;">Skill</th><th style="text-align:left;padding:7px 10px;">Score</th><th style="text-align:left;padding:7px 10px;">Result</th></tr></thead><tbody>'+rows+'</tbody></table>' : '<p style="color:#aaa;text-align:center;">No scores recorded yet</p>') +
    '</div>';
}

function printStudentSummary() {
    if(!currentDetailStudent) return;
    _doPrint([currentDetailStudent]);
}

function printAllSummaries() {
    const names=[];
    students.forEach(s=>{if(names.indexOf(s.name)<0)names.push(s.name);});
    Object.keys(scoreRecords).forEach(n=>{if(names.indexOf(n)<0)names.push(n);});
    _doPrint(names);
}

function _doPrint(names) {
    const colorMapForPrint={};
    names.forEach(n=>{colorMapForPrint[n]=getStudentColor(n);});
    const win=window.open('','_blank');
    win.document.write('<!DOCTYPE html><html><head><title>MMM Summaries</title>' +
        '<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap" rel="stylesheet">' +
        '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Nunito,sans-serif;}table td{border-bottom:1px solid #e0d8cc;padding:7px 10px;}@media print{@page{margin:16mm;}}</style>' +
        '</head><body>' + names.map(n=>buildSummaryHTML(n)).join('') +
        '<script>window.onload=function(){' +
            'var colorMap='+JSON.stringify(colorMapForPrint)+';' +
            'var records='+JSON.stringify(scoreRecords)+';' +
            'document.querySelectorAll("canvas[id^=pchart-]").forEach(function(cv){' +
                'var name=cv.id.replace("pchart-","").replace(/_/g," ");' +
                'var recs=records[name]||[];var color=colorMap[name]||"#e67e50";' +
                'if(!recs.length)return;' +
                'var w=cv.offsetWidth||580,h=140;cv.width=w*2;cv.height=h*2;cv.style.width=w+"px";cv.style.height=h+"px";' +
                'var ctx=cv.getContext("2d");ctx.scale(2,2);' +
                'var padL=30,padR=12,padT=12,padB=30,cw=w-padL-padR,ch=h-padT-padB;' +
                '[0,5,10,15].forEach(function(v){var y=padT+ch*(1-v/15);ctx.beginPath();ctx.strokeStyle=v===15?"#8fb36966":"#e0d8cc";ctx.lineWidth=v===15?1.5:1;ctx.setLineDash(v===15?[]:[3,3]);ctx.moveTo(padL,y);ctx.lineTo(padL+cw,y);ctx.stroke();ctx.setLineDash([]);ctx.font="9px monospace";ctx.fillStyle=v===15?"#5a8a3a":"#aaa";ctx.textAlign="right";ctx.fillText(v,padL-4,y+3);});' +
                'if(recs.length===1){var x=padL+cw/2,y=padT+ch*(1-recs[0].score/15);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}' +
                'else{var xs=cw/(recs.length-1);ctx.beginPath();recs.forEach(function(r,i){var x=padL+i*xs,y=padT+ch*(1-r.score/15);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.lineTo(padL+(recs.length-1)*xs,padT+ch);ctx.lineTo(padL,padT+ch);ctx.closePath();ctx.fillStyle=color+"28";ctx.fill();ctx.beginPath();recs.forEach(function(r,i){var x=padL+i*xs,y=padT+ch*(1-r.score/15);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineJoin="round";ctx.stroke();recs.forEach(function(r,i){var x=padL+i*xs,y=padT+ch*(1-r.score/15);ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle=r.score===15?"#5a8a3a":color;ctx.fill();ctx.strokeStyle="white";ctx.lineWidth=1.5;ctx.stroke();ctx.font="bold 9px monospace";ctx.fillStyle=r.score===15?"#5a8a3a":color;ctx.textAlign="center";ctx.fillText(r.score,x,y-7);});}' +
            '});setTimeout(function(){window.print();},800);}' +
        '<\/script></body></html>');
    win.document.close();
}

// ═══════════════════════════════════════════
//  BASIC FACTS MODULE (teacher side)
// ═══════════════════════════════════════════

function bfWeeksForTerm(term) {
    if (!window.BASIC_FACTS_DATA || !BASIC_FACTS_DATA[term]) return [];
    return Object.keys(BASIC_FACTS_DATA[term]).map(Number).sort((a, b) => a - b);
}

function formatBfTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function initBasicFactsTab() {
    const tabsEl = document.getElementById('bfTermTabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    [1, 2, 3, 4].forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'doc-type-btn' + (t === 1 ? ' active' : '');
        btn.textContent = 'Term ' + t;
        btn.id = 'bfTermBtn' + t;
        btn.onclick = () => selectBfTerm(t);
        tabsEl.appendChild(btn);
    });
    selectBfTerm(1);
    renderBfRoster();
}

function selectBfTerm(term) {
    bfPreviewTerm = term;
    bfPreviewWeek = null;
    [1, 2, 3, 4].forEach(t => {
        const btn = document.getElementById('bfTermBtn' + t);
        if (btn) btn.classList.toggle('active', t === term);
    });
    const weekTabs = document.getElementById('bfWeekTabs');
    weekTabs.innerHTML = '';
    bfWeeksForTerm(term).forEach(w => {
        const btn = document.createElement('button');
        btn.className = 'doc-type-btn';
        btn.textContent = 'Week ' + w;
        btn.id = 'bfWeekBtn' + w;
        btn.onclick = () => selectBfWeek(term, w);
        weekTabs.appendChild(btn);
    });
    document.getElementById('bfPreviewGrid').style.display = 'none';
}

function selectBfWeek(term, week) {
    bfPreviewTerm = term;
    bfPreviewWeek = week;
    bfWeeksForTerm(term).forEach(w => {
        const btn = document.getElementById('bfWeekBtn' + w);
        if (btn) btn.classList.toggle('active', w === week);
    });
    renderBfPreviewChips();
}

function renderBfPreviewChips() {
    const grid = document.getElementById('bfPreviewGrid');
    const chipsEl = document.getElementById('bfPreviewChips');
    if (!bfPreviewTerm || !bfPreviewWeek) { grid.style.display = 'none'; return; }
    const qs = BASIC_FACTS_DATA[bfPreviewTerm][bfPreviewWeek] || [];
    chipsEl.innerHTML = qs.map(q => `<span class="student-chip">${q.replace('x', '×')} =</span>`).join('');
    grid.style.display = 'block';
}

function previewStudentAssignedTest(studentId) {
    const s = students.find(x => x.id === studentId);
    if (!s || !s.basic_facts_term || !s.basic_facts_week) return;
    selectBfTerm(s.basic_facts_term);
    selectBfWeek(s.basic_facts_term, s.basic_facts_week);
    document.getElementById('bfPreviewGrid').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Worksheet building (no source PDF — generated straight from the question bank) ──
function buildBfWorksheetPage(term, week) {
    const qs = BASIC_FACTS_DATA[term][week];
    let rows = '';
    for (let r = 0; r < 10; r++) {
        let cells = '';
        for (let c = 0; c < 10; c++) {
            const idx = r * 10 + c;
            const q = qs[idx];
            cells += `<td><div class="ws-cell">
                <div class="ws-cell-num">${idx + 1}</div>
                <div class="ws-cell-q">${q.replace('x', '×')} =</div>
                <div class="ws-cell-ans"></div>
            </div></td>`;
        }
        rows += `<tr>${cells}</tr>`;
    }
    return `<div class="ws-page">
        <div class="ws-header">
            <div class="ws-title">Basic Facts — Term ${term}, Week ${week}</div>
            <div class="ws-meta">100 questions | 5 min</div>
        </div>
        <div class="ws-info-row">
            <span>Name: <span class="ws-info-line"></span></span>
            <span>Date: <span class="ws-info-line"></span></span>
            <span>Score: <span class="ws-info-line" style="width:60px"></span> / 100</span>
        </div>
        <table class="ws-table"><tbody>${rows}</tbody></table>
    </div>`;
}

const BF_WORKSHEET_STYLE = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Nunito', sans-serif; background: #fff; }
    @page { size: A4 portrait; margin: 10mm; }
    .ws-page { width: 100%; padding: 4mm; }
    .ws-header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2.5px solid #1e293b; padding-bottom: 4px; margin-bottom: 6px; }
    .ws-title { font-size: 14pt; font-weight: 900; color: #1e293b; }
    .ws-meta { font-size: 9pt; font-weight: 700; color: #64748b; }
    .ws-info-row { display: flex; gap: 20px; margin-bottom: 6px; font-size: 9pt; font-weight: 700; color: #64748b; }
    .ws-info-line { display: inline-block; width: 80px; border-bottom: 1.5px solid #94a3b8; vertical-align: middle; }
    .ws-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .ws-table td { width: 10%; padding: 0; vertical-align: top; }
    .ws-cell { margin: 1.5px; border: 1.5px solid #cbd5e1; border-radius: 4px; padding: 4px 4px 3px; }
    .ws-cell-num { font-size: 7pt; color: #94a3b8; font-weight: 700; line-height: 1; margin-bottom: 1px; }
    .ws-cell-q { font-size: 11pt; font-weight: 800; color: #1e293b; line-height: 1.2; }
    .ws-cell-ans { margin-top: 4px; border-bottom: 1.5px solid #94a3b8; height: 14px; }
`;

function printBasicFactsTest() {
    if (!bfPreviewTerm || !bfPreviewWeek) return;
    const page = buildBfWorksheetPage(bfPreviewTerm, bfPreviewWeek);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap" rel="stylesheet">
        <style>${BF_WORKSHEET_STYLE}</style></head><body>${page}</body></html>`;
    const frame = document.getElementById('bf-print-frame');
    frame.srcdoc = html;
    document.getElementById('bf-print-btn').onclick = () => {
        try {
            frame.contentWindow.focus();
            frame.contentWindow.print();
        } catch (err) {
            showToast('Could not open the print dialog — try again');
        }
    };
    document.getElementById('bf-print-overlay').classList.add('active');
}

function closeBfPrintPreview() {
    document.getElementById('bf-print-overlay').classList.remove('active');
}

// ── Roster ──────────────────────────────────
function renderBfRoster() {
    const tbody = document.getElementById('bf-roster-body');
    if (!tbody) return;
    const bfStudents = students.filter(s => s.is_basic_facts).sort((a, b) => a.name.localeCompare(b.name));

    if (bfStudents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No students on Basic Facts yet.</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    bfStudents.forEach(s => {
        const attempts = basicFactsAttempts[s.id] || [];
        const last = attempts.length ? attempts[attempts.length - 1] : null;
        const avgCorrect = attempts.length ? Math.round(attempts.reduce((a, b) => a + b.correct, 0) / attempts.length) : null;
        const avgTime = attempts.length ? Math.round(attempts.reduce((a, b) => a + b.time_seconds, 0) / attempts.length) : null;
        const term = s.basic_facts_term || 1;
        const week = s.basic_facts_week || bfWeeksForTerm(term)[0];

        const weekOptions = bfWeeksForTerm(term).map(w => `<option value="${w}" ${w === week ? 'selected' : ''}>Week ${w}</option>`).join('');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(s.name)}</strong></td>
            <td>
                <select onchange="updateBfTerm('${s.id}', this.value)" style="margin-right:6px;padding:4px 6px;border-radius:6px;border:1.5px solid var(--border);">
                    ${[1,2,3,4].map(t => `<option value="${t}" ${t===term?'selected':''}>Term ${t}</option>`).join('')}
                </select>
                <select onchange="updateBfWeek('${s.id}', this.value)" style="padding:4px 6px;border-radius:6px;border:1.5px solid var(--border);">
                    ${weekOptions}
                </select>
            </td>
            <td>${last ? `${last.correct}/100 in ${formatBfTime(last.time_seconds)}` : '—'}</td>
            <td>${attempts.length}</td>
            <td>${avgCorrect !== null ? avgCorrect + '/100' : '—'}</td>
            <td>${avgTime !== null ? formatBfTime(avgTime) : '—'}</td>
            <td style="white-space:nowrap;">
                <button class="icon-btn" title="Preview this test" onclick="previewStudentAssignedTest('${s.id}')">👁️</button>
                <button class="icon-btn" title="View history" onclick="openBfDetail('${s.id}')">📊</button>
                <button class="icon-btn" title="Delete student" onclick="deleteBfStudent('${s.id}', '${escapeHtml(s.name).replace(/'/g,"\\'")}')">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteBfStudent(id, name) {
    if (!confirm(`Delete ${name}? This removes them completely, including their Basic Facts history.`)) return;
    await deleteStudentRow(id);
    students = students.filter(s => s.id !== id);
    delete basicFactsAttempts[id];
    renderBfRoster();
    showToast(`${name} deleted`, true);
}

async function updateBfTerm(studentId, newTerm) {
    newTerm = parseInt(newTerm);
    const s = students.find(x => x.id === studentId);
    if (!s) return;
    const newWeek = bfWeeksForTerm(newTerm)[0];
    s.basic_facts_term = newTerm;
    s.basic_facts_week = newWeek;
    await updateStudentRow(studentId, { basic_facts_term: newTerm, basic_facts_week: newWeek });
    renderBfRoster();
}

async function updateBfWeek(studentId, newWeek) {
    newWeek = parseInt(newWeek);
    const s = students.find(x => x.id === studentId);
    if (!s) return;
    s.basic_facts_week = newWeek;
    await updateStudentRow(studentId, { basic_facts_week: newWeek });
    renderBfRoster();
}

// ── Detail modal (stats + 2 charts + history) ──
let currentBfDetailStudentId = null;

function openBfDetail(studentId) {
    currentBfDetailStudentId = studentId;
    const s = students.find(x => x.id === studentId);
    if (!s) return;
    const attempts = basicFactsAttempts[studentId] || [];
    const color = getStudentColor(s.name);

    const avgCorrect = attempts.length ? Math.round(attempts.reduce((a, b) => a + b.correct, 0) / attempts.length) : '—';
    const best = attempts.length ? Math.max(...attempts.map(a => a.correct)) : '—';
    const avgTime = attempts.length ? formatBfTime(Math.round(attempts.reduce((a, b) => a + b.time_seconds, 0) / attempts.length)) : '—';
    const bestTime = attempts.length ? formatBfTime(Math.min(...attempts.map(a => a.time_seconds))) : '—';

    document.getElementById('bf-sdm-avatar').style.background = color;
    document.getElementById('bf-sdm-avatar').textContent = getInitials(s.name);
    document.getElementById('bf-sdm-name').textContent = s.name;
    document.getElementById('bf-sdm-sub').textContent = `Currently: Term ${s.basic_facts_term || 1}, Week ${s.basic_facts_week || 1} · ${attempts.length} attempt${attempts.length !== 1 ? 's' : ''}`;

    document.getElementById('bf-sdm-stats').innerHTML =
        `<div class="sdm-stat"><div class="val">${avgCorrect}${avgCorrect!=='—'?'/100':''}</div><div class="lbl">Avg Correct</div></div>` +
        `<div class="sdm-stat"><div class="val">${best}${best!=='—'?'/100':''}</div><div class="lbl">Best Correct</div></div>` +
        `<div class="sdm-stat"><div class="val">${avgTime}</div><div class="lbl">Avg Time</div></div>` +
        `<div class="sdm-stat"><div class="val">${bestTime}</div><div class="lbl">Fastest</div></div>`;

    drawBfChart('bf-chart-correct', attempts, a => a.correct, 100, color);
    drawBfChart('bf-chart-time', attempts, a => a.time_seconds, 300, '#6b9ac4');

    const tbody = document.getElementById('bf-sdm-history-body');
    tbody.innerHTML = '';
    if (attempts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">No attempts yet</td></tr>';
    } else {
        attempts.slice().reverse().forEach(a => {
            const cls = a.correct >= 90 ? 'perfect' : a.correct >= 70 ? 'high' : a.correct >= 50 ? 'mid' : 'low';
            const tr = document.createElement('tr');
            tr.innerHTML =
                `<td>${new Date(a.attempted_at).toLocaleDateString()}</td>` +
                `<td>Term ${a.term}, Wk ${a.week}</td>` +
                `<td><span class="score-pill ${cls}">${a.correct}/100</span></td>` +
                `<td>${formatBfTime(a.time_seconds)}${a.timed_out ? ' (time up)' : ''}</td>` +
                `<td></td>`;
            tbody.appendChild(tr);
        });
    }

    document.getElementById('bf-detail-overlay').classList.add('active');
}

function closeBfDetail(e) {
    if (e && e.target !== document.getElementById('bf-detail-overlay')) return;
    document.getElementById('bf-detail-overlay').classList.remove('active');
    currentBfDetailStudentId = null;
}

function drawBfChart(canvasId, attempts, valueFn, maxVal, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const w = canvas.offsetWidth || 580, h = 160;
    canvas.width = w * 2; canvas.height = h * 2;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
    const padL = 40, padR = 16, padT = 16, padB = 30, cw = w - padL - padR, ch = h - padT - padB;

    [0, 0.5, 1].forEach(f => {
        const y = padT + ch * (1 - f);
        ctx.beginPath(); ctx.strokeStyle = '#e0d8cc'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.moveTo(padL, y); ctx.lineTo(padL + cw, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '10px "DM Mono",monospace'; ctx.fillStyle = '#aaa';
        ctx.textAlign = 'right'; ctx.fillText(Math.round(f * maxVal), padL - 6, y + 4);
    });

    if (attempts.length === 0) {
        ctx.font = '14px Nunito,sans-serif'; ctx.fillStyle = '#aaa'; ctx.textAlign = 'center';
        ctx.fillText('No attempts yet', w / 2, h / 2);
        return;
    }

    const points = attempts.map(a => valueFn(a));
    if (points.length === 1) {
        const x = padL + cw / 2, y = padT + ch * (1 - points[0] / maxVal);
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        return;
    }
    const xStep = cw / (points.length - 1);
    ctx.beginPath();
    points.forEach((v, i) => { const x = padL + i * xStep, y = padT + ch * (1 - v / maxVal); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.lineTo(padL + (points.length - 1) * xStep, padT + ch); ctx.lineTo(padL, padT + ch); ctx.closePath();
    ctx.fillStyle = color + '28'; ctx.fill();
    ctx.beginPath();
    points.forEach((v, i) => { const x = padL + i * xStep, y = padT + ch * (1 - v / maxVal); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    points.forEach((v, i) => {
        const x = padL + i * xStep, y = padT + ch * (1 - v / maxVal);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5; ctx.stroke();
    });
}
