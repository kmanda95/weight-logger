/**
 * Weight Log — Cloudflare Worker
 * Handles incoming Twilio SMS webhooks for weight entries and notes,
 * logs to Google Sheets, and serves API endpoints for the dashboard.
 */

import { getGoogleToken, appendEntry, getAllRows, getRecentLog } from './sheets.js';
import { twimlResponse } from './twilio.js';

// ─── SMS Parsing ──────────────────────────────────────────────────────────────

/** Returns true if the message looks like a weight (e.g. "159", "159.3", "159.3 lbs") */
function parseWeight(text) {
  const match = text.trim().match(/^(\d{2,3}(\.\d{1,2})?)\s*(lbs?|pounds?|lb)?$/i);
  if (match) return parseFloat(match[1]);
  return null;
}

/** Special commands */
const COMMANDS = ['stats', 'history', 'help', '?', 'log'];

// ─── Main Handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    if (url.pathname === '/sms' && request.method === 'POST') {
      return handleSms(request, env, ctx);
    }

    return new Response('Weight Log is running! ⚖️', { status: 200 });
  }
};

// ─── SMS Handler ──────────────────────────────────────────────────────────────
async function handleSms(request, env) {
  const formData = await request.formData();
  const from = formData.get('From');
  const body = (formData.get('Body') || '').trim();
  const bodyLower = body.toLowerCase();

  // Optional: restrict to registered number
  if (env.USER_PHONE && from !== env.USER_PHONE) {
    return twimlResponse("❌ This number isn't registered for weight logging.");
  }

  // Help command
  if (bodyLower === 'help' || bodyLower === '?') {
    return twimlResponse(buildHelpMessage());
  }

  // Stats command
  if (bodyLower === 'stats' || bodyLower === 'status') {
    return handleStatsCommand(env);
  }

  // History command
  if (bodyLower === 'history' || bodyLower === 'log') {
    return handleHistoryCommand(env);
  }

  // Try to parse as a weight
  const weight = parseWeight(body);
  if (weight !== null) {
    return handleWeightLog(weight, env);
  }

  // Otherwise treat as a note
  return handleNoteLog(body, env);
}

// ─── Weight Logging ───────────────────────────────────────────────────────────
async function handleWeightLog(weight, env) {
  const token = await getGoogleToken(env);
  const now = new Date();
  const tz = env.TIMEZONE || 'America/Chicago';
  const dateStr = now.toLocaleDateString('en-US', { timeZone: tz });
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

  await appendEntry(env, token, {
    date: dateStr,
    time: timeStr,
    type: 'weight',
    value: weight,
    note: '',
  });

  // Get last few weights for context
  const rows = await getAllRows(env, token);
  const weightRows = rows.filter(r => r.type === 'weight' && r.value).reverse();
  const recent = weightRows.slice(0, 7);

  let reply = `✅ Logged: ${weight} lbs\n📅 ${dateStr} at ${timeStr}`;

  if (recent.length >= 2) {
    const prev = recent[1]; // second-most-recent (index 0 is the one we just logged)
    const diff = weight - parseFloat(prev.value);
    const sign = diff > 0 ? '+' : '';
    reply += `\n\n📈 Change: ${sign}${diff.toFixed(1)} lbs from last entry`;
  }

  if (weightRows.length >= 7) {
    const weekAgo = weightRows[6];
    const weekDiff = weight - parseFloat(weekAgo.value);
    const sign = weekDiff > 0 ? '+' : '';
    reply += `\n📊 vs ~1 week ago: ${sign}${weekDiff.toFixed(1)} lbs`;
  }

  reply += `\n\nText a note anytime to add context (e.g. "period started", "ate out today")`;

  return twimlResponse(reply);
}

// ─── Note Logging ─────────────────────────────────────────────────────────────
async function handleNoteLog(noteText, env) {
  const token = await getGoogleToken(env);
  const now = new Date();
  const tz = env.TIMEZONE || 'America/Chicago';
  const dateStr = now.toLocaleDateString('en-US', { timeZone: tz });
  const timeStr = now.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit' });

  await appendEntry(env, token, {
    date: dateStr,
    time: timeStr,
    type: 'note',
    value: '',
    note: noteText,
  });

  return twimlResponse(`📝 Note logged for ${dateStr}:\n"${noteText}"\n\nThis will appear on your dashboard.`);
}

// ─── Stats Command ────────────────────────────────────────────────────────────
async function handleStatsCommand(env) {
  const token = await getGoogleToken(env);
  const rows = await getAllRows(env, token);
  const weightRows = rows.filter(r => r.type === 'weight' && r.value).reverse();

  if (weightRows.length === 0) {
    return twimlResponse("No weight entries yet! Text a number like '159.3' to log your first weight.");
  }

  const latest = weightRows[0];
  const first = weightRows[weightRows.length - 1];
  const totalChange = parseFloat(latest.value) - parseFloat(first.value);
  const sign = totalChange > 0 ? '+' : '';

  const lines = [
    `⚖️ Weight Stats`,
    `─────────────────`,
    `Latest: ${latest.value} lbs (${latest.date})`,
    `First logged: ${first.value} lbs (${first.date})`,
    `Total change: ${sign}${totalChange.toFixed(1)} lbs`,
    `Total entries: ${weightRows.length}`,
  ];

  if (weightRows.length >= 2) {
    const prev = weightRows[1];
    const diff = parseFloat(latest.value) - parseFloat(prev.value);
    const dsign = diff > 0 ? '+' : '';
    lines.push(`Last change: ${dsign}${diff.toFixed(1)} lbs`);
  }

  return twimlResponse(lines.join('\n'));
}

// ─── History Command ──────────────────────────────────────────────────────────
async function handleHistoryCommand(env) {
  const token = await getGoogleToken(env);
  const rows = await getAllRows(env, token);
  const weightRows = rows.filter(r => r.type === 'weight' && r.value).reverse().slice(0, 7);

  if (weightRows.length === 0) {
    return twimlResponse("No weight entries yet!");
  }

  const lines = ['📋 Last 7 entries:'];
  for (const row of weightRows) {
    lines.push(`• ${row.date}: ${row.value} lbs`);
  }

  return twimlResponse(lines.join('\n'));
}

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

    // Separate weights and notes
    const weights = rows
      .filter(r => r.type === 'weight' && r.value)
      .map(r => ({ date: r.date, time: r.time, value: parseFloat(r.value) }));

    const notes = rows
      .filter(r => r.type === 'note' && r.note)
      .map(r => ({ date: r.date, time: r.time, note: r.note }));

    return new Response(JSON.stringify({ weights, notes }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
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

// ─── Help Message ─────────────────────────────────────────────────────────────
function buildHelpMessage() {
  return [
    `⚖️ Weight Log Help`,
    `─────────────────`,
    `Log your weight:`,
    `  "159.3"`,
    `  "159.3 lbs"`,
    ``,
    `Log a note:`,
    `  "period started"`,
    `  "went on vacation"`,
    `  "didn't count calories"`,
    `  (any text that isn't a number)`,
    ``,
    `Commands:`,
    `  "stats"   — summary stats`,
    `  "history" — last 7 entries`,
    `  "help"    — this message`,
  ].join('\n');
}
