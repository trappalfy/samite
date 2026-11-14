//! Seeds and limits (CLAUDE.md §4.4, §15). Re-check the limits with the owner before M5.
use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const JOB_SEED: &[u8] = b"job";
#[constant]
pub const MACHINE_SEED: &[u8] = b"machine";

/// USDC on mainnet: classic SPL Token, 6 decimals. Source: Circle's USDC contract addresses, checked Nov 12, 2026.
/// TODO(verify) against Circle before M5. Local tests write a mint at this same address (§3.2).
#[constant]
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
#[constant]
pub const USDC_DECIMALS: u8 = 6;

/// Fee cap, compile-time: 5%.
#[constant]
pub const MAX_FEE_BPS: u16 = 500;
#[constant]
pub const BPS_DENOMINATOR: u16 = 10_000;

#[constant]
pub const MAX_DELIVERIES: u8 = 3;
#[constant]
pub const MAX_ALLOWLIST: u8 = 10;

pub const HOUR: i64 = 3_600;
pub const DAY: i64 = 24 * HOUR;

/// The deadline is between now + 1 h and now + 90 days.
#[constant]
pub const MIN_DEADLINE: i64 = HOUR;
#[constant]
pub const MAX_DEADLINE: i64 = 90 * DAY;
/// The review window is between 1 h and 7 days (the app's default is 48 h).
#[constant]
pub const MIN_REVIEW_WINDOW: i64 = HOUR;
#[constant]
pub const MAX_REVIEW_WINDOW: i64 = 7 * DAY;
/// A claim window is 1 h up to the deadline. Every claim lapses: `post_job` no longer takes 0 (Nov 13).
#[constant]
pub const MIN_CLAIM_WINDOW: i64 = HOUR;
/// After a rejection the machine always has at least this long to deliver again.
#[constant]
pub const MIN_RESUBMIT: i64 = DAY;
