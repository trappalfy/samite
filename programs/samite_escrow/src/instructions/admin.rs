//! `set_admin` in CLAUDE.md §4.3, done in two steps so a typo can't hand the config to a key nobody holds.
use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::EscrowError,
    events::{AdminAccepted, AdminProposed},
    state::Config,
};

#[event_cpi]
#[derive(Accounts)]
pub struct ProposeAdmin<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ EscrowError::NotAdmin)]
    pub config: Account<'info, Config>,
}

/// Step 1: the admin names the next admin. A later proposal replaces an earlier one.
pub fn handle_propose_admin(ctx: Context<ProposeAdmin>, new_admin: Pubkey) -> Result<()> {
    require_keys_neq!(new_admin, Pubkey::default(), EscrowError::InvalidNewAdmin);
    let config = &mut ctx.accounts.config;
    config.pending_admin = Some(new_admin);
    emit_cpi!(AdminProposed { admin: config.admin, proposed: new_admin });
    Ok(())
}

#[event_cpi]
#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == Some(new_admin.key()) @ EscrowError::NotPendingAdmin,
    )]
    pub config: Account<'info, Config>,
}

/// Step 2: the proposed key signs and becomes the admin.
pub fn handle_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let previous = config.admin;
    config.admin = ctx.accounts.new_admin.key();
    config.pending_admin = None;
    emit_cpi!(AdminAccepted { previous, admin: config.admin });
    Ok(())
}
