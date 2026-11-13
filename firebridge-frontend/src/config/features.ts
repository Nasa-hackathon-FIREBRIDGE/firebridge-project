/**
 * Product switches decided at build time.
 *
 * The synthetic demonstration (eight fixture-driven pages plus the Preferences page that only
 * configures them) is hidden from the public app: every number on the site now comes from
 * published NASA FIRMS releases. Its code is kept; set this to true to bring the pages and their
 * sidebar group back. While false, their URLs fall through to the app's redirect to Home.
 */
export const SHOW_DEMONSTRATION = false

/**
 * The ingestion administration page is an operator tool (token-gated scheduling of imports), not
 * part of the public product. It is hidden from the app and its URL redirects Home; set this to true
 * to bring the page and its sidebar link back.
 */
export const SHOW_INGESTION_ADMIN = false
