//! Accounts (CLAUDE.md §4.2).
use anchor_lang::prelude::*;

use crate::constants::MAX_ALLOWLIST;

/// PDA `["config"]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Config {
    pub admin: Pubkey,
    /// The USDC token account that receives fees: always the USDC ATA (classic SPL Token) of `treasury_owner`, so
    /// anyone can re-create it if it is closed. Set together with `treasury_owner`.
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    /// 250 at launch; always <= MAX_FEE_BPS.
    pub fee_bps: u16,
    /// Base units; 1_000_000 (1 USDC) at launch.
    pub min_reward: u64,
    /// Blocks `post_job` and `claim_job` only.
    pub paused: bool,
    pub bump: u8,
    /// Two-step admin change: set by `propose_admin`, taken by `accept_admin`.
    pub pending_admin: Option<Pubkey>,
    /// The wallet (or multisig) whose USDC ATA is `treasury`. Never an account owned by this program.
    pub treasury_owner: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum JobStatus {
    Open,
    Claimed,
    Delivered,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ClaimPolicy {
    /// Any machine.
    Any,
    /// Machines with at least `min_accepted` accepted (or auto-released) jobs.
    Proven { min_accepted: u32 },
    /// Only the addresses in `Job.allowlist`.
    Allowlist,
}

/// PDA `["job", poster, job_id.to_le_bytes()]`. Closed (rent to the poster) when the job ends.
#[account]
#[derive(InitSpace, Debug)]
pub struct Job {
    pub poster: Pubkey,
    /// Chosen by the client (random u64); the PDA makes collisions fail.
    pub job_id: u64,
    /// Base units, locked in the vault.
    pub reward: u64,
    /// Snapshot of `Config.fee_bps` at post time.
    pub fee_bps: u16,
    /// sha256 of the canonical job spec (§5.1).
    pub spec_hash: [u8; 32],
    pub status: JobStatus,
    pub worker: Option<Pubkey>,
    pub policy: ClaimPolicy,
    /// Empty unless `policy` is `Allowlist`.
    #[max_len(MAX_ALLOWLIST)]
    pub allowlist: Vec<Pubkey>,
    /// Unix seconds.
    pub deadline: i64,
    /// Seconds.
    pub review_window: i64,
    /// Seconds a claim holds without a delivery: 1 h up to the time left until the deadline, set at post.
    pub claim_window: i64,
    /// Last delivery (§5.2); zero if none.
    pub delivery_hash: [u8; 32],
    /// Count, at most MAX_DELIVERIES.
    pub deliveries: u8,
    pub created_at: i64,
    /// When the current claim started (restarted by a rejection); 0 when unclaimed.
    pub claimed_at: i64,
    pub delivered_at: i64,
    pub bump: u8,
    /// The machine whose claim last ended without a payout (`unclaim_job` or `expire_claim`). It can't claim this job
    /// again, so a claim can't be renewed by the same key; any other machine can claim.
    pub previous_worker: Option<Pubkey>,
}

/// PDA `["machine", worker]`. Created on first claim, paid by the machine. Never closed.
#[account]
#[derive(InitSpace, Debug)]
pub struct MachineStats {
    pub machine: Pubkey,
    /// Accepted + auto-released deliveries.
    pub accepted: u32,
    pub rejected: u32,
    /// Base units received.
    pub earned: u64,
    pub bump: u8,
}
