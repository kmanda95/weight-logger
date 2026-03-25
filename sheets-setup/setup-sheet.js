/**
 * Run this once to verify your Google Sheet is accessible.
 * The Worker auto-creates the "Weight Log" tab on first use.
 *
 * Usage:
 *   npm install googleapis
 *   GOOGLE_SERVICE_ACCOUNT_JSON='...' GOOGLE_SHEET_ID='...' node setup-sheet.js
 */

const { google } = require('googleapis');

async function setup() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!credentials || !sheetId) {
    console.error('❌ Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEET_ID env vars');
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  console.log(`✅ Connected to sheet: "${meta.data.properties.title}"`);
  console.log(`   URL: https://docs.google.com/spreadsheets/d/${sheetId}`);
  console.log('');
  console.log('ℹ️  A "Weight Log" tab will be created automatically when you log your first entry.');
  console.log('');
  console.log('Existing tabs:', meta.data.sheets.map(s => s.properties.title).join(', ') || '(none yet)');
  console.log('');
  console.log('⚖️  Setup verified! You\'re ready to deploy the Worker.');
}

setup().catch(err => {
  console.error('❌ Setup failed:', err.message);
  process.exit(1);
});
