//! Events, emitted with `emit_cpi!` so the indexer reads them from inner instructions, not truncatable logs.
use anchor_lang::prelude::*;

use crate::state::ClaimPolicy;

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_bps: u16,
    pub min_reward: u64,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub min_reward: u64,
    pub paused: bool,
}

#[event]
pub struct AdminProposed {
    pub admin: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct AdminAccepted {
    pub previous: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct JobPosted {
    pub job: Pubkey,
    pub poster: Pubkey,
    pub job_id: u64,
    pub reward: u64,
    pub fee_bps: u16,
    pub spec_hash: [u8; 32],
    pub deadline: i64,
    pub review_window: i64,
    pub claim_window: i64,
    pub policy: ClaimPolicy,
    pub allowlist: Vec<Pubkey>,
    pub created_at: i64,
}

#[event]
pub struct JobCancelled {
    pub job: Pubkey,
    pub poster: Pubkey,
    /// Base units returned to the poster.
    pub refunded: u64,
    pub at: i64,
}

#[event]
pub struct JobClaimed {
    pub job: Pubkey,
    pub machine: Pubkey,
    pub claimed_at: i64,
}

#[event]
pub struct JobUnclaimed {
    pub job: Pubkey,
    pub machine: Pubkey,
    pub at: i64,
}

#[event]
pub struct ClaimExpired {
    pub job: Pubkey,
    pub machine: Pubkey,
    pub at: i64,
}

#[event]
pub struct DeliverySubmitted {
    pub job: Pubkey,
    pub machine: Pubkey,
    pub delivery_hash: [u8; 32],
    /// 1..=MAX_DELIVERIES, equals `Job.deliveries` after this delivery.
    pub attempt: u8,
    pub delivered_at: i64,
}

#[event]
pub struct DeliveryRejected {
    pub job: Pubkey,
    pub machine: Pubkey,
    /// sha256(NFC(reason text)) (§5.3).
    pub reason_hash: [u8; 32],
    pub attempt: u8,
    /// The deadline after this rejection (it may have moved to now + MIN_RESUBMIT).
    pub deadline: i64,
    /// True on the last allowed delivery: the poster was refunded and the job closed (a `JobRefunded` follows).
    pub refunded: bool,
    pub at: i64,
}

#[event]
pub struct JobPaid {
    pub job: Pubkey,
    pub poster: Pubkey,
    pub machine: Pubkey,
    pub reward: u64,
    /// Base units sent to the machine's USDC ATA: `reward - fee`, plus anything that was sent to the vault directly.
    /// Only `reward - fee` counts as `MachineStats.earned`.
    pub to_machine: u64,
    /// Base units sent to the treasury: floor(reward * fee_bps / 10_000), or 0 if the treasury is this job's own vault.
    pub fee: u64,
    /// False for `accept_delivery`, true for `release_after_review`.
    pub auto: bool,
    pub at: i64,
}

#[event]
pub struct JobRefunded {
    pub job: Pubkey,
    pub poster: Pubkey,
    /// Base units returned to the poster.
    pub refunded: u64,
    /// Deliveries the job had received (> 0 means "refunded after a delivery", §4.6).
    pub deliveries: u8,
    pub at: i64,
}
