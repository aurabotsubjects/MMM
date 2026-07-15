// ─────────────────────────────────────────────────────────
//  Shared auth helpers used by index.html (teacher app)
//  and admin.html (admin panel).
// ─────────────────────────────────────────────────────────

const CLASS_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — avoids mix-ups

function mmmGenerateClassCode() {
    let code = '';
    for (let i = 0; i < 6; i++) code += CLASS_CODE_CHARS[Math.floor(Math.random() * CLASS_CODE_CHARS.length)];
    return code;
}

async function mmmGetSession() {
    const { data } = await sb.auth.getSession();
    return data.session || null;
}

async function mmmGetProfile() {
    const session = await mmmGetSession();
    if (!session) return null;
    const { data, error } = await sb
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
    if (error) {
        console.error('Failed to load profile', error);
        return null;
    }
    return data;
}

async function mmmLogin(email, password) {
    return sb.auth.signInWithPassword({ email, password });
}

async function mmmLogout() {
    await sb.auth.signOut();
    window.location.href = 'index.html';
}

async function mmmResetPassword(email) {
    return sb.auth.resetPasswordForEmail(email);
}

/**
 * Self-service teacher signup. Creates the auth user, then (if a session
 * came back immediately — i.e. email confirmation is off) inserts a
 * pending profile row with a freshly generated class code.
 * Returns { needsEmailConfirm: bool } or throws an Error with a friendly message.
 */
async function mmmTeacherSignup({ email, password, display_name, class_name }) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);

    if (!data.session) {
        // Project has "Confirm email" turned on — there's no session yet to
        // insert a profile row with, so we ask them to confirm via email
        // and then sign up again afterwards to finish creating the profile.
        return { needsEmailConfirm: true };
    }

    const code = mmmGenerateClassCode();
    const { error: profileErr } = await sb.from('profiles').insert({
        id: data.user.id,
        email,
        role: 'teacher',
        status: 'pending',
        display_name,
        class_name,
        class_code: code
    });
    if (profileErr) throw new Error(profileErr.message);

    return { needsEmailConfirm: false };
}

/**
 * Wires up a login form. Calls onSuccess(profile) once signed in
 * with a profile matching requiredRole ('teacher' | 'admin') that
 * is approved. Shows a clear message for pending/rejected/wrong-role
 * accounts instead of silently letting them in.
 */
function mmmInitLoginForm({ formId, errorId, requiredRole, onSuccess, onNeedsProfile }) {
    const form = document.getElementById(formId);
    const errorEl = document.getElementById(errorId);

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.classList.add('show');
    }
    function clearError() {
        errorEl.classList.remove('show');
        errorEl.textContent = '';
    }

    async function tryEnter() {
        const session = await mmmGetSession();
        if (!session) return false;

        const profile = await mmmGetProfile();

        if (!profile) {
            // Signed in (auth account exists), but no profile row — this
            // happens when "Confirm email" was on and the original signup
            // form never got to create the profile. Let the caller offer
            // a "finish setting up" form instead of just failing silently.
            if (requiredRole === 'teacher' && onNeedsProfile) {
                onNeedsProfile();
                return true;
            }
            showError('No profile found for this account. Contact your admin.');
            await sb.auth.signOut();
            return false;
        }

        if (profile.role !== requiredRole) {
            showError(requiredRole === 'admin'
                ? 'This account is not an admin account.'
                : 'This account is not a teacher account.');
            await sb.auth.signOut();
            return false;
        }
        if (requiredRole === 'teacher' && profile.status === 'pending') {
            showError('Your account is still waiting for admin approval.');
            await sb.auth.signOut();
            return false;
        }
        if (requiredRole === 'teacher' && profile.status === 'rejected') {
            showError('This account request was declined. Please contact your admin.');
            await sb.auth.signOut();
            return false;
        }

        onSuccess(profile);
        return true;
    }

    // If already logged in (session persisted), try to enter right away.
    tryEnter();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();
        const email = document.getElementById('authEmail').value.trim();
        const password = document.getElementById('authPassword').value;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in…';

        const { error } = await mmmLogin(email, password);
        if (error) {
            showError('Incorrect email or password.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
            return;
        }

        await tryEnter();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
    });
}

/**
 * Creates the missing profile row for the currently signed-in user —
 * used to recover a signup that got interrupted by an email confirmation
 * step (see mmmInitLoginForm's onNeedsProfile above).
 */
async function mmmCreateProfileForCurrentUser({ display_name, class_name }) {
    const session = await mmmGetSession();
    if (!session) throw new Error('Not signed in.');

    let lastErr = null;
    let code = mmmGenerateClassCode();
    for (let attempt = 0; attempt < 5; attempt++) {
        const { error } = await sb.from('profiles').insert({
            id: session.user.id,
            email: session.user.email,
            role: 'teacher',
            status: 'pending',
            display_name,
            class_name,
            class_code: code
        });
        lastErr = error;
        if (!error) return;
        code = mmmGenerateClassCode(); // in case of a rare class_code collision
    }
    throw new Error(lastErr ? lastErr.message : 'Could not create profile.');
}
