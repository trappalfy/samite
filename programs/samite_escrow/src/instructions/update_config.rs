use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*, error::EscrowError, events::ConfigUpdated, instructions::initialize_config::check_treasury,
    state::Config,
};

/// Changes the treasury (owner + its USDC ATA), the fee (for new jobs only: each job keeps its snapshot), the minimum
/// reward, or the pause. Nothing here can move escrowed funds.
#[event_cpi]
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EscrowError::NotAdmin)]
    pub config: Account<'info, Config>,
    /// A new treasury owner (wallet or multisig); an account owned by this program (a job PDA) is refused. Pass it with
    /// `new_treasury`, or neither to keep the current treasury.
    /// CHECK: only its key and its owning program are read.
    #[account(constraint = *new_treasury_owner.owner != crate::ID @ EscrowError::TreasuryOwnerIsProgramAccount)]
    pub new_treasury_owner: Option<UncheckedAccount<'info>>,
    /// The new fee account: must be the USDC ATA of `new_treasury_owner` (`check_treasury`).
    pub new_treasury: Option<Account<'info, TokenAccount>>,
}

pub fn handle_update_config(
    ctx: Context<UpdateConfig>,
    fee_bps: Option<u16>,
    min_reward: Option<u64>,
    paused: Option<bool>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(fee_bps) = fee_bps {
        require!(fee_bps <= MAX_FEE_BPS, EscrowError::FeeTooHigh);
        config.fee_bps = fee_bps;
    }
    if let Some(min_reward) = min_reward {
        require!(min_reward > 0, EscrowError::MinRewardZero);
        config.min_reward = min_reward;
    }
    if let Some(paused) = paused {
        config.paused = paused;
    }
    match (&ctx.accounts.new_treasury_owner, &ctx.accounts.new_treasury) {
        (Some(owner), Some(treasury)) => {
            check_treasury(&owner.key(), treasury, &config.usdc_mint)?;
            config.treasury_owner = owner.key();
            config.treasury = treasury.key();
        }
        (None, None) => {}
        _ => return err!(EscrowError::TreasuryOwnerAndAtaRequired),
    }

    emit_cpi!(ConfigUpdated {
        admin: config.admin,
        treasury: config.treasury,
        fee_bps: config.fee_bps,
        min_reward: config.min_reward,
        paused: config.paused,
    });
    Ok(())
}
