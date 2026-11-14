use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::EscrowError,
    events::ClaimExpired,
    state::{Job, JobStatus},
};

/// Permissionless. A claim that has held longer than the job's claim window without a delivery is dropped and the job
/// reopens for any other machine (the one whose claim expired can't claim it again). Same effect as `unclaim_job`;
/// moves no money. After a rejection (`reject_delivery` restarts `claimed_at`) the claim holds for at least
/// MIN_RESUBMIT, so a rejected machine always gets its fair chance to deliver again.
#[event_cpi]
#[derive(Accounts)]
pub struct ExpireClaim<'info> {
    #[account(mut, seeds = [JOB_SEED, job.poster.as_ref(), &job.job_id.to_le_bytes()], bump = job.bump)]
    pub job: Box<Account<'info, Job>>,
}

pub fn handle_expire_claim(ctx: Context<ExpireClaim>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    require!(job.status == JobStatus::Claimed, EscrowError::JobNotClaimed);
    // unreachable since post_job refuses 0 (Nov 13); kept so a zero window can never expire a claim at once
    require!(job.claim_window > 0, EscrowError::NoClaimWindow);
    let hold = if job.deliveries > 0 { job.claim_window.max(MIN_RESUBMIT) } else { job.claim_window };
    let expires_at = job.claimed_at.checked_add(hold).ok_or(EscrowError::MathOverflow)?;
    require!(now > expires_at, EscrowError::ClaimWindowNotPassed);

    let machine = job.worker.ok_or(EscrowError::JobNotClaimed)?;
    job.worker = None;
    job.previous_worker = Some(machine);
    job.claimed_at = 0;
    job.status = JobStatus::Open;
    let job_key = job.key();

    emit_cpi!(ClaimExpired { job: job_key, machine, at: now });
    Ok(())
}
