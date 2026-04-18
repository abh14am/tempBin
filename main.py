from fastapi import FastAPI, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from routers import notes
from db import init_db
import os

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize redis connection and search index
    await init_db()
    yield
    # Clean up can happen here

app = FastAPI(title="Private Pastebin API", lifespan=lifespan)

# Setup Routers
app.include_router(notes.router)

# Serve Frontend Base URL to HTML
@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")

from auth import verify_admin

@app.get("/admin")
async def serve_admin(admin: str = Depends(verify_admin)):
    return FileResponse("static/admin.html")

# Mount Static Files at the end
# Everything else not matched by API or index falls back here
app.mount("/static", StaticFiles(directory="static"), name="static")

# Catch-all for SPA client side routing to let JS handle it, if necessary. 
# But for a simple app we might just use hash routing or explicit paths.
# Let's let index handle any unmapped root routes nicely.
@app.exception_handler(404)
async def custom_404_handler(request, __):
    # If API error, return JSON 404
    if request.url.path.startswith("/api/"):
        return {"detail": "Not Found"}
    return FileResponse("static/index.html")
