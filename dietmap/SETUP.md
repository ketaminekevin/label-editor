# DietMap Setup Guide

## Prerequisites

1. **Node.js 20+** — Download from https://nodejs.org (LTS version)
2. **PostgreSQL 14+** with PostGIS extension
3. **Mapbox account** — Free tier works, get a token at https://mapbox.com

---

## 1. Database Setup

```sql
-- Run in psql or pgAdmin:
CREATE DATABASE dietmap;
\c dietmap
CREATE EXTENSION postgis;
CREATE EXTENSION "uuid-ossp";
```

Then run the schema:
```bash
psql -d dietmap -f lib/schema.sql
```

---

## 2. Environment Variables

Copy `.env.local` and fill in your values:

```
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/dietmap
NEXTAUTH_SECRET=generate-with: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3002
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ1...  (from mapbox.com)
GOOGLE_CLIENT_ID=     (optional, for Google OAuth)
GOOGLE_CLIENT_SECRET= (optional, for Google OAuth)
```

---

## 3. Install & Run

```bash
# Install Node.js 20+ first, then:
npm install
npm run dev -- --port 3002
```

Open http://localhost:3002

---

## Features Built (Phase 1 MVP)

- ✅ Interactive Mapbox map with colour-coded dietary markers
- ✅ Sidebar with restaurant list + name search
- ✅ Dietary filter bar (12 dietary types)
- ✅ **Allergy Safe toggle** — hides low-safety restaurants
- ✅ Add restaurant manually (right-click map or nav button)
- ✅ Restaurant detail page with dietary safety panel
- ✅ Review system with dietary context tags and safety rating
- ✅ Favourite restaurants
- ✅ User auth (email/password + Google OAuth)
- ✅ User dietary profile (personalises default filters)
- ✅ PostgreSQL + PostGIS geospatial queries

## Next Steps (Phase 2+)

- Photo uploads (Cloudflare R2)
- Private notes per restaurant
- Area Scan (Google Places API + Claude LLM analysis)
- Stripe subscription for premium
- Restaurant owner claim/verify flow
- Mobile responsive refinements

---

## API Reference

```
GET  /api/restaurants?lat=X&lng=X&radius=X&dietary=gluten_free,vegan&allergy_safe=1
GET  /api/restaurants/:id
POST /api/restaurants
GET  /api/restaurants/:id/reviews
POST /api/restaurants/:id/reviews
POST /api/restaurants/:id/favourite
GET  /api/users/me
PUT  /api/users/me
GET  /api/users/me/favourites
```
