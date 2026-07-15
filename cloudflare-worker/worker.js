// Cloudflare Worker: private R2 → PDF proxy for MMM Classroom Tools
//
// Deploy with `wrangler deploy` from this folder (see README.md).
// The bucket stays private; this Worker is the only thing that can
// read from it, and it only does so for signed-in teachers (verified
// against your Supabase project).

export default {
    async fetch(request, env) {
        const corsHeaders = {
            "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        if (request.method !== "GET") {
            return new Response(JSON.stringify({ error: "method_not_allowed" }), {
                status: 405,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const url = new URL(request.url);
        const type = url.searchParams.get("type"); // 'skills' | 'tests'

        // Whitelisted mapping — the client can never pass an arbitrary path.
        const FILE_MAP = {
            skills: "MMM/MMM Skills for Printing.pdf",
            tests: "MMM/Mad Math Minute Tests.pdf",
        };

        const key = FILE_MAP[type];
        if (!key) {
            return new Response(JSON.stringify({ error: "invalid_type" }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Practice/skills sheets are safe for students/parents to print directly —
        // no login required. Friday tests stay teacher-only.
        if (type === "tests") {
            const authHeader = request.headers.get("Authorization") || "";
            const token = authHeader.replace("Bearer ", "");
            if (!token) {
                return new Response(JSON.stringify({ error: "missing_token" }), {
                    status: 401,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }

            const verifyRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    apikey: env.SUPABASE_ANON_KEY,
                },
            });

            if (!verifyRes.ok) {
                return new Response(JSON.stringify({ error: "invalid_token" }), {
                    status: 401,
                    headers: { ...corsHeaders, "Content-Type": "application/json" },
                });
            }
        }

        const object = await env.MMM_BUCKET.get(key);
        if (!object) {
            return new Response(JSON.stringify({ error: "file_not_found" }), {
                status: 404,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        return new Response(object.body, {
            headers: {
                ...corsHeaders,
                "Content-Type": "application/pdf",
                "Cache-Control": "private, max-age=300",
            },
        });
    },
};
