/**
 * Weight Log — Cloudflare Worker
 * Logs weight entries and notes to Google Sheets, serves API endpoints for the dashboard.
 */

import { getGoogleToken, appendEntry, getAllRows, getRecentLog } from './sheets.js';

// ─── Main Handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (url.pathname === '/api/entry' && request.method === 'POST') {
      return handleEntryApi(request, env);
    }

    if (url.pathname === '/api/weights' && request.method === 'GET') {
      return handleWeightsApi(env);
    }

    if (url.pathname === '/api/log' && request.method === 'GET') {
      return handleLogApi(env);
    }

    return new Response('Weight Log is running! ⚖️', { status: 200 });
  }
};

// ─── Web Form Entry API ───────────────────────────────────────────────────────

async function handleEntryApi(request, env) {
  try {
    const formData = await request.formData();
    const date    = (formData.get('date') || '').trim();
    const time    = (formData.get('time') || '').trim();
    const weight  = (formData.get('weight') || '').trim();
    const note    = (formData.get('note') || '').trim();

    if (!date) {
      return new Response(JSON.stringify({ error: 'date is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!weight && !note) {
      return new Response(JSON.stringify({ error: 'weight or note is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const token = await getGoogleToken(env);

    if (weight) {
      const parsed = parseFloat(weight);
      if (isNaN(parsed)) {
        return new Response(JSON.stringify({ error: 'invalid weight value' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      await appendEntry(env, token, { date, time, type: 'weight', value: parsed, note: '' });
    }

    if (note) {
      await appendEntry(env, token, { date, time, type: 'note', value: '', note });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

// ─── Dashboard APIs ───────────────────────────────────────────────────────────

async function handleWeightsApi(env) {
  try {
    const token = await getGoogleToken(env);
    const rows = await getAllRows(env, token);

    const weights = rows
      .filter(r => r.type === 'weight' && r.value)
      .map(r => ({ date: r.date, time: r.time, value: parseFloat(r.value) }));

    const notes = rows
      .filter(r => r.type === 'note' && r.note)
      .map(r => ({ date: r.date, time: r.time, note: r.note }));

    return new Response(JSON.stringify({ weights, notes }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}

async function handleLogApi(env) {
  try {
    const token = await getGoogleToken(env);
    const log = await getRecentLog(env, token, 50);
    return new Response(JSON.stringify(log), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
