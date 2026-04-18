/**
 * Google Sheets integration for Weight Log.
 *
 * Sheet layout: single tab named "Weight Log"
 * Columns: Date | Time | Type | Value | Note
 *
 * Type is either "weight" or "note".
 */

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function getGoogleToken(env) {
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const jwt = await signJwt(header, claim, serviceAccount.private_key);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });

  const { access_token } = await res.json();
  return access_token;
}

async function signJwt(header, claim, privateKeyPem) {
  const enc = txt =>
    btoa(JSON.stringify(txt))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  const body = `${enc(header)}.${enc(claim)}`;

  const keyData = pemToArrayBuffer(privateKeyPem);
  const key = await crypto.subtle.importKey(
    'pkcs8', keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(body)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return `${body}.${sigB64}`;
}

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

// ─── Tab setup ────────────────────────────────────────────────────────────────

const TAB_NAME = 'Weight Log';

export async function ensureTab(env, token) {
  const sheetId = env.GOOGLE_SHEET_ID;

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const meta = await metaRes.json();
  const existing = meta.sheets || [];
  const found = existing.find(s => s.properties.title === TAB_NAME);
  if (found) return found.properties.sheetId;

  // Create tab
  const createRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: TAB_NAME, gridProperties: { rowCount: 10000, columnCount: 5 } } } }],
      }),
    }
  );
  const createData = await createRes.json();
  const newSheetId = createData.replies?.[0]?.addSheet?.properties?.sheetId;

  // Write header
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(TAB_NAME + '!A1:E1')}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [['Date', 'Time', 'Type', 'Value', 'Note']] }),
    }
  );

  // Bold header + freeze row
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat(textFormat)',
            },
          },
          {
            updateSheetProperties: {
              properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
              fields: 'gridProperties.frozenRowCount',
            },
          },
        ],
      }),
    }
  );

  console.log(`[sheets] Created tab: ${TAB_NAME}`);
  return newSheetId;
}

// ─── Append entry ─────────────────────────────────────────────────────────────

export async function appendEntry(env, token, { date, time, type, value, note }) {
  const sheetId = env.GOOGLE_SHEET_ID;
  await ensureTab(env, token);

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(TAB_NAME + '!A:E')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[date, time, type, value, note]] }),
    }
  );
}

// ─── Read all rows ────────────────────────────────────────────────────────────

export async function getAllRows(env, token) {
  const sheetId = env.GOOGLE_SHEET_ID;
  await ensureTab(env, token);

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(TAB_NAME + '!A:E')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  const values = data.values || [];

  return values.slice(1).map(row => ({
    date:  row[0] || '',
    time:  row[1] || '',
    type:  row[2] || 'weight',
    value: row[3] || '',
    note:  row[4] || '',
  })).filter(r => r.date);
}

// ─── Recent rows ──────────────────────────────────────────────────────────────

export async function getRecentLog(env, token, limit = 50) {
  const rows = await getAllRows(env, token);
  return rows.reverse().slice(0, limit);
}
