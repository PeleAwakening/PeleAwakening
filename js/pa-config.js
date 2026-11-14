/* ============================================
   PELE AWAKENING — Public booking configuration
   Only PUBLIC values belong here. The Supabase anon (publishable) key is
   designed to be public: Row Level Security decides what it can reach.
   Never put the service-role key or any Stripe secret in this file.
   ============================================ */
window.PA_CONFIG = {
  supabaseUrl: '',      // e.g. https://abcd1234.supabase.co
  supabaseAnonKey: ''   // the project's anon / publishable key
};
