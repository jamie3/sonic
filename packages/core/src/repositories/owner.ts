/**
 * Who a query acts for. A user id scopes it to that user's rows; `null` means
 * any owner and is only for background jobs (extractor, matcher, trash purge)
 * that act on a specific capture/entry regardless of who owns it.
 *
 * Required (not optional) on every owner-sensitive repository method, so a
 * forgotten scope is a type error rather than a data leak.
 */
export type Owner = string | null;
