//! Samite escrow: one USDC escrow per job. The reward can only go to the machine whose delivery was accepted
//! (minus the fee, to the treasury) or back to the poster. See CLAUDE.md §4 and docs/PROGRAM-REVIEW.md.
#![allow(unexpected_cfgs)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod settle;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
use state::ClaimPolicy;

// TODO(M5): owner's program id. This one comes from a local, gitignored keypair (target/deploy/).
declare_id!("AcTtHioeudEDQuaW6WaL5auXC2rv3jPNoNbPxPB7pHM9");

#[program]
pub mod samite_escrow {
    use super::*;

    /// Creates the config. Signer must be the program's upgrade authority; it becomes the admin. The fee account is
    /// `treasury`, which must be the USDC ATA of `treasury_owner`.
    pub fn initialize_config(ctx: Context<InitializeConfig>, fee_bps: u16, min_reward: u64) -> Result<()> {
        instructions::initialize_config::handle_initialize_config(ctx, fee_bps, min_reward)
    }

    /// Admin only. Each `Some` changes that setting. `new_treasury_owner` with `new_treasury` (its USDC ATA) replaces
    /// the fee account when both are passed.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_bps: Option<u16>,
        min_reward: Option<u64>,
        paused: Option<bool>,
    ) -> Result<()> {
        instructions::update_config::handle_update_config(ctx, fee_bps, min_reward, paused)
    }

    /// Admin only. Names the next admin (never the all-zero address), who must call `accept_admin`.
    pub fn propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::handle_propose_admin(ctx, new_admin)
    }

    /// The proposed admin takes over.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::handle_accept_admin(ctx)
    }

    /// Creates a job and locks `reward` in its vault. Blocked while paused.
    #[allow(clippy::too_many_arguments)]
    pub fn post_job(
        ctx: Context<PostJob>,
        job_id: u64,
        reward: u64,
        deadline: i64,
        review_window: i64,
        claim_window: i64,
        policy: ClaimPolicy,
        allowlist: Vec<Pubkey>,
        spec_hash: [u8; 32],
    ) -> Result<()> {
        instructions::post_job::handle_post_job(
            ctx,
            job_id,
            reward,
            deadline,
            review_window,
            claim_window,
            policy,
            allowlist,
            spec_hash,
        )
    }

    /// Poster only, `Open` jobs: full refund, job closed.
    pub fn cancel_job(ctx: Context<CancelJob>) -> Result<()> {
        instructions::cancel_job::handle_cancel_job(ctx)
    }

    /// A machine takes an `Open` job before its deadline (not the machine that last left it). Blocked while paused.
    pub fn claim_job(ctx: Context<ClaimJob>) -> Result<()> {
        instructions::claim_job::handle_claim_job(ctx)
    }

    /// The job's machine drops it; it reopens.
    pub fn unclaim_job(ctx: Context<UnclaimJob>) -> Result<()> {
        instructions::unclaim_job::handle_unclaim_job(ctx)
    }

    /// Anyone, once a claim has outlived the job's claim window: the job reopens.
    pub fn expire_claim(ctx: Context<ExpireClaim>) -> Result<()> {
        instructions::expire_claim::handle_expire_claim(ctx)
    }

    /// The job's machine records its delivery hash, up to the deadline, at most MAX_DELIVERIES times.
    pub fn submit_delivery(ctx: Context<SubmitDelivery>, delivery_hash: [u8; 32]) -> Result<()> {
        instructions::submit_delivery::handle_submit_delivery(ctx, delivery_hash)
    }

    /// Poster only, `Delivered` jobs: pays the machine (§4.5) and closes the job.
    pub fn accept_delivery(ctx: Context<AcceptDelivery>) -> Result<()> {
        instructions::accept_delivery::handle_accept_delivery(ctx)
    }

    /// Poster only, inside the review window: back to `Claimed` (or refund and close after the last delivery).
    pub fn reject_delivery(ctx: Context<RejectDelivery>, reason_hash: [u8; 32]) -> Result<()> {
        instructions::reject_delivery::handle_reject_delivery(ctx, reason_hash)
    }

    /// Anyone, after the review window with no answer: pays the machine exactly as `accept_delivery`.
    pub fn release_after_review(ctx: Context<ReleaseAfterReview>) -> Result<()> {
        instructions::release_after_review::handle_release_after_review(ctx)
    }

    /// Anyone, after the deadline, `Open` or `Claimed` jobs: full refund to the poster, job closed.
    pub fn refund_after_deadline(ctx: Context<RefundAfterDeadline>) -> Result<()> {
        instructions::refund_after_deadline::handle_refund_after_deadline(ctx)
    }
}
