from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from db import create_note, get_note, delete_note, list_recent_notes, search_notes, list_all_notes
from auth import verify_admin

router = APIRouter(
    prefix="/api/notes",
    tags=["notes"]
)

class NoteCreate(BaseModel):
    title: Optional[str] = ""
    content: str
    tags: Optional[str] = ""
    expiration: Optional[int] = None # in seconds. 0 or null for never expires.
    is_burn: bool = False
    has_password: bool = False
    salt: str = ""

class NoteResponse(BaseModel):
    id: str
    title: Optional[str] = ""
    content: str
    tags: Optional[str] = ""
    created_at: str | int
    is_burn: str = "false"
    has_password: str = "false"
    salt: str = ""

@router.post("/", response_model=Dict[str, str])
async def add_note(note: NoteCreate):
    if not note.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty.")
        
    note_id = await create_note(
        title=note.title,
        content=note.content,
        tags=note.tags,
        expiration_sec=note.expiration,
        is_burn=note.is_burn,
        has_password=note.has_password,
        salt=note.salt
    )
    return {"id": note_id, "message": "Note created successfully"}

@router.get("/recent")
async def get_recent(limit: int = 20):
    notes = await list_recent_notes(limit=limit)
    return notes

@router.get("/search")
async def search(q: str = Query("", min_length=0)):
    notes = await search_notes(q)
    return notes

@router.get("/admin/list")
async def get_admin_list(admin: str = Depends(verify_admin)):
    notes = await list_all_notes()
    return notes

@router.get("/{note_id}")
async def read_note(note_id: str):
    note = await get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found or has expired.")
        
    if note.get("is_burn") == "true":
        await delete_note(note_id)
        
    return note

@router.delete("/{note_id}")
async def remove_note(note_id: str):
    await delete_note(note_id)
    return {"message": "Note deleted"}
