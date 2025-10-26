# Multiplayer Game

A real-time multiplayer game built with React, Node.js WebSocket server, and Supabase. Players join a room, ready up, answer questions, discuss, and vote to find the imposter.

## Project Structure

```
├── frontend/          # React frontend application
├── backend/           # Node.js WebSocket server
├── .kiro/            # Kiro IDE specifications
└── docs/             # Documentation files
```

## Quick Start

1. **Install all dependencies:**

```bash
npm run install:all
```

2. **Set up environment variables:**

- Frontend: Copy `frontend/.env.example` to `frontend/.env` and add your Supabase credentials
- Backend: Copy `backend/.env.example` to `backend/.env` and add your Supabase service key

3. **Set up the database:**
   Run the SQL commands in `backend/setup_database.sql` in your Supabase SQL editor.

4. **Start development servers:**

```bash
npm run dev
```

5. **Open your browser:**

- Frontend: http://localhost:5173
- Backend health check: http://localhost:8080/health

## Available Scripts

- `npm run dev` - Start both frontend and backend in development mode
- `npm start` - Start both frontend (production build) and backend
- `npm run install:all` - Install dependencies for root, frontend, and backend
- `npm run build` - Build frontend for production
- `npm test` - Run tests for both frontend and backend
- `npm run frontend:dev` - Start only frontend in development
- `npm run backend:dev` - Start only backend

## Features

- Real-time WebSocket communication
- Google OAuth authentication via Supabase
- Player management and game state synchronization
- Responsive UI with Tailwind CSS
- Comprehensive testing suite

## Notes

- Enable Google OAuth in Supabase Auth settings and add redirect URL (e.g., http://localhost:5173)
- The app uses WebSocket for real-time communication with Supabase as fallback
