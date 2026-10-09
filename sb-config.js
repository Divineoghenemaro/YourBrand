/* Supabase connection. Paste the two values from
 * Supabase dashboard -> Project Settings -> API.
 * Leave them empty to run in local-only mode (data stays in this browser).
 * The anon key is meant to be public; your data is protected by the
 * Row Level Security rules in supabase-schema.sql.
 * Not sure it's working? Open status.html. */
window.SDSS_SUPABASE = {
  URL: "https://jvkbxwlnjwmbloazdviq.supabase.co",      // e.g. "https://abcdxyz.supabase.co"
  ANON_KEY: "sb_publishable_ahb_AY37Pw9aBopTsoPgCA_pOhBfG2G"  // the "anon public" key
};
// Warm up the connection to your project (faster first request).
(function () {
  var u = window.SDSS_SUPABASE.URL;
  if (!u) return;
  try {
    var l = document.createElement("link");
    l.rel = "preconnect"; l.href = new URL(u).origin; l.crossOrigin = "anonymous";
    document.head.appendChild(l);
  } catch (e) {}
})();
