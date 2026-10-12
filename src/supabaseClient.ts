import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = "https://ynlcbpxcsnfxqrogizns.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubGNicHhjc25meHFyb2dpem5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MDMxNjMsImV4cCI6MjEwMzQ3OTE2M30.sx5iFeugOuLBt4pqt0-8_4VOGz1yWa7HQWl4NyGCWkE";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
