# obs-status-api

Tiny Express API + OBS overlay HTML pages.

## Routes

- `GET /` → "OK OVERLAY BUILD v1"
- `GET /routes` → list available routes
- `GET /status` → current values
- `POST /status` → update values
- `GET /overlay/asn`
- `GET /overlay/pup`
- `GET /overlay/backup`
- `GET /overlay/prst`

## Local run

```bash
npm install
npm start
```

Then open `http://localhost:8080/overlay/prst`

## EasyPanel deploy (Upload Source)

Upload the **contents of this folder** (or zip it), and set:

- **Build type**: Dockerfile
- **Dockerfile path**: `Dockerfile`
- **Port**: `8080`

If EasyPanel still seems to serve an old build, force a rebuild without cache in its build options (or bump the app version string in `GET /` / `build` field to confirm what’s running).

