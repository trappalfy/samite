use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::EscrowError,
    events::JobPosted,
    state::{ClaimPolicy, Config, Job, JobStatus},
};

/// Creates the job and its vault (the job PDA's USDC ATA, unless someone created it already) and moves `reward` from
/// the poster's ATA into the vault.
#[event_cpi]
#[derive(Accounts)]
#[instruction(job_id: u64)]
pub struct PostJob<'info> {
    #[account(mut)]
    pub poster: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ EscrowError::Paused)]
    pub config: Box<Account<'info, Config>>,
    #[account(address = config.usdc_mint @ EscrowError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = poster,
        associated_token::token_program = token_program,
    )]
    pub poster_token: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = poster,
        space = 8 + Job::INIT_SPACE,
        seeds = [JOB_SEED, poster.key().as_ref(), &job_id.to_le_bytes()],
        bump,
    )]
    pub job: Box<Account<'info, Job>>,
    /// `init_if_needed`: anyone can create the job PDA's ATA before this transaction lands (its address is
    /// predictable); that must not block the post. An existing vault must be the job PDA's USDC ATA (Anchor checks the
    /// address, mint, owner and token program) with no delegate or close authority (checked in the handler).
    #[account(
        init_if_needed,
        payer = poster,
        associated_token::mint = usdc_mint,
        associated_token::authority = job,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_post_job(
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
    let now = Clock::get()?.unix_timestamp;

    require!(reward >= ctx.accounts.config.min_reward, EscrowError::RewardTooSmall);

    let earliest = now.checked_add(MIN_DEADLINE).ok_or(EscrowError::MathOverflow)?;
    let latest = now.checked_add(MAX_DEADLINE).ok_or(EscrowError::MathOverflow)?;
    require!(deadline >= earliest && deadline <= latest, EscrowError::DeadlineOutOfRange);

    require!((MIN_REVIEW_WINDOW..=MAX_REVIEW_WINDOW).contains(&review_window), EscrowError::ReviewWindowOutOfRange);

    // every claim lapses (no "hold until the deadline" 0 since Nov 13): a poster who wants that sets the full term
    let until_deadline = deadline.checked_sub(now).ok_or(EscrowError::MathOverflow)?;
    require!(claim_window >= MIN_CLAIM_WINDOW && claim_window <= until_deadline, EscrowError::ClaimWindowOutOfRange);

    match policy {
        ClaimPolicy::Allowlist => require!(
            !allowlist.is_empty() && allowlist.len() <= usize::from(MAX_ALLOWLIST),
            EscrowError::InvalidAllowlist
        ),
        ClaimPolicy::Any | ClaimPolicy::Proven { .. } => require!(allowlist.is_empty(), EscrowError::InvalidAllowlist),
    }

    require!(spec_hash != [0u8; 32], EscrowError::SpecHashMissing);

    // Only the job PDA (this program) could set these on its ATA; refuse a vault that has them anyway.
    let vault = &ctx.accounts.vault;
    require!(
        vault.delegate.is_none() && vault.close_authority.is_none(),
        EscrowError::VaultHasDelegateOrCloseAuthority
    );

    // Exactly `reward` moves, whatever the vault already holds; an earlier balance is a donation, not reward.
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.poster_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.poster.to_account_info(),
            },
        ),
        reward,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let fee_bps = ctx.accounts.config.fee_bps;
    let poster = ctx.accounts.poster.key();
    let job_key = ctx.accounts.job.key();
    ctx.accounts.job.set_inner(Job {
        poster,
        job_id,
        reward,
        fee_bps,
        spec_hash,
        status: JobStatus::Open,
        worker: None,
        policy,
        allowlist: allowlist.clone(),
        deadline,
        review_window,
        claim_window,
        delivery_hash: [0; 32],
        deliveries: 0,
        created_at: now,
        claimed_at: 0,
        delivered_at: 0,
        bump: ctx.bumps.job,
        previous_worker: None,
    });

    emit_cpi!(JobPosted {
        job: job_key,
        poster,
        job_id,
        reward,
        fee_bps,
        spec_hash,
        deadline,
        review_window,
        claim_window,
        policy,
        allowlist,
        created_at: now,
    });
    Ok(())
}
