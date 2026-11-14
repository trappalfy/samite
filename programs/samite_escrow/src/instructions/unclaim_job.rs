use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::EscrowError,
    events::JobUnclaimed,
    state::{Job, JobStatus},
};

/// The machine drops a claimed job; it reopens for any other machine (this one can't claim it again). Works while
/// paused.
#[event_cpi]
#[derive(Accounts)]
pub struct UnclaimJob<'info> {
    pub machine: Signer<'info>,
    #[account(mut, seeds = [JOB_SEED, job.poster.as_ref(), &job.job_id.to_le_bytes()], bump = job.bump)]
    pub job: Box<Account<'info, Job>>,
}

pub fn handle_unclaim_job(ctx: Context<UnclaimJob>) -> Result<()> {
    let machine = ctx.accounts.machine.key();
    let job = &mut ctx.accounts.job;
    require!(job.status == JobStatus::Claimed, EscrowError::JobNotClaimed);
    require!(job.worker == Some(machine), EscrowError::NotTheWorker);

    job.worker = None;
    job.previous_worker = Some(machine);
    job.claimed_at = 0;
    job.status = JobStatus::Open;
    let job_key = job.key();

    emit_cpi!(JobUnclaimed { job: job_key, machine, at: Clock::get()?.unix_timestamp });
    Ok(())
}
