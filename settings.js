'use strict';
const { one, run } = require('../db');

const DEFAULT_SETTINGS = Object.freeze({
  // Auction
  budget: 70000,
  startingBid: 500,
  minIncrement: 200,
  squadSize: 7,
  starters: 5,
  subs: 2,
  timerSeconds: 15,
  secondRoundStartingBid: 500,
  captainCountsInSquad: true,   // captain is one of the seven
  captainsInAuction: false,     // captains are assigned to their club automatically
  reserveForRemainingSlots: true, // a club must keep enough points to fill its remaining places at the starting bid
  // Registration
  registrationOpen: true,
  registrationFee: 'Rs. 500',
  // Public website visibility
  publicSquads: false,
  publicPhotos: false,
  publicFixtures: true,
  publicResults: true,
  publicStandings: true,
  publicStats: true,
  publicAuctionPrices: false,
});

const NUMERIC = {
  budget: [1000, 10000000],
  startingBid: [1, 1000000],
  minIncrement: [1, 1000000],
  squadSize: [1, 30],
  starters: [1, 15],
  subs: [0, 15],
  timerSeconds: [5, 300],
  secondRoundStartingBid: [1, 1000000],
};
const BOOLEAN = ['captainCountsInSquad', 'captainsInAuction', 'reserveForRemainingSlots', 'registrationOpen',
  'publicSquads', 'publicPhotos', 'publicFixtures', 'publicResults', 'publicStandings', 'publicStats', 'publicAuctionPrices'];

function parse(json) {
  let s = {};
  try { s = JSON.parse(json || '{}'); } catch { s = {}; }
  return { ...DEFAULT_SETTINGS, ...s };
}

function currentSeason() {
  return one('SELECT * FROM seasons WHERE is_current = 1') || one('SELECT * FROM seasons ORDER BY id DESC LIMIT 1');
}

function get(seasonId) {
  const row = one('SELECT settings FROM seasons WHERE id = ?', seasonId);
  return parse(row && row.settings);
}

/** Validate a partial settings object; returns { clean, errors }. */
function validate(input) {
  const clean = {};
  const errors = [];
  for (const [k, [min, max]] of Object.entries(NUMERIC)) {
    if (input[k] === undefined || input[k] === '') continue;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${k} must be a whole number between ${min} and ${max}.`);
    else clean[k] = n;
  }
  for (const k of BOOLEAN) if (input[k] !== undefined) clean[k] = input[k] === true || input[k] === 'true' || input[k] === 1 || input[k] === 'on';
  if (input.registrationFee !== undefined) clean.registrationFee = String(input.registrationFee).trim().slice(0, 40);
  return { clean, errors };
}

function save(seasonId, partial) {
  const merged = { ...get(seasonId), ...partial };
  if (merged.starters + merged.subs > merged.squadSize) {
    // keep the squad structure consistent: starters + substitutes cannot exceed squad size
    throw Object.assign(new Error('Starting players plus substitutes cannot be more than the squad size.'), { status: 400 });
  }
  run('UPDATE seasons SET settings = ? WHERE id = ?', JSON.stringify(merged), seasonId);
  return merged;
}

function getGlobal(key, fallback = null) {
  const r = one('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
function setGlobal(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

module.exports = { DEFAULT_SETTINGS, currentSeason, get, validate, save, getGlobal, setGlobal, parse };
