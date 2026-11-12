// Query shapes that depend on PostgREST relationship rules. Kept dependency-free so scripts/check-api.mjs can test them
// against the live API (an ambiguous embed only fails at runtime, never in a build).
//
// photographer_profiles <-> profiles has TWO routes: the direct foreign key (user_id) and a many-to-many through `favorites`.
// Every embed must name the route, otherwise PostgREST answers PGRST201 "more than one relationship was found".
const OWNER = 'profiles!photographer_profiles_user_id_fkey(full_name, email, phone)'

export const Q = {
  pendingList: `id, location, specialties, created_at, ${OWNER}`,
  reviewPhotographer: `*, ${OWNER}`,
}

/** Every [table, select] pair the app sends, so the API check covers them all. */
export const APP_SELECTS = [
  ['profiles', 'id, role, email, phone, full_name'],
  ['photographer_profiles', 'id, verification_status, verification_note, tier, total_bookings, terms_accepted_at'],
  ['photographer_profiles', Q.pendingList],
  ['photographer_profiles', Q.reviewPhotographer],
  ['photos', 'id, url, thumbnail_url, storage_path, is_cover, upload_order'],
  ['photos', 'id, thumbnail_url, url'],
  ['packages', '*'],
  ['payout_accounts', '*'],
  ['verification_documents', 'doc_type, storage_path'],
  ['public_photographers', '*'],
  ['reviews', 'id, rating, comment, created_at'],
  ['favorites', 'photographer_id'],
  ['availability', 'day, start_time, end_time'],
  ['photographer_profiles', 'work_start, work_end'],
  ['platform_settings', 'simulate_payments'],
  ['bookings', 'shoot_date'],
  ['bookings', 'id, booking_ref, status, payment_status, shoot_date, shoot_time, shoot_starts_at, shoot_ends_at, shoot_completed_at, shoot_confirmed_at, deposit_released_at, gallery_uploaded_at, total_amount, platform_fee, simulated, created_at, photographer_id, package_id'],
  ['bookings', 'id, booking_ref, status, payment_status, shoot_date, shoot_time, shoot_starts_at, shoot_ends_at, shoot_completed_at, shoot_confirmed_at, deposit_released_at, gallery_uploaded_at, total_amount, platform_fee, transaction_fee, simulated, client_id, package_id'],
  ['payouts', 'id, booking_id, amount, type, status, frozen, bank_reference, created_at, completed_at, simulated'],
  ['payouts', 'id, booking_id, photographer_id, amount, type, status, frozen, created_at'],
  ['payout_accounts', 'photographer_id, bank_name, account_holder, account_number, account_type, branch_code'],
  ['photos', 'id, file_name, size_bytes, upload_order'],
  ['packages', 'id, name, num_photos'],
  ['payout_accounts', 'photographer_id, bank_name, account_holder, account_number, account_type, branch_code, updated_at'],
  ['photographer_profiles', 'id, user_id'],
  ['notifications', 'id, type, title, body, booking_id, created_at, read_at'],
  ['disputes', 'id, booking_id, type, description, status, resolution, created_at, resolved_at, raised_by'],
  ['disputes', '*'],
  ['payouts', 'id, amount, type, status, frozen, simulated'],
]

/** Database functions the app calls (name, arguments). Sent anonymously; a harmless "not allowed" answer is fine. */
const NIL = '00000000-0000-0000-0000-000000000000'
export const APP_RPCS = [
  ['get_open_days', { p_photographer: NIL, p_from: '2026-01-01', p_to: '2026-01-31', p_hours: 2 }],
  ['get_free_slots', { p_photographer: NIL, p_day: '2026-01-05', p_hours: 2 }],
  ['my_earnings', {}],
  ['request_withdrawal', {}],
  ['simulate_payment', { p_booking: NIL }],
  ['simulate_shoot_over', { p_booking: NIL }],
  ['simulate_skip_wait', { p_booking: NIL }],
  ['mark_shoot_complete', { p_booking: NIL }],
  ['confirm_shoot', { p_booking: NIL }],
  ['report_issue', { p_booking: NIL, p_type: 'other', p_description: 'check' }],
  ['admin_resolve_dispute', { p_dispute: NIL, p_outcome: 'dismiss', p_note: 'check' }],
  ['simulate_delivery', { p_booking: NIL }],
  ['deliver_gallery', { p_booking: NIL }],
  ['delivery_required', { p_booking: NIL }],
  ['admin_verify_bank', { p_photographer: NIL }],
  ['admin_complete_payout', { p_payout: NIL, p_bank_reference: 'check' }],
]
