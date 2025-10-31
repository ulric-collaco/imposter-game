import { createClient } from '@supabase/supabase-js'

// TODO: replace with your Supabase project URL and anon key or set via env during deploy
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Export for use in cleanup handlers
export const supabaseUrl = SUPABASE_URL
export const supabaseKey = SUPABASE_ANON_KEY
