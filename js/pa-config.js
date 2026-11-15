/* ============================================
   PELE AWAKENING — Public booking configuration
   Only PUBLIC values belong here. The Supabase anon (publishable) key is
   designed to be public: Row Level Security decides what it can reach.
   Never put the service-role key or any Stripe secret in this file.
   ============================================ */
window.PA_CONFIG = {
  supabaseUrl: 'https://hbeazbrafkholwfaxojo.supabase.co',
  // Public anon key (role "anon"): it can only call get_public_schedule.
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhiZWF6YnJhZmtob2x3ZmF4b2pvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2Nzg3NTMsImV4cCI6MjExMDI1NDc1M30.05EzXX0RgHo17EWuBooX8lZy1oUBeXJswNkd7lKArnY'
};
