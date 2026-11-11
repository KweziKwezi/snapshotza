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
]
