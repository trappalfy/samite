use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::EscrowError,
    events::DeliverySubmitted,
    state::{Job, JobStatus},
};

/// The job's machine records the hash of its delivery (§5.2); the poster's review window starts. Works while paused.
#[event_cpi]
#[derive(Accounts)]
pub struct SubmitDelivery<'info> {
    pub machine: Signer<'info>,
    #[account(mut, seeds = [JOB_SEED, job.poster.as_ref(), &job.job_id.to_le_bytes()], bump = job.bump)]
    pub job: Box<Account<'info, Job>>,
}

pub fn handle_submit_delivery(ctx: Context<SubmitDelivery>, delivery_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let machine = ctx.accounts.machine.key();
    let job = &mut ctx.accounts.job;
    require!(job.status == JobStatus::Claimed, EscrowError::JobNotClaimed);
    require!(job.worker == Some(machine), EscrowError::NotTheWorker);
    require!(now <= job.deadline, EscrowError::DeadlinePassed);
    require!(job.deliveries < MAX_DELIVERIES, EscrowError::TooManyDeliveries);
    require!(delivery_hash != [0u8; 32], EscrowError::DeliveryHashMissing);

    job.delivery_hash = delivery_hash;
    job.delivered_at = now;
    job.deliveries = job.deliveries.checked_add(1).ok_or(EscrowError::MathOverflow)?;
    job.status = JobStatus::Delivered;
    let (job_key, attempt) = (job.key(), job.deliveries);

    emit_cpi!(DeliverySubmitted { job: job_key, machine, delivery_hash, attempt, delivered_at: now });
    Ok(())
}
