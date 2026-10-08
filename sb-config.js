/* Supabase connection. Paste the two values from
 * Supabase dashboard -> Project Settings -> API.
 * Leave them empty to run in local-only mode (data stays in this browser).
 * The anon key is meant to be public; your data is protected by the
 * Row Level Security rules in supabase-schema.sql. */
window.SDSS_SUPABASE = {
  URL: "https://jvkbxwlnjwmbloazdviq.supabase.co",      // e.g. "https://abcdxyz.supabase.co"
  ANON_KEY: "sb_publishable_ahb_AY37Pw9aBopTsoPgCA_pOhBfG2G"  // the "anon public" key
};
// Load the Supabase client library only when a project is configured.
if (window.SDSS_SUPABASE.URL && window.SDSS_SUPABASE.ANON_KEY) {
  document.write('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>');
}
