# Imposter Game

Prototype React + Supabase game where players join one universal room, ready up, answer questions, discuss, and vote to find the imposter.

Quick start

1. npm install
2. Create a Supabase project and run the SQL in `supabase_schema.sql` from the SQL editor.
3. Create a `.env` file at project root with:

VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key

4. npm run dev

Notes
- You'll need to enable Google OAuth in Supabase Auth settings and add redirect URL (e.g., http://localhost:5173).
- The app uses Realtime and row-level security may require policies for authenticated users.
# imposter game