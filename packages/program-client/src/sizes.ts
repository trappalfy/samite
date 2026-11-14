/**
 * Bytes of a `Job` account: 8 (discriminator) + `Job::INIT_SPACE`, always sized for a full allowlist (DECISIONS, M2).
 * Used to read its rent live before posting. Checked against a real posted account in apps/worker's LiteSVM suite.
 */
export const JOB_ACCOUNT_BYTES = 568

/** Bytes of the `Config` account: 8 + `Config::INIT_SPACE` (the optional pending admin is sized at 33). */
export const CONFIG_ACCOUNT_BYTES = 181
